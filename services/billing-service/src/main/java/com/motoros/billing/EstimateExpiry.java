package com.motoros.billing;

import com.motoros.foundation.Records;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Expiry is a local business transaction, not an event transport or approval action. */
@Component
@EnableScheduling
public class EstimateExpiry {
  private final JdbcTemplate db;
  private static final UUID SYSTEM_ACTOR =
      UUID.nameUUIDFromBytes("motoros-billing:estimate-expiry:v1".getBytes(StandardCharsets.UTF_8));

  EstimateExpiry(JdbcTemplate db) {
    this.db = db;
  }

  @Scheduled(fixedDelayString = "${motoros.expiry-delay-ms:60000}")
  @Transactional
  public void expire() {
    var rows =
        db.queryForList(
            "select id,tenant_id,branch_id from billing.estimates where status in"
                + " ('DRAFT','PENDING_CUSTOMER_APPROVAL') and expires_at<now() order by"
                + " expires_at,id limit 100 for update skip locked");
    for (var row : rows) {
      UUID id = (UUID) row.get("id"),
          tenant = (UUID) row.get("tenant_id"),
          branch = (UUID) row.get("branch_id");
      String correlation = UUID.randomUUID().toString(),
          payload = Records.json(Map.of("estimateId", id, "origin", "SYSTEM_QUOTE_EXPIRY"));
      db.update(
          "update billing.estimates set status='EXPIRED',version=version+1,updated_at=now() where"
              + " tenant_id=? and id=?",
          tenant,
          id);
      db.update(
          "update billing.estimate_approvals set status='REVOKED' where tenant_id=? and"
              + " estimate_id=? and status='PENDING'",
          tenant,
          id);
      db.update(
          "insert into"
              + " billing.outbox_events(event_id,event_type,event_version,tenant_id,branch_id,aggregate_id,correlation_id,payload,actor_id)"
              + " values(?,'EstimateExpired',1,?,?,?,?,?::jsonb,?)",
          UUID.randomUUID(),
          tenant,
          branch,
          id,
          correlation,
          payload,
          SYSTEM_ACTOR);
      db.update(
          "insert into"
              + " billing.billing_audit_events(id,tenant_id,branch_id,aggregate_id,action,actor_id,correlation_id,payload)"
              + " values(?,?,?,?,'EstimateExpired',?,?,?::jsonb)",
          UUID.randomUUID(),
          tenant,
          branch,
          id,
          SYSTEM_ACTOR,
          correlation,
          payload);
    }
  }
}
