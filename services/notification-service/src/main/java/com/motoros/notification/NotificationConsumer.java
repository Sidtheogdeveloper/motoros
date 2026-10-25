package com.motoros.notification;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class NotificationConsumer implements EventHandler {
  final EventStore store;
  final EventGateway gateway;
  private final DeliveryCipher cipher;

  NotificationConsumer(EventStore store, EventGateway gateway, DeliveryCipher cipher) {
    this.store = store;
    this.gateway = gateway;
    this.cipher = cipher;
  }

  public String consumer() {
    return "notification";
  }

  public boolean accepts(EventEnvelope e) {
    return NotificationPolicy.template(e) != null;
  }

  public Map<String, Object> preferences(EventEnvelope e, Map<String, Object> context) {
    var current =
        context.containsKey("current")
            ? Records.object(context.get("current"))
            : Map.<String, Object>of();
    Object customer = current.getOrDefault("customerId", e.payload().get("customerId"));
    if (customer == null) return Map.of();
    return gateway.get(
        "customer",
        "/api/automation/communication-context?customerId="
            + customer
            + "&eventId="
            + e.eventId()
            + "&producer="
            + e.producer(),
        e.tenantId());
  }

  public void handle(EventEnvelope e, Map<String, Object> context) {
    String template = NotificationPolicy.template(e);
    if (template == null) return;
    if (Set.of(
            "AppointmentCancelled",
            "AppointmentRescheduled",
            "VehicleDelivered",
            "EstimateApproved",
            "EstimateRejected")
        .contains(e.eventType()))
      store.db.update(
          "update notification.scheduled_notifications set"
              + " status='CANCELLED',version=version+1,updated_at=now() where tenant_id=? and"
              + " related_resource_id=? and status='SCHEDULED'",
          e.tenantId(),
          e.aggregateId());
    var prefs = preferences(e, context);
    if (prefs.isEmpty()) return;
    enqueue(e, context, prefs, template);
    if (!NotificationPolicy.current(e, context, template)) return;
    if (e.eventType().equals("AppointmentConfirmed")
        || e.eventType().equals("AppointmentRescheduled")) {
      var current = Records.object(context.get("current"));
      Instant due =
          Instant.parse(current.get("requestedStartTime").toString()).minus(Duration.ofHours(24));
      schedule(
          e,
          prefs,
          "appointment-reminder",
          due.isBefore(Instant.now()) ? Instant.now().plusSeconds(2) : due);
    }
    if (e.eventType().equals("EstimateSubmitted"))
      schedule(e, prefs, "estimate-reminder", Instant.now().plus(Duration.ofHours(24)));
    if (e.eventType().equals("VehicleReadyForDelivery"))
      schedule(e, prefs, "collection-reminder", Instant.now().plus(Duration.ofHours(24)));
    if (e.eventType().equals("VehicleDelivered"))
      schedule(e, prefs, "maintenance-reminder", Instant.now().plus(Duration.ofDays(180)));
  }

  void schedule(EventEnvelope e, Map<String, Object> p, String template, Instant due) {
    store.db.update(
        "insert into"
            + " notification.scheduled_notifications(id,tenant_id,branch_id,customer_id,related_resource_id,source_event_id,source_envelope,template_key,due_at,status)"
            + " values(?,?,?,?,?,?,?::jsonb,?,?,'SCHEDULED') on conflict do nothing",
        UUID.randomUUID(),
        e.tenantId(),
        e.branchId(),
        Records.uuid(p.get("customerId")),
        e.aggregateId(),
        e.eventId(),
        Records.json(e),
        template,
        Timestamp.from(due));
  }

  void enqueue(
      EventEnvelope e, Map<String, Object> context, Map<String, Object> prefs, String template) {
    String language = Objects.toString(prefs.get("preferredLanguage"), "en");
    var row =
        new Records(store.db)
            .one(
                "select * from notification.notification_templates where template_key=? and"
                    + " language=?",
                template,
                language);
    boolean optional = Boolean.TRUE.equals(row.get("optional"));
    for (String channel : List.of("EMAIL", "SMS", "WHATSAPP")) {
      if (!NotificationPolicy.allowed(prefs, channel, optional)) continue;
      UUID id = UUID.randomUUID();
      boolean active = NotificationPolicy.current(e, context, template);
      String recipient =
          Objects.toString(prefs.get(channel.equals("EMAIL") ? "email" : "phone"), "");
      if (recipient.isBlank()) continue;
      String body = row.get("body").toString() + "\nReference: " + e.aggregateId();
      if (template.equals("estimate-awaiting-approval") && channel.equals("EMAIL")) {
        if (!recipient.equalsIgnoreCase(Objects.toString(context.get("approvalRecipient"), "")))
          throw new IllegalArgumentException("APPROVAL_RECIPIENT_MISMATCH");
        if (context.get("approvalBody") == null) {
          active = false;
        } else body = context.get("approvalBody").toString();
      }
      String subject =
          template.equals("estimate-awaiting-approval")
              ? "Review MotorOS estimate " + e.aggregateId()
              : row.get("subject").toString();
      int inserted =
          store.db.update(
              "insert into"
                  + " notification.notification_requests(id,tenant_id,branch_id,customer_id,channel,template_key,language,source_event_id,related_resource_id,source_envelope,encrypted_recipient,encrypted_content,status,last_error)"
                  + " values(?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?) on conflict do nothing",
              id,
              e.tenantId(),
              e.branchId(),
              Records.uuid(prefs.get("customerId")),
              channel,
              template,
              language,
              e.eventId(),
              e.aggregateId(),
              Records.json(e),
              cipher.encrypt(recipient),
              cipher.encrypt(Records.json(Map.of("subject", subject, "body", body))),
              active ? "QUEUED" : "CANCELLED",
              active ? null : "STALE_SOURCE");
      if (inserted == 1)
        store.append(
            e,
            id,
            "NotificationRequested",
            Map.of(
                "id",
                id,
                "customer_id",
                prefs.get("customerId"),
                "status",
                active ? "QUEUED" : "CANCELLED"));
    }
  }
}
