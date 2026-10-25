package com.motoros.foundation.events;

import com.motoros.foundation.Records;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Own-schema storage only. Every claim is fenced; no database transaction spans broker I/O. */
public final class EventStore {
  public final JdbcTemplate db;
  public final TransactionTemplate tx;
  public final String schema;

  public EventStore(JdbcTemplate db, PlatformTransactionManager manager, String schema) {
    if (!Set.of(
            "tenant",
            "customer",
            "booking",
            "workorder",
            "inventory",
            "billing",
            "notification",
            "analytics")
        .contains(schema)) throw new IllegalArgumentException();
    this.db = db;
    this.tx = new TransactionTemplate(manager);
    this.schema = schema;
  }

  public List<Map<String, Object>> claim(int limit, int leaseSeconds) {
    UUID token = UUID.randomUUID();
    return tx.execute(
        t ->
            db.queryForList(
                "with due as (select event_id from "
                    + schema
                    + ".outbox_events where (status='PENDING' and next_attempt_at<=now()) or"
                    + " (status='CLAIMED' and lease_until<now()) order by created_at limit ? for"
                    + " update skip locked) update "
                    + schema
                    + ".outbox_events o set"
                    + " status='CLAIMED',claim_token=?,lease_until=now()+make_interval(secs=>?),attempts=attempts+1"
                    + " from due where o.event_id=due.event_id returning o.*",
                limit,
                token,
                leaseSeconds));
  }

  public boolean published(Map<String, Object> row) {
    return db.update(
            "update "
                + schema
                + ".outbox_events set"
                + " status='PUBLISHED',delivery_status='DELIVERED',published_at=now(),claim_token=null,lease_until=null,last_error=null"
                + " where event_id=? and claim_token=? and status='CLAIMED'",
            row.get("event_id"),
            row.get("claim_token"))
        == 1;
  }

  public void failed(Map<String, Object> row, String category, boolean terminal) {
    int delay = backoff(((Number) row.get("attempts")).intValue());
    db.update(
        "update "
            + schema
            + ".outbox_events set"
            + " status=?,next_attempt_at=now()+make_interval(secs=>?),last_error=?,claim_token=null,lease_until=null"
            + " where event_id=? and claim_token=? and status='CLAIMED'",
        terminal ? "TERMINAL" : "PENDING",
        delay,
        category,
        row.get("event_id"),
        row.get("claim_token"));
  }

  public static int backoff(int attempts) {
    return Math.min(900, 1 << Math.min(attempts, 9)) + new java.security.SecureRandom().nextInt(4);
  }

  public static String hash(Object value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(Records.json(value).getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  /**
   * Must be invoked in the same transaction as the business handler. An exception rolls back both.
   */
  public boolean inbox(String consumer, EventEnvelope event, Runnable handler) {
    return Boolean.TRUE.equals(
        tx.execute(
            t -> {
              db.queryForObject(
                  "select set_config('motoros.correlation_id',?,true)",
                  String.class,
                  event.correlationId());
              db.queryForObject(
                  "select set_config('motoros.causation_id',?,true)",
                  String.class,
                  event.eventId().toString());
              var r = new Records(db);
              r.lock(schema + consumer + event.eventId());
              var prior =
                  db.queryForList(
                      "select tenant_id,event_hash from "
                          + schema
                          + ".processed_events where consumer_name=? and event_id=?",
                      consumer,
                      event.eventId());
              String hash = hash(event);
              if (!prior.isEmpty()) {
                if (!event.tenantId().equals(prior.getFirst().get("tenant_id"))
                    || !hash.equals(prior.getFirst().get("event_hash")))
                  throw new IllegalArgumentException("EVENT_IDENTITY_MISMATCH");
                return false;
              }
              handler.run();
              db.update(
                  "insert into "
                      + schema
                      + ".processed_events(consumer_name,event_id,tenant_id,event_type,aggregate_id,event_hash)"
                      + " values(?,?,?,?,?,?)",
                  consumer,
                  event.eventId(),
                  event.tenantId(),
                  event.eventType(),
                  event.aggregateId(),
                  hash);
              return true;
            }));
  }

  public void failure(String consumer, EventEnvelope event, String raw, String category) {
    db.update(
        "insert into "
            + schema
            + ".consumer_failures(id,event_id,tenant_id,consumer_name,category,message_body)"
            + " values(?,?,?,?,?,?) on conflict(consumer_name,event_id) do update set"
            + " attempt_count=consumer_failures.attempt_count+1,category=excluded.category,updated_at=now()",
        UUID.randomUUID(),
        event == null ? null : event.eventId(),
        event == null ? null : event.tenantId(),
        consumer,
        category,
        raw);
  }

  public void append(EventEnvelope source, UUID id, String type, Map<String, Object> snapshot) {
    db.update(
        "insert into "
            + schema
            + ".outbox_events(event_id,event_type,tenant_id,branch_id,aggregate_id,aggregate_type,correlation_id,causation_id,payload,actor_id,source_snapshot)"
            + " values(?,?,?,?,?,'notification_requests',?,?,?::jsonb,? ,?::jsonb)",
        UUID.randomUUID(),
        type,
        source.tenantId(),
        source.branchId(),
        id,
        source.correlationId(),
        source.eventId(),
        "{}",
        new UUID(0, 0),
        Records.json(snapshot));
  }
}
