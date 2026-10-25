package com.motoros.foundation.events;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Restricted machine API: resolves only a committed event and its same-tenant owning resource. */
@RestController
public class EventSourceController {
  private final EventStore store;
  private final com.motoros.security.MachineClients machines;
  private final List<EventContextContributor> contributors;

  public EventSourceController(
      EventStore store,
      List<EventContextContributor> contributors,
      com.motoros.security.MachineClients machines) {
    this.store = store;
    this.machines = machines;
    this.contributors = contributors;
  }

  @GetMapping("/api/automation/reconciliation-events")
  public Map<String, Object> reconciliation(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam java.time.Instant after,
      @RequestParam UUID afterId) {
    String client = jwt.getClaimAsString("azp");
    if (client == null) client = jwt.getClaimAsString("client_id");
    client = machines.logical(client);
    if (!"motoros-analytics".equals(client)) throw new ResponseStatusException(FORBIDDEN);
    return Map.of(
        "content",
        store
            .db
            .queryForList(
                "select * from "
                    + store.schema
                    + ".outbox_events where aggregate_version is not null and"
                    + " (occurred_at,event_id)>(?,?) order by occurred_at,event_id limit 100",
                java.sql.Timestamp.from(after),
                afterId)
            .stream()
            .map(EventEnvelope::from)
            .toList());
  }

  @GetMapping("/api/automation/event-proof/{id}")
  public Map<String, Object> proof(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID id,
      @RequestHeader("X-MotorOS-Tenant") UUID tenant) {
    String client = jwt.getClaimAsString("azp");
    if (client == null) client = jwt.getClaimAsString("client_id");
    client = machines.logical(client);
    if (!Set.of(
            "motoros-notification", "motoros-analytics", "motoros-customer", "motoros-workorder")
        .contains(client)) throw new ResponseStatusException(FORBIDDEN);
    var row =
        new Records(store.db)
            .one(
                "select * from "
                    + store.schema
                    + ".outbox_events where event_id=? and tenant_id=? and aggregate_version is not"
                    + " null",
                id,
                tenant);
    var event = EventEnvelope.from(row);
    var out = new LinkedHashMap<String, Object>();
    out.put("event", event);
    Set<String> tables =
        Set.of(
            "appointments",
            "work_orders",
            "estimates",
            "invoices",
            "payments",
            "stock_reservations",
            "stock_transfers",
            "customers",
            "vehicles",
            "notification_requests");
    if (tables.contains(event.aggregateType())) {
      var records =
          store.db.queryForList(
              "select to_jsonb(x)::text body from "
                  + store.schema
                  + "."
                  + event.aggregateType()
                  + " x where tenant_id=? and id=?",
              tenant,
              event.aggregateId());
      if (!records.isEmpty()) {
        var raw = Records.object(records.getFirst().get("body"));
        var current = new LinkedHashMap<String, Object>();
        for (String name :
            List.of(
                "id",
                "tenant_id",
                "branch_id",
                "customer_id",
                "vehicle_id",
                "work_order_id",
                "invoice_id",
                "version",
                "status",
                "appointment_status",
                "requested_start_time",
                "expected_end_time",
                "revision",
                "expires_at",
                "record_type",
                "amount",
                "total",
                "currency")) if (raw.get(name) != null) current.put(name, raw.get(name));
        if (store.schema.equals("billing") && event.aggregateType().equals("estimates")) {
          var latest =
              store.db.queryForList(
                  "select id from billing.estimates where tenant_id=? and work_order_id=? order by"
                      + " created_at desc,id desc limit 1",
                  tenant,
                  Records.uuid(raw.get("work_order_id")));
          current.put(
              "approval_valid",
              "APPROVED".equals(raw.get("status"))
                  && !latest.isEmpty()
                  && event.aggregateId().equals(latest.getFirst().get("id"))
                  && java.time.Instant.parse(raw.get("expires_at").toString())
                      .isAfter(java.time.Instant.now()));
        }
        out.put("current", Records.dto(current));
      }
    }
    for (var contributor : contributors) contributor.contribute(event, client, out);
    return out;
  }
}
