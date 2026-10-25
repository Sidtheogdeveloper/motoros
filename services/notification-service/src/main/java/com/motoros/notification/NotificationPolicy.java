package com.motoros.notification;

import com.motoros.foundation.Records;
import com.motoros.foundation.events.EventEnvelope;
import java.time.*;
import java.util.*;

public final class NotificationPolicy {
  private NotificationPolicy() {}

  public static String template(EventEnvelope e) {
    return switch (e.eventType()) {
      case "AppointmentConfirmed" -> "booking-confirmed";
      case "AppointmentRescheduled" -> "booking-rescheduled";
      case "AppointmentCancelled" -> "booking-cancelled";
      case "AppointmentReminderDue" -> "appointment-reminder";
      case "VehicleCheckedIn" -> "vehicle-checked-in";
      case "InspectionCompleted" -> "inspection-completed";
      case "EstimateSubmitted" -> "estimate-awaiting-approval";
      case "EstimateApproved" -> "estimate-approved";
      case "WorkOrderStatusChanged" -> "repair-progress";
      case "WorkOrderCompleted" -> "repair-completed";
      case "VehicleReadyForDelivery" -> "ready-for-collection";
      case "VehicleDelivered" -> "service-completed";
      case "InvoiceIssued" -> "invoice-available";
      case "PaymentRecorded" -> "payment-recorded";
      default -> null;
    };
  }

  public static boolean current(EventEnvelope e, Map<String, Object> context, String template) {
    var current =
        context.containsKey("current")
            ? Records.object(context.get("current"))
            : Map.<String, Object>of();
    String status =
        Objects.toString(current.getOrDefault("appointmentStatus", current.get("status")), "");
    if (e.producer().equals("booking")) {
      if (template.equals("booking-cancelled")) return status.equals("CANCELLED");
      if (!Set.of("REQUESTED", "CONFIRMED").contains(status)) return false;
      if (e.payload().get("startsAt") != null
          && current.get("requestedStartTime") != null
          && !Instant.parse(e.payload().get("startsAt").toString())
              .equals(Instant.parse(current.get("requestedStartTime").toString()))) return false;
      return current.get("requestedStartTime") != null
          && Instant.parse(current.get("requestedStartTime").toString()).isAfter(Instant.now());
    }
    if (template.startsWith("estimate-awaiting") || template.equals("estimate-reminder"))
      return status.equals("PENDING_CUSTOMER_APPROVAL")
          && current.get("expiresAt") != null
          && Instant.parse(current.get("expiresAt").toString()).isAfter(Instant.now());
    if (template.equals("ready-for-collection") || template.equals("collection-reminder"))
      return status.equals("READY_FOR_DELIVERY");
    if (template.equals("outstanding-payment-reminder"))
      return status.equals("ISSUED")
          && new java.math.BigDecimal(Objects.toString(current.get("outstanding"), "0")).signum()
              > 0;
    if (template.equals("repair-progress"))
      return Objects.toString(e.payload().get("status"), "").equals(status)
          && Set.of("INSPECTION", "IN_PROGRESS", "QUALITY_CHECK").contains(status);
    return !status.equals("CANCELLED");
  }

  public static boolean allowed(Map<String, Object> preferences, String channel, boolean optional) {
    return Boolean.TRUE.equals(preferences.get("operationalEnabled"))
        && Boolean.TRUE.equals(
            preferences.get(
                switch (channel) {
                  case "EMAIL" -> "emailEnabled";
                  case "SMS" -> "smsEnabled";
                  case "WHATSAPP" -> "whatsappEnabled";
                  default -> "invalid";
                }))
        && (!optional || Boolean.TRUE.equals(preferences.get("promotionalEnabled")));
  }
}
