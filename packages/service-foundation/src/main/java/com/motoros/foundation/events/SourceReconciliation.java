package com.motoros.foundation.events;

import java.util.*;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Source-owned current snapshots repair pre-event data and missed producer hooks without sending
 * old notices.
 */
public class SourceReconciliation {
  private final EventStore store;
  private static final Map<String, List<String>> TABLES =
      Map.of(
          "booking",
          List.of("appointments"),
          "workorder",
          List.of("work_orders"),
          "inventory",
          List.of("stock_reservations"),
          "billing",
          List.of("estimates", "invoices", "payments"),
          "notification",
          List.of("notification_requests"));

  public SourceReconciliation(EventStore store) {
    this.store = store;
  }

  @Scheduled(fixedDelayString = "${motoros.events.source-reconcile-ms:60000}")
  public void reconcile() {
    for (String table : TABLES.getOrDefault(store.schema, List.of()))
      store.tx.executeWithoutResult(
          t -> {
            var rows =
                store.db.queryForList(
                    "select x.id,x.tenant_id,x.branch_id,to_jsonb(x)::text as"
                        + " source,md5(to_jsonb(x)::text) as fingerprint from "
                        + store.schema
                        + "."
                        + table
                        + " x left join "
                        + store.schema
                        + ".reconciliation_sources s on s.aggregate_type=? and"
                        + " s.tenant_id=x.tenant_id and s.aggregate_id=x.id where s.fingerprint is"
                        + " distinct from md5(to_jsonb(x)::text) order by x.id limit 25 for update"
                        + " of x skip locked",
                    table);
            for (var row : rows) {
              UUID id = UUID.randomUUID();
              store.db.update(
                  "insert into "
                      + store.schema
                      + ".outbox_events(event_id,event_type,tenant_id,branch_id,aggregate_id,aggregate_type,correlation_id,payload,actor_id,source_snapshot)"
                      + " values(?,'ProjectionSnapshot',?,?,?,?,?,'{}',?,?::jsonb)",
                  id,
                  row.get("tenant_id"),
                  row.get("branch_id"),
                  row.get("id"),
                  table,
                  UUID.randomUUID().toString(),
                  new UUID(0, 0),
                  row.get("source"));
              // Only the authenticated reconciliation feed reads these; they cannot trigger
              // historic mail.
              store.db.update(
                  "update "
                      + store.schema
                      + ".outbox_events set status='LEGACY_REQUIRES_RECONCILIATION' where"
                      + " event_id=?",
                  id);
              store.db.update(
                  "insert into "
                      + store.schema
                      + ".reconciliation_sources(aggregate_type,tenant_id,aggregate_id,fingerprint,event_id)"
                      + " values(?,?,?,?,?) on conflict(aggregate_type,tenant_id,aggregate_id) do"
                      + " update set"
                      + " fingerprint=excluded.fingerprint,event_id=excluded.event_id,updated_at=now()",
                  table,
                  row.get("tenant_id"),
                  row.get("id"),
                  row.get("fingerprint"),
                  id);
            }
          });
  }
}
