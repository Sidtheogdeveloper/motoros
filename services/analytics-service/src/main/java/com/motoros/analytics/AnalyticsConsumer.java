package com.motoros.analytics;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class AnalyticsConsumer implements EventHandler {
  final EventStore store;

  AnalyticsConsumer(EventStore store) {
    this.store = store;
  }

  public String consumer() {
    return "analytics";
  }

  public boolean accepts(EventEnvelope e) {
    return Set.of("booking", "workorder", "billing", "inventory", "notification")
        .contains(e.producer());
  }

  public void handle(EventEnvelope e, Map<String, Object> proof) {
    // Payload is a source-verified snapshot. Higher sequence snapshots can bridge missing versions.
    store.db.update(
        "insert into"
            + " analytics.aggregate_projections(tenant_id,branch_id,producer,aggregate_type,aggregate_id,aggregate_version,event_id,snapshot,occurred_at)"
            + " values(?,?,?,?,?,?,?,?::jsonb,?) on"
            + " conflict(tenant_id,producer,aggregate_type,aggregate_id) do update set"
            + " branch_id=excluded.branch_id,aggregate_version=excluded.aggregate_version,event_id=excluded.event_id,snapshot=excluded.snapshot,occurred_at=excluded.occurred_at,updated_at=now()"
            + " where (aggregate_projections.aggregate_version<excluded.aggregate_version or"
            + " (aggregate_projections.aggregate_version=excluded.aggregate_version and"
            + " aggregate_projections.event_id=excluded.event_id))",
        e.tenantId(),
        e.branchId(),
        e.producer(),
        e.aggregateType(),
        e.aggregateId(),
        e.aggregateVersion(),
        e.eventId(),
        Records.json(e.payload()),
        Timestamp.from(Instant.parse(e.occurredAt())));
    store.db.update(
        "insert into"
            + " analytics.projection_checkpoints(consumer_name,producer,last_event_id,occurred_at)"
            + " values('analytics',?,?,?) on conflict(consumer_name,producer) do update set"
            + " last_event_id=case when projection_checkpoints.occurred_at<=excluded.occurred_at"
            + " then excluded.last_event_id else projection_checkpoints.last_event_id"
            + " end,occurred_at=greatest(projection_checkpoints.occurred_at,excluded.occurred_at),processed_at=now()",
        e.producer(),
        e.eventId(),
        Timestamp.from(Instant.parse(e.occurredAt())));
  }
}
