package com.motoros.foundation.events;

import com.motoros.foundation.Records;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationRegistry;
import java.util.*;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

public final class EventWorker {
  private final EventStore store;
  private final EventBroker broker;
  private final EventGateway gateway;
  private final List<EventHandler> handlers;
  private final MeterRegistry metrics;
  private final ObservationRegistry observations;
  private final boolean publishEnabled;
  private volatile boolean consumeEnabled;
  private final java.util.concurrent.atomic.AtomicInteger activeConsumers =
      new java.util.concurrent.atomic.AtomicInteger();

  public void consuming(boolean enabled) {
    consumeEnabled = enabled;
  }

  public Map<String, Object> state() {
    return Map.of("consuming", consumeEnabled, "activeConsumerLoops", activeConsumers.get());
  }

  @Scheduled(fixedDelayString = "${motoros.events.local-recovery-ms:5000}")
  public void recoverLocalBroker() {
    if (!broker.emulator() || !publishEnabled) return;
    try {
      String generation = broker.localGeneration();
      if (generation == null) return;
      store.tx.executeWithoutResult(
          t -> {
            new Records(store.db).lock(store.schema + "-local-broker-generation");
            var old =
                store.db.queryForList(
                    "select value from "
                        + store.schema
                        + ".messaging_runtime_metadata where key='local-broker-generation'");
            if (!old.isEmpty() && !generation.equals(old.getFirst().get("value"))) {
              int replayed =
                  store.db.update(
                      "update "
                          + store.schema
                          + ".outbox_events set"
                          + " status='PENDING',delivery_status='PENDING',published_at=null,next_attempt_at=now(),last_error='LOCAL_BROKER_RESTART_REPLAY'"
                          + " where status='PUBLISHED' and created_at>now()-interval '14 days'");
              metrics
                  .counter("motoros.local.replay.events", "producer", store.schema)
                  .increment(replayed);
            }
            store.db.update(
                "insert into "
                    + store.schema
                    + ".messaging_runtime_metadata(key,value) values('local-broker-generation',?)"
                    + " on conflict(key) do update set value=excluded.value,updated_at=now()",
                generation);
          });
    } catch (Exception e) {
      LoggerFactory.getLogger(getClass()).debug("local_recovery_waiting producer={}", store.schema);
    }
  }

  public EventWorker(
      EventStore store,
      EventBroker broker,
      EventGateway gateway,
      List<EventHandler> handlers,
      MeterRegistry metrics,
      ObservationRegistry observations,
      boolean publishEnabled,
      boolean consumeEnabled) {
    this.store = store;
    this.broker = broker;
    this.gateway = gateway;
    this.handlers = handlers;
    this.metrics = metrics;
    this.observations = observations;
    this.publishEnabled = publishEnabled;
    this.consumeEnabled = consumeEnabled;
    metrics.gauge(
        "motoros.outbox.pending",
        store,
        s ->
            s.db.queryForObject(
                "select count(*) from "
                    + s.schema
                    + ".outbox_events where status in ('PENDING','CLAIMED')",
                Double.class));
    metrics.gauge(
        "motoros.outbox.oldest.seconds",
        store,
        s ->
            s.db.queryForObject(
                "select coalesce(extract(epoch from(now()-min(created_at))),0) from "
                    + s.schema
                    + ".outbox_events where status in ('PENDING','CLAIMED')",
                Double.class));
  }

  @Scheduled(fixedDelayString = "${motoros.events.poll-ms:1000}")
  public void publish() {
    if (!publishEnabled) return;
    for (var row : store.claim(5, 120)) {
      var parent =
          broker.parent(
              Records.json(
                  Map.of(
                      "MessageAttributes",
                      row.get("traceparent") == null
                          ? Map.of()
                          : Map.of("traceparent", Map.of("Value", row.get("traceparent"))))));
      var observation =
          Observation.start("motoros.event.publish", observations)
              .lowCardinalityKeyValue("producer", store.schema);
      try (var scope = observation.openScope()) {
        var event = EventEnvelope.from(row);
        broker.publish(event);
        store.published(row);
        metrics.counter("motoros.events.published", "producer", store.schema).increment();
      } catch (Exception e) {
        boolean permanent = e instanceof IllegalArgumentException;
        store.failed(row, permanent ? "INVALID_CONTRACT" : "BROKER_UNAVAILABLE", permanent);
        metrics.counter("motoros.publisher.failures", "producer", store.schema).increment();
        LoggerFactory.getLogger(getClass())
            .warn(
                "event_publish_failed eventId={} correlationId={} category={}",
                row.get("event_id"),
                row.get("correlation_id"),
                permanent ? "INVALID_CONTRACT" : "TRANSIENT");
        observation.error(e);
      } finally {
        observation.stop();
        parent.close();
      }
    }
  }

  @Scheduled(fixedDelayString = "${motoros.events.consume-poll-ms:500}")
  public void consume() {
    if (!consumeEnabled) return;
    activeConsumers.incrementAndGet();
    try {
      for (var handler : handlers) {
        try {
          for (var message : broker.receive(handler.consumer())) {
            EventEnvelope event = null;
            var parent = broker.parent(message.body());
            var observation =
                Observation.start("motoros.event.consume", observations)
                    .lowCardinalityKeyValue("consumer", handler.consumer());
            try (var scope = observation.openScope()) {
              event = broker.decode(message.body());
              observation
                  .highCardinalityKeyValue("messaging.message.id", event.eventId().toString())
                  .highCardinalityKeyValue("motoros.correlation_id", event.correlationId());
              if (handler.accepts(event)) {
                var context = gateway.proof(event);
                var finalEvent = event;
                store.inbox(handler.consumer(), event, () -> handler.handle(finalEvent, context));
                metrics
                    .timer("motoros.consumer.lag", "consumer", handler.consumer())
                    .record(
                        java.time.Duration.between(
                                java.time.Instant.parse(event.occurredAt()),
                                java.time.Instant.now())
                            .abs());
              }
              broker.acknowledge(handler.consumer(), message);
            } catch (Exception e) {
              int attempt =
                  Integer.parseInt(
                      message.attributesAsStrings().getOrDefault("ApproximateReceiveCount", "1"));
              boolean terminal =
                  e instanceof IllegalArgumentException
                      || (e instanceof org.springframework.web.client.HttpClientErrorException http
                          && http.getStatusCode().value() != 429);
              String category = terminal ? "PERMANENT_VALIDATION" : "TRANSIENT_DEPENDENCY";
              store.failure(handler.consumer(), event, message.body(), category);
              if (terminal || attempt >= 5) broker.quarantine(handler.consumer(), message);
              else broker.retry(handler.consumer(), message, attempt);
              metrics
                  .counter(
                      "motoros.consumer.failures",
                      "consumer",
                      handler.consumer(),
                      "category",
                      category)
                  .increment();
              LoggerFactory.getLogger(getClass())
                  .warn(
                      "event_consume_failed eventId={} consumer={} category={} attempt={}",
                      event == null ? null : event.eventId(),
                      handler.consumer(),
                      category,
                      attempt);
              observation.error(e);
            } finally {
              observation.stop();
              parent.close();
            }
          }
        } catch (Exception e) {
          LoggerFactory.getLogger(getClass())
              .warn("consumer_poll_failed consumer={} category=TRANSPORT", handler.consumer());
        }
      }
    } finally {
      activeConsumers.decrementAndGet();
    }
  }
}
