package com.motoros.notification;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.motoros.foundation.events.*;
import com.motoros.notification.CommunicationFacts.*;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class CommunicationFactsTest {
  private final UUID tenant = UUID.randomUUID();
  private final UUID branch = UUID.randomUUID();
  private final UUID customer = UUID.randomUUID();
  private final UUID vehicle = UUID.randomUUID();

  private EventEnvelope event(String type, String producer, String table, Map<String, Object> extra) {
    UUID resource = UUID.randomUUID();
    var facts = new java.util.HashMap<>(extra);
    facts.put("resourceId", resource.toString());
    facts.put("customerId", customer.toString());
    facts.put("vehicleId", vehicle.toString());
    return new EventEnvelope(UUID.randomUUID(), type, 1, tenant, branch, table, resource, 1,
        Instant.now().toString(), UUID.randomUUID().toString(), UUID.randomUUID(), producer, facts);
  }

  @Test
  void rescheduledAppointmentCannotReuseAnOldTime() {
    Instant starts = Instant.now().plusSeconds(3600);
    var event = event("AppointmentConfirmed", "booking", "appointments",
        Map.of("startsAt", starts.toString()));
    var current = Map.<String, Object>of("branchId", branch.toString(), "appointmentStatus", "CONFIRMED",
        "requestedStartTime", starts.plusSeconds(3600).toString());
    assertFalse(CommunicationFacts.validSource(Purpose.APPOINTMENT_REMINDER, event,
        Map.of("current", current), current));
  }

  @Test
  void invoiceAmountIsRenderedVerbatimAndOptionalDetailsCanBeRemoved() {
    EventGateway gateway = mock(EventGateway.class);
    var event = event("InvoiceIssued", "billing", "invoices", Map.of());
    when(gateway.proof(event)).thenReturn(Map.of("current", Map.of(
        "branchId", branch, "customerId", customer, "vehicleId", vehicle,
        "status", "ISSUED", "total", "120.49", "currency", "INR")));
    when(gateway.get(eq("customer"), contains("verifyVehicle=true"), eq(tenant)))
        .thenReturn(Map.of("customerId", customer, "vehicleId", vehicle.toString(),
            "customerName", "Synthetic customer", "registration", "TEST12",
            "email", "customer@example.test", "operationalEnabled", true, "emailEnabled", true));
    var facts = new CommunicationFacts(gateway);
    assertThrows(ResponseStatusException.class,
        () -> facts.resolve(event, Purpose.INVOICE_AVAILABLE, UUID.randomUUID(), vehicle, Channel.EMAIL));
    var verified = facts.resolve(event, Purpose.INVOICE_AVAILABLE, customer, vehicle, Channel.EMAIL);
    var template = Map.<String, Object>of("subject", "விலைப்பட்டியல்", "body", "விலைப்பட்டியல் வெளியிடப்பட்டது.");
    var full = CommunicationFacts.render(template, verified, Language.ta, Tone.FRIENDLY, true);
    assertTrue(full.get("body").toString().contains("INR 120.49"));
    assertTrue(full.get("body").toString().contains("அன்புள்ள Synthetic customer"));
    assertFalse(full.toString().contains("customer@example.test"));
    var concise = CommunicationFacts.render(template, verified, Language.ta, Tone.CONCISE, false);
    assertFalse(concise.get("body").toString().contains("120.49"));
  }

  @Test
  void approvalFingerprintIsIndependentOfFieldOrder() {
    var first = new java.util.LinkedHashMap<String, String>();
    first.put("status", "ISSUED");
    first.put("currency", "INR");
    var second = new java.util.LinkedHashMap<String, String>();
    second.put("currency", "INR");
    second.put("status", "ISSUED");
    assertEquals(new CommunicationFacts.Verified(first, "fixture@example.test", null).fingerprint(),
        new CommunicationFacts.Verified(second, "fixture@example.test", null).fingerprint());
  }
  @Test
  void refundCannotBeDescribedAsCustomerPayment() {
    var event = event("PaymentRecorded", "billing", "payments", Map.of());
    var current = Map.<String, Object>of("branchId", branch, "recordType", "REFUND");
    assertFalse(CommunicationFacts.validSource(Purpose.PAYMENT_CONFIRMATION, event,
        Map.of("current", current), current));
  }
}
