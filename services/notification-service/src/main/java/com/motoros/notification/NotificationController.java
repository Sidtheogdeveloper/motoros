package com.motoros.notification;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
  private final EventStore store;
  private final EventGateway gateway;
  private final NotificationConsumer consumer;

  NotificationController(EventStore store, EventGateway gateway, NotificationConsumer consumer) {
    this.store = store;
    this.gateway = gateway;
    this.consumer = consumer;
  }

  private void scope(Jwt j, UUID b, boolean write) {
    Access.require(j, write ? Permission.NOTIFICATION_MANAGE : Permission.NOTIFICATION_READ);
    Access.branch(j, b);
  }

  @GetMapping
  public Map<String, Object> list(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(required = false) UUID customerId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    scope(j, branchId, false);
    Records.page(page, size);
    String where =
        " where tenant_id=? and branch_id=? and (?='' or status=?) and (?::uuid is null or"
            + " customer_id=?)";
    Object[] args = {
      Access.tenant(j), branchId, status, status, customerId, customerId, size, page * size
    };
    return Records.page(
        store.db.queryForList(
            "select"
                + " id,tenant_id,branch_id,customer_id,channel,template_key,language,source_event_id,related_resource_id,status,attempt_count,provider_status,provider_message_id,created_at,sent_at,failed_at,last_error,version"
                + " from notification.notification_requests"
                + where
                + " order by created_at desc,id limit ? offset ?",
            args),
        store.db.queryForObject(
            "select count(*) from notification.notification_requests" + where,
            Long.class,
            Access.tenant(j),
            branchId,
            status,
            status,
            customerId,
            customerId),
        size);
  }

  @GetMapping("/templates")
  public List<Map<String, Object>> templates(@AuthenticationPrincipal Jwt j) {
    Access.require(j, Permission.NOTIFICATION_READ);
    return store
        .db
        .queryForList(
            "select template_key,language,subject,body,optional,version from"
                + " notification.notification_templates order by template_key,language")
        .stream()
        .map(Records::dto)
        .toList();
  }

  @GetMapping("/schedules")
  public Map<String, Object> schedules(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    scope(j, branchId, false);
    Records.page(page, size);
    return Records.page(
        store.db.queryForList(
            "select"
                + " id,customer_id,related_resource_id,source_event_id,template_key,due_at,status,version,created_at"
                + " from notification.scheduled_notifications where tenant_id=? and branch_id=?"
                + " order by due_at desc,id limit ? offset ?",
            Access.tenant(j),
            branchId,
            size,
            page * size),
        store.db.queryForObject(
            "select count(*) from notification.scheduled_notifications where tenant_id=? and"
                + " branch_id=?",
            Long.class,
            Access.tenant(j),
            branchId),
        size);
  }

  @GetMapping("/{id}/attempts")
  public List<Map<String, Object>> attempts(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    var row =
        new Records(store.db)
            .one(
                "select branch_id from notification.notification_requests where tenant_id=? and"
                    + " id=?",
                Access.tenant(j),
                id);
    scope(j, (UUID) row.get("branch_id"), false);
    return store
        .db
        .queryForList(
            "select attempt_number,category,provider_message_id,created_at from"
                + " notification.notification_attempts where notification_id=? order by"
                + " attempt_number",
            id)
        .stream()
        .map(Records::dto)
        .toList();
  }

  public record Action(
      @NotNull @Min(0) Long version, @NotBlank @Size(min = 10, max = 500) String reason) {}

  public record Reminder(
      @NotNull UUID sourceEventId,
      @NotBlank @Pattern(regexp = "booking|billing|workorder") String producer,
      @NotBlank
          @Pattern(
              regexp =
                  "appointment-reminder|estimate-reminder|collection-reminder|maintenance-reminder|outstanding-payment-reminder")
          String templateKey,
      @NotNull
          @org.springframework.format.annotation.DateTimeFormat(
              iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE_TIME)
          java.time.Instant dueAt,
      @NotBlank @Size(min = 10, max = 500) String reason) {}

  @PostMapping("/schedules")
  public Map<String, Object> schedule(
      @AuthenticationPrincipal Jwt j, @Valid @RequestBody Reminder input) {
    Access.require(j, Permission.NOTIFICATION_MANAGE);
    if (input.dueAt().isBefore(java.time.Instant.now())
        || input.dueAt().isAfter(java.time.Instant.now().plus(java.time.Duration.ofDays(365))))
      throw new ResponseStatusException(BAD_REQUEST, "Schedule must be within the next year");
    var proof =
        gateway.get(
            input.producer(),
            "/api/automation/event-proof/" + input.sourceEventId(),
            Access.tenant(j));
    var e = EventEnvelope.read(Records.json(proof.get("event")));
    Access.branch(j, e.branchId());
    var allowed =
        Map.of(
            "appointment-reminder",
            "booking",
            "estimate-reminder",
            "billing",
            "collection-reminder",
            "workorder",
            "maintenance-reminder",
            "workorder",
            "outstanding-payment-reminder",
            "billing");
    if (!allowed.get(input.templateKey()).equals(e.producer())
        || !NotificationPolicy.current(e, proof, input.templateKey()))
      throw new ResponseStatusException(CONFLICT, "Reminder does not match current source state");
    var prefs = consumer.preferences(e, proof);
    if (prefs.isEmpty())
      throw new ResponseStatusException(CONFLICT, "No verified communication context");
    return store.tx.execute(
        t -> {
          consumer.schedule(e, prefs, input.templateKey(), input.dueAt());
          store.db.update(
              "insert into"
                  + " notification.notification_audit(id,tenant_id,actor_id,action,reason,correlation_id)"
                  + " values(?,?,?,'REMINDER_SCHEDULED',?,?)",
              UUID.randomUUID(),
              Access.tenant(j),
              Access.user(j),
              input.reason(),
              Correlation.current());
          return Map.of("sourceEventId", e.eventId(), "status", "SCHEDULED");
        });
  }

  @PostMapping("/{id}/{action}")
  public Map<String, Object> action(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable String action,
      @Valid @RequestBody Action in) {
    if (!Set.of("retry", "cancel").contains(action)) throw new ResponseStatusException(BAD_REQUEST);
    return store.tx.execute(
        t -> {
          var row =
              new Records(store.db)
                  .one(
                      "select * from notification.notification_requests where tenant_id=? and id=?"
                          + " for update",
                      Access.tenant(j),
                      id);
          scope(j, (UUID) row.get("branch_id"), true);
          Records.version(row, in.version());
          if (action.equals("retry") && !row.get("status").equals("FAILED")
              || action.equals("cancel")
                  && !Set.of("PENDING", "APPROVED", "QUEUED", "FAILED").contains(row.get("status")))
            throw new ResponseStatusException(CONFLICT, "Notification state changed");
          store.db.update(
              "update notification.notification_requests set"
                  + " status=?,next_attempt_at=now(),version=version+1,updated_at=now() where id=?",
              action.equals("retry") ? "QUEUED" : "CANCELLED",
              id);
          store.db.update(
              "insert into"
                  + " notification.notification_audit(id,tenant_id,notification_id,actor_id,action,reason,correlation_id)"
                  + " values(?,?,?,?,?,?,?)",
              UUID.randomUUID(),
              Access.tenant(j),
              id,
              Access.user(j),
              action,
              in.reason(),
              Correlation.current());
          return Map.of("id", id, "action", action);
        });
  }

  @PostMapping("/schedules/{id}/cancel")
  public Map<String, Object> cancel(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Action in) {
    return store.tx.execute(
        t -> {
          var row =
              new Records(store.db)
                  .one(
                      "select * from notification.scheduled_notifications where tenant_id=? and"
                          + " id=? for update",
                      Access.tenant(j),
                      id);
          scope(j, (UUID) row.get("branch_id"), true);
          Records.version(row, in.version());
          if (!row.get("status").equals("SCHEDULED")) throw new ResponseStatusException(CONFLICT);
          store.db.update(
              "update notification.scheduled_notifications set"
                  + " status='CANCELLED',version=version+1,updated_at=now() where id=?",
              id);
          store.db.update(
              "insert into"
                  + " notification.notification_audit(id,tenant_id,actor_id,action,reason,correlation_id)"
                  + " values(?,?,?,'SCHEDULE_CANCELLED',?,?)",
              UUID.randomUUID(),
              Access.tenant(j),
              Access.user(j),
              in.reason(),
              Correlation.current());
          return Map.of("id", id, "status", "CANCELLED");
        });
  }
}
