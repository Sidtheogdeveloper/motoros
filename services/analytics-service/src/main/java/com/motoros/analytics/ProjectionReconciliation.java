package com.motoros.analytics;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
    name = "motoros.analytics.reconcile-enabled",
    havingValue = "true",
    matchIfMissing = true)
public class ProjectionReconciliation {
  private final EventStore store;
  private final EventGateway gateway;
  private final AnalyticsConsumer handler;

  ProjectionReconciliation(EventStore store, EventGateway gateway, AnalyticsConsumer handler) {
    this.store = store;
    this.gateway = gateway;
    this.handler = handler;
  }

  @Scheduled(fixedDelayString = "${motoros.analytics.reconcile-ms:60000}")
  public void reconcile() {
    for (String producer : List.of("booking", "workorder", "billing", "inventory", "notification"))
      try {
        store.tx.executeWithoutResult(
            t -> {
              new Records(store.db).lock("reconcile-" + producer);
              var rows =
                  store.db.queryForList(
                      "select reconciliation_cursor,reconciliation_event_id from"
                          + " analytics.projection_checkpoints where consumer_name='analytics' and"
                          + " producer=?",
                      producer);
              String cursor =
                  rows.isEmpty()
                      ? Instant.EPOCH.toString()
                      : Records.instant(rows.getFirst().get("reconciliation_cursor")).toString();
              UUID after =
                  rows.isEmpty()
                      ? new UUID(0, 0)
                      : (UUID) rows.getFirst().get("reconciliation_event_id");
              var response =
                  gateway.get(
                      producer,
                      "/api/automation/reconciliation-events?after=" + cursor + "&afterId=" + after,
                      new UUID(0, 0));
              if (((List<?>) response.get("content")).isEmpty())
                store.db.update(
                    "update analytics.projection_checkpoints set"
                        + " reconciliation_cursor='epoch',reconciliation_event_id='00000000-0000-0000-0000-000000000000',reconciled_at=now()"
                        + " where consumer_name='analytics' and producer=?",
                    producer);
              for (Object value : (List<?>) response.get("content")) {
                EventEnvelope event = EventEnvelope.read(Records.json(value));
                gateway.proof(event);
                // Deliberately re-apply verified snapshots: inbox alone cannot repair a lost
                // projection row.
                handler.handle(event, Map.of());
                store.db.update(
                    "update analytics.projection_checkpoints set"
                        + " reconciliation_cursor=?,reconciliation_event_id=?,reconciled_at=now()"
                        + " where consumer_name='analytics' and producer=?",
                    Timestamp.from(Instant.parse(event.occurredAt())),
                    event.eventId(),
                    producer);
              }
            });
      } catch (Exception e) {
        org.slf4j.LoggerFactory.getLogger(getClass())
            .warn("projection_reconcile_failed producer={} category=SOURCE_UNAVAILABLE", producer);
      }
  }
}
