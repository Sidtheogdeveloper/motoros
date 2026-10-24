package com.motoros.foundation;

import com.motoros.security.*;
import java.util.*;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Called only within the transaction that changes the business aggregate. No transport is implied.
 */
public final class Outbox {
  private Outbox() {}

  public static void append(
      Records r, String schema, Jwt j, UUID branch, UUID aggregate, String type, Object payload) {
    if (!Set.of("inventory", "billing").contains(schema)) throw new IllegalArgumentException();
    r.db.update(
        "insert into "
            + schema
            + ".outbox_events(event_id,event_type,event_version,tenant_id,branch_id,aggregate_id,correlation_id,payload,actor_id)"
            + " values(?,?,1,?,?,?,?,?::jsonb,?)",
        UUID.randomUUID(),
        type,
        Access.tenant(j),
        branch,
        aggregate,
        Correlation.current(),
        Records.json(payload),
        Access.user(j));
  }
}
