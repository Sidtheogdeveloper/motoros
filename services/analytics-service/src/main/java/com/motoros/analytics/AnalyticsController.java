package com.motoros.analytics;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import com.motoros.security.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {
  private final EventStore store;

  AnalyticsController(EventStore store) {
    this.store = store;
  }

  @GetMapping("/branch")
  public Map<String, Object> branch(@AuthenticationPrincipal Jwt j, @RequestParam UUID branchId) {
    Access.require(j, Permission.ANALYTICS_BRANCH_READ);
    Access.branch(j, branchId);
    UUID tenant = Access.tenant(j);
    var out = new LinkedHashMap<String, Object>();
    for (String kind : List.of("booking", "workorder", "billing"))
      out.put(
          kind,
          store
              .db
              .queryForList(
                  "select * from analytics.branch_"
                      + kind
                      + "_metrics where tenant_id=? and branch_id=?",
                  tenant,
                  branchId)
              .stream()
              .map(Records::dto)
              .toList());
    out.put(
        "parts",
        store.db.queryForList(
            "select coalesce(sum((snapshot->>'quantity')::numeric),0) as consumed_quantity from"
                + " analytics.aggregate_projections where tenant_id=? and branch_id=? and"
                + " producer='inventory' and aggregate_type='stock_reservations' and"
                + " snapshot->>'status'='CONSUMED'",
            tenant,
            branchId));
    out.put(
        "notifications",
        store.db.queryForList(
            "select snapshot->>'status' as status,count(*) as count from"
                + " analytics.aggregate_projections where tenant_id=? and branch_id=? and"
                + " producer='notification' group by snapshot->>'status'",
            tenant,
            branchId));
    var freshness =
        store
            .db
            .queryForList(
                "select max(occurred_at) as last_event_at,max(updated_at) as"
                    + " projected_at,extract(epoch from(now()-max(updated_at))) as"
                    + " seconds_since_projection from analytics.aggregate_projections where"
                    + " tenant_id=? and branch_id=?",
                tenant,
                branchId)
            .getFirst();
    out.put("freshness", Records.dto(freshness));
    out.put("asOf", java.time.Instant.now().toString());
    out.put("consistency", "EVENTUALLY_CONSISTENT");
    out.put(
        "collectionsDefinition",
        "Manually recorded payments less recorded refunds; invoice issuance is reported"
            + " separately.");
    return out;
  }

  @GetMapping("/projections")
  public Map<String, Object> projections(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.ANALYTICS_BRANCH_READ);
    Access.branch(j, branchId);
    Records.page(page, size);
    return Records.page(
        store.db.queryForList(
            "select"
                + " producer,aggregate_type,aggregate_id,aggregate_version,event_id,occurred_at,updated_at"
                + " from analytics.aggregate_projections where tenant_id=? and branch_id=? order by"
                + " updated_at desc,aggregate_id limit ? offset ?",
            Access.tenant(j),
            branchId,
            size,
            page * size),
        store.db.queryForObject(
            "select count(*) from analytics.aggregate_projections where tenant_id=? and"
                + " branch_id=?",
            Long.class,
            Access.tenant(j),
            branchId),
        size);
  }
}
