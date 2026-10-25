package com.motoros.notification;

import static org.junit.jupiter.api.Assertions.*;

import com.motoros.foundation.events.EventEnvelope;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class NotificationPolicyTest {
  private EventEnvelope booking(String type, String start) {
    UUID id = UUID.randomUUID();
    return new EventEnvelope(
        UUID.randomUUID(),
        type,
        1,
        UUID.randomUUID(),
        UUID.randomUUID(),
        "appointments",
        id,
        1,
        Instant.now().toString(),
        UUID.randomUUID().toString(),
        UUID.randomUUID(),
        "booking",
        Map.of("resourceId", id.toString(), "startsAt", start));
  }

  @Test
  void cancelledAndRescheduledAppointmentsDoNotSendStaleReminders() {
    String start = Instant.now().plusSeconds(172800).toString();
    var e = booking("AppointmentConfirmed", start);
    assertFalse(
        NotificationPolicy.current(
            e,
            Map.of(
                "current", Map.of("appointmentStatus", "CANCELLED", "requestedStartTime", start)),
            "appointment-reminder"));
    assertFalse(
        NotificationPolicy.current(
            e,
            Map.of(
                "current",
                Map.of(
                    "appointmentStatus",
                    "CONFIRMED",
                    "requestedStartTime",
                    Instant.now().plusSeconds(259200).toString())),
            "appointment-reminder"));
    assertTrue(
        NotificationPolicy.current(
            e,
            Map.of(
                "current", Map.of("appointmentStatus", "CONFIRMED", "requestedStartTime", start)),
            "appointment-reminder"));
  }

  @Test
  void customerOptOutAndPromotionalConsentAreIndependent() {
    var prefs =
        Map.<String, Object>of(
            "operationalEnabled", true, "emailEnabled", true, "promotionalEnabled", false);
    assertTrue(NotificationPolicy.allowed(prefs, "EMAIL", false));
    assertFalse(NotificationPolicy.allowed(prefs, "EMAIL", true));
    assertFalse(NotificationPolicy.allowed(prefs, "SMS", false));
    assertFalse(
        NotificationPolicy.allowed(
            Map.of("operationalEnabled", false, "emailEnabled", true), "EMAIL", false));
  }

  @Test
  void completedRepairIsNotReadyForCollection() {
    UUID id = UUID.randomUUID();
    var e =
        new EventEnvelope(
            UUID.randomUUID(),
            "WorkOrderCompleted",
            1,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "work_orders",
            id,
            2,
            Instant.now().toString(),
            UUID.randomUUID().toString(),
            UUID.randomUUID(),
            "workorder",
            Map.of("resourceId", id.toString(), "status", "QUALITY_CHECK"));
    assertEquals("repair-completed", NotificationPolicy.template(e));
    assertFalse(
        NotificationPolicy.current(
            e, Map.of("current", Map.of("status", "QUALITY_CHECK")), "ready-for-collection"));
  }

  @Test
  void expiredEstimateReminderIsCancelled() {
    UUID id = UUID.randomUUID();
    var e =
        new EventEnvelope(
            UUID.randomUUID(),
            "EstimateSubmitted",
            1,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "estimates",
            id,
            1,
            Instant.now().toString(),
            UUID.randomUUID().toString(),
            UUID.randomUUID(),
            "billing",
            Map.of("resourceId", id.toString()));
    assertFalse(
        NotificationPolicy.current(
            e,
            Map.of(
                "current",
                Map.of(
                    "status",
                    "PENDING_CUSTOMER_APPROVAL",
                    "expiresAt",
                    Instant.now().minusSeconds(1).toString())),
            "estimate-reminder"));
  }
}
