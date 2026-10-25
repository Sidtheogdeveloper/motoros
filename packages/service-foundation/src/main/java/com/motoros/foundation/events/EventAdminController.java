package com.motoros.foundation.events;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.security.ServiceTokens;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

@RestController
@RequestMapping("/api/platform/messaging")
public class EventAdminController {
  private final EventStore store;
  private final EventBroker broker;
  private final ServiceTokens tokens;
  private final String tenant;
  private final EventWorker worker;

  public EventAdminController(
      EventStore store,
      EventBroker broker,
      ServiceTokens tokens,
      EventWorker worker,
      Environment env) {
    this.store = store;
    this.broker = broker;
    this.tokens = tokens;
    this.worker = worker;
    tenant = env.getProperty("motoros.tenant-url", "http://127.0.0.1:8081");
  }

  private UUID admin(Jwt jwt) {
    if (store.schema.equals("tenant")) {
      var rows =
          store.db.queryForList(
              "select id from tenant.platform_users where issuer=? and subject=? and"
                  + " status='ACTIVE' and platform_admin=true",
              jwt.getIssuer().toString(),
              jwt.getSubject());
      if (rows.isEmpty())
        throw new ResponseStatusException(FORBIDDEN, "Platform administrator required");
      return (UUID) rows.getFirst().get("id");
    }
    var factory =
        new org.springframework.http.client.JdkClientHttpRequestFactory(
            java.net.http.HttpClient.newBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(2))
                .build());
    factory.setReadTimeout(java.time.Duration.ofSeconds(5));
    var proof =
        RestClient.builder()
            .requestFactory(factory)
            .build()
            .get()
            .uri(tenant + "/api/internal/platform-authority")
            .headers(
                h -> {
                  h.setBearerAuth(tokens.token());
                  h.set("X-User-Token", jwt.getTokenValue());
                })
            .retrieve()
            .body(Map.class);
    if (proof == null || !Boolean.TRUE.equals(proof.get("platformAdmin")))
      throw new ResponseStatusException(FORBIDDEN, "Platform administrator required");
    return Records.uuid(proof.get("userId"));
  }

  @GetMapping("/health")
  public Map<String, Object> health(@AuthenticationPrincipal Jwt jwt) {
    admin(jwt);
    var counts =
        store.db.queryForList(
            "select status,count(*) as count,min(created_at) as oldest from "
                + store.schema
                + ".outbox_events group by status");
    var queues = new LinkedHashMap<String, Object>();
    for (String c : List.of("notification", "analytics", "workorder-approval"))
      for (String name : List.of(c, c + "-dlq"))
        try {
          queues.put(
              name,
              broker
                  .sqs
                  .getQueueAttributes(
                      b ->
                          b.queueUrl(broker.queue(name))
                              .attributeNames(
                                  QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES,
                                  QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES_NOT_VISIBLE))
                  .attributesAsStrings());
        } catch (Exception e) {
          queues.put(name, Map.of("status", "UNAVAILABLE"));
        }
    return Map.of(
        "service",
        store.schema,
        "outbox",
        counts.stream().map(Records::dto).toList(),
        "queues",
        queues,
        "worker",
        worker.state(),
        "checkedAt",
        java.time.Instant.now().toString());
  }

  @GetMapping("/failures")
  public Map<String, Object> failures(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    admin(jwt);
    Records.page(page, size);
    return Records.page(
        store.db.queryForList(
            "select"
                + " id,event_id,tenant_id,consumer_name,category,attempt_count,status,created_at,updated_at"
                + " from "
                + store.schema
                + ".consumer_failures order by created_at desc,id limit ? offset ?",
            size,
            page * size),
        store.db.queryForObject(
            "select count(*) from " + store.schema + ".consumer_failures", Long.class),
        size);
  }

  @GetMapping("/outbox")
  public Map<String, Object> outbox(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    admin(jwt);
    Records.page(page, size);
    return Records.page(
        store.db.queryForList(
            "select"
                + " event_id,event_type,canonical_type,tenant_id,branch_id,aggregate_type,aggregate_id,aggregate_version,status,attempts,next_attempt_at,last_error,created_at,published_at"
                + " from "
                + store.schema
                + ".outbox_events where (?='' or status=?) order by created_at desc,event_id limit"
                + " ? offset ?",
            status,
            status,
            size,
            page * size),
        store.db.queryForObject(
            "select count(*) from " + store.schema + ".outbox_events where (?='' or status=?)",
            Long.class,
            status,
            status),
        size);
  }

  public record Action(@NotBlank @Size(min = 10, max = 500) String reason) {}

  @PostMapping("/outbox/{id}/retry")
  public Map<String, Object> retryOutbox(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody Action input) {
    UUID actor = admin(jwt);
    return store.tx.execute(
        t -> {
          var row =
              new Records(store.db)
                  .one(
                      "select * from "
                          + store.schema
                          + ".outbox_events where event_id=? for update",
                      id);
          if (!"TERMINAL".equals(row.get("status")) || row.get("aggregate_version") == null)
            throw new ResponseStatusException(
                CONFLICT, "Only versioned terminal events can be retried");
          EventEnvelope.from(
              row); // An upgrade or operator action cannot bypass the current contract.
          store.db.update(
              "update "
                  + store.schema
                  + ".outbox_events set status='PENDING',next_attempt_at=now(),last_error=null"
                  + " where event_id=?",
              id);
          store.db.update(
              "insert into "
                  + store.schema
                  + ".messaging_admin_audit(id,actor_id,action,failure_id,reason)"
                  + " values(?,?,'OUTBOX_RETRY',?,?)",
              UUID.randomUUID(),
              actor,
              id,
              input.reason());
          return Map.of("eventId", id, "status", "PENDING");
        });
  }

  @PostMapping("/consumer/{action}")
  public Map<String, Object> consuming(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String action,
      @Valid @RequestBody Action input) {
    UUID actor = admin(jwt);
    if (!Set.of("pause", "resume").contains(action)) throw new ResponseStatusException(BAD_REQUEST);
    store.db.update(
        "insert into "
            + store.schema
            + ".messaging_admin_audit(id,actor_id,action,reason) values(?,?,?,?)",
        UUID.randomUUID(),
        actor,
        "CONSUMER_" + action.toUpperCase(Locale.ROOT),
        input.reason());
    worker.consuming(action.equals("resume"));
    return worker.state();
  }

  @PostMapping("/failures/{id}/{action}")
  public Map<String, Object> action(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID id,
      @PathVariable String action,
      @Valid @RequestBody Action input) {
    UUID actor = admin(jwt);
    if (!Set.of("redrive", "resolve").contains(action))
      throw new ResponseStatusException(BAD_REQUEST);
    return store.tx.execute(
        t -> {
          var row =
              new Records(store.db)
                  .one(
                      "select * from " + store.schema + ".consumer_failures where id=? for update",
                      id);
          if ("redrive".equals(action)) {
            var event = broker.decode(row.get("message_body").toString());
            // Normal consumer revalidates source/resource and applies the same durable inbox.
            broker.sqs.sendMessage(
                b ->
                    b.queueUrl(broker.queue(row.get("consumer_name").toString()))
                        .messageBody(row.get("message_body").toString()));
          }
          store.db.update(
              "update "
                  + store.schema
                  + ".consumer_failures set status=?,updated_at=now() where id=?",
              action.equals("resolve") ? "RESOLVED" : "REDRIVEN",
              id);
          store.db.update(
              "insert into "
                  + store.schema
                  + ".messaging_admin_audit(id,actor_id,action,failure_id,reason)"
                  + " values(?,?,?,?,?)",
              UUID.randomUUID(),
              actor,
              action.toUpperCase(Locale.ROOT),
              id,
              input.reason());
          return Map.of("id", id, "action", action, "audited", true);
        });
  }
}
