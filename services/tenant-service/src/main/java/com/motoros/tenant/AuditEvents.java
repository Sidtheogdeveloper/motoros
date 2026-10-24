package com.motoros.tenant;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.*;

@Service
public class AuditEvents {
  private final JdbcTemplate db;
  private final TransactionTemplate separate;

  AuditEvents(JdbcTemplate db, PlatformTransactionManager tx) {
    this.db = db;
    separate = new TransactionTemplate(tx);
    separate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public void record(
      UUID actor, UUID tenant, UUID branch, String action, Object target, String outcome) {
    String correlation = UUID.randomUUID().toString();
    var attrs = RequestContextHolder.getRequestAttributes();
    if (attrs instanceof ServletRequestAttributes request) {
      Object id = request.getRequest().getAttribute("correlationId");
      if (id != null) correlation = id.toString();
    }
    db.update(
        "insert into"
            + " tenant.audit_events(id,actor_id,tenant_id,branch_id,action,target_id,outcome,correlation_id)"
            + " values(?,?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        actor,
        tenant,
        branch,
        action,
        String.valueOf(target),
        outcome,
        correlation);
  }

  public void denied(UUID actor, UUID tenant, String action) {
    separate.executeWithoutResult(s -> record(actor, tenant, null, action, tenant, "DENIED"));
  }
}
