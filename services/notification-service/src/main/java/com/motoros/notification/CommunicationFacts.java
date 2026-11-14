package com.motoros.notification;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.foundation.events.*;
import com.motoros.security.Permission;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.server.ResponseStatusException;

@Component
class CommunicationFacts {
  enum Purpose {
    APPOINTMENT_CONFIRMATION("booking", "AppointmentConfirmed", "booking-confirmed"),
    APPOINTMENT_REMINDER("booking", "AppointmentConfirmed", "appointment-reminder"),
    APPOINTMENT_RESCHEDULE("booking", "AppointmentRescheduled", "booking-rescheduled"),
    VEHICLE_CHECKED_IN("workorder", "VehicleCheckedIn", "vehicle-checked-in"),
    INSPECTION_COMPLETED("workorder", "InspectionCompleted", "inspection-completed"),
    ESTIMATE_APPROVAL("billing", "EstimateSubmitted", "estimate-awaiting-approval"),
    ESTIMATE_EXPLANATION("billing", "EstimateApproved", "estimate-explanation"),
    REPAIR_PROGRESS("workorder", "WorkOrderStatusChanged", "repair-progress"),
    READY_FOR_COLLECTION("workorder", "VehicleReadyForDelivery", "ready-for-collection"),
    INVOICE_AVAILABLE("billing", "InvoiceIssued", "invoice-available"),
    PAYMENT_CONFIRMATION("billing", "PaymentRecorded", "payment-recorded"),
    SERVICE_FOLLOW_UP("workorder", "VehicleDelivered", "service-completed"),
    MAINTENANCE_REMINDER("workorder", "VehicleDelivered", "maintenance-reminder");

    final String producer;
    final String event;
    final String template;

    Purpose(String producer, String event, String template) {
      this.producer = producer;
      this.event = event;
      this.template = template;
    }

    Permission readPermission() {
      return switch (this) {
        case APPOINTMENT_CONFIRMATION, APPOINTMENT_REMINDER, APPOINTMENT_RESCHEDULE ->
            Permission.BOOKING_READ;
        case ESTIMATE_APPROVAL, ESTIMATE_EXPLANATION -> Permission.ESTIMATE_READ;
        case INVOICE_AVAILABLE, PAYMENT_CONFIRMATION -> Permission.INVOICE_READ;
        default -> Permission.WORKORDER_READ;
      };
    }

    boolean optional() {
      return this == MAINTENANCE_REMINDER;
    }
  }

  enum Channel { EMAIL, SMS, WHATSAPP }
  enum Tone { PROFESSIONAL, FRIENDLY, CONCISE }
  enum Language { en, ta }

  record Verified(Map<String, String> facts, String recipient, String approvalBody) {
    String fingerprint() {
      // Bind the preview to both the facts and recipient while keeping the contact out of the API.
      return EventStore.hash(List.of(new TreeMap<>(facts), recipient));
    }
  }

  private final EventGateway gateway;

  CommunicationFacts(EventGateway gateway) {
    this.gateway = gateway;
  }

  EventEnvelope source(Purpose purpose, UUID tenant, UUID branch, UUID resource) {
    var proof = proof(purpose, tenant, branch, resource, purpose.event);
    var source = EventEnvelope.read(Records.json(proof.get("event")));
    if (purpose == Purpose.APPOINTMENT_REMINDER
        && !NotificationPolicy.current(source, proof, purpose.template)) {
      proof = proof(purpose, tenant, branch, resource, "AppointmentRescheduled");
      source = EventEnvelope.read(Records.json(proof.get("event")));
    }
    if (!source.tenantId().equals(tenant) || !branch.equals(source.branchId())
        || !purpose.producer.equals(source.producer()) || !supports(purpose, source)
        || (!resource.equals(source.aggregateId())
            && !resource.toString().equals(source.payload().get("workOrderId"))))
      throw new ResponseStatusException(FORBIDDEN, "Source is outside the requested scope");
    return source;
  }

  private Map<String, Object> proof(Purpose purpose, UUID tenant, UUID branch, UUID resource,
                                    String eventType) {
    var selected = gateway.get(purpose.producer, "/api/automation/communication-source?branchId="
        + branch + "&resourceId=" + resource + "&eventType=" + eventType, tenant);
    return gateway.get(purpose.producer,
        "/api/automation/event-proof/" + Records.uuid(selected.get("eventId")), tenant);
  }

  private static boolean supports(Purpose purpose, EventEnvelope event) {
    return purpose.event.equals(event.eventType()) || (purpose == Purpose.APPOINTMENT_REMINDER
        && event.eventType().equals("AppointmentRescheduled"));
  }
  Verified resolve(EventEnvelope event, Purpose purpose, UUID customer, UUID vehicle, Channel channel) {
    var proof = gateway.proof(event);
    if (proof.get("current") == null)
      throw new ResponseStatusException(CONFLICT, "Source record is unavailable");
    var current = Records.object(proof.get("current"));
    if (!validSource(purpose, event, proof, current))
      throw new ResponseStatusException(CONFLICT, "Source status or appointment time changed");
    if (!matches(current.get("customerId"), event.payload().get("customerId"), customer)
        || !matches(current.get("vehicleId"), event.payload().get("vehicleId"), vehicle))
      throw new ResponseStatusException(CONFLICT, "The selected customer or vehicle does not match the source");
    Map<String, Object> preferences;
    try {
      preferences = gateway.get("customer", "/api/automation/communication-context?customerId="
          + customer + "&eventId=" + event.eventId() + "&producer=" + event.producer()
          + "&verifyVehicle=true", event.tenantId());
    } catch (HttpClientErrorException denied) {
      throw new ResponseStatusException(CONFLICT, "Customer or current vehicle ownership is unavailable");
    }
    if (!customer.toString().equals(String.valueOf(preferences.get("customerId")))
        || !vehicle.toString().equals(preferences.get("vehicleId"))
        || !NotificationPolicy.allowed(preferences, channel.name(), purpose.optional()))
      throw new ResponseStatusException(CONFLICT, "Customer preferences do not allow this message");
    String recipient = Objects.toString(preferences.get(channel == Channel.EMAIL ? "email" : "phone"), "");
    if (recipient.isBlank())
      throw new ResponseStatusException(CONFLICT, "No verified recipient is available for this channel");
    String approvalBody = null;
    if (purpose == Purpose.ESTIMATE_APPROVAL) {
      approvalBody = Objects.toString(proof.get("approvalBody"), "").lines()
          .map(String::strip)
          .filter(line -> (line.startsWith("https://") || line.startsWith("http://127.0.0.1:"))
              && line.contains("/approval#token=")
              && line.endsWith("&tenant=" + event.tenantId() + "&estimate=" + event.aggregateId()))
          .findFirst().orElse("");
      if (channel != Channel.EMAIL || approvalBody.isBlank()
          || !recipient.equalsIgnoreCase(Objects.toString(proof.get("approvalRecipient"), "")))
        throw new ResponseStatusException(CONFLICT, "A current secure Billing approval email is required");
    }

    var facts = new TreeMap<String, String>();
    put(facts, "customerName", preferences.get("customerName"));
    put(facts, "vehicleRegistration", preferences.get("registration"));
    put(facts, "sourceStatus", current.getOrDefault("appointmentStatus",
        current.getOrDefault("status", current.getOrDefault("jobStatus", current.get("recordType")))));
    if (purpose.producer.equals("booking")) {
      put(facts, "appointmentTime", current.get("requestedStartTime"));
      put(facts, "appointmentZone", current.get("branchTimezone"));
    }
    if (Set.of(Purpose.ESTIMATE_APPROVAL, Purpose.ESTIMATE_EXPLANATION,
        Purpose.INVOICE_AVAILABLE, Purpose.PAYMENT_CONFIRMATION).contains(purpose)) {
      put(facts, "amount", current.getOrDefault("total", current.get("amount")));
      put(facts, "currency", current.get("currency"));
      put(facts, "invoiceNumber", current.get("invoiceNumber"));
      put(facts, "estimateRevision", current.get("revision"));
    }
    return new Verified(facts, recipient, approvalBody);
  }

  private static boolean matches(Object current, Object historical, UUID expected) {
    String id = expected.toString();
    return id.equals(String.valueOf(current == null ? historical : current))
        && (historical == null || id.equals(historical.toString()));
  }

  static boolean validSource(Purpose purpose, EventEnvelope event, Map<String, Object> proof,
                             Map<String, Object> current) {
    if (current == null || !purpose.producer.equals(event.producer())
        || !supports(purpose, event)
        || !event.branchId().toString().equals(String.valueOf(current.get("branchId")))) return false;
    String status = Objects.toString(current.get("status"), "");
    String appointment = Objects.toString(current.get("appointmentStatus"), "");
    return switch (purpose) {
      case APPOINTMENT_CONFIRMATION, APPOINTMENT_REMINDER ->
          appointment.equals("CONFIRMED") && NotificationPolicy.current(event, proof, purpose.template);
      case APPOINTMENT_RESCHEDULE -> NotificationPolicy.current(event, proof, purpose.template);
      case VEHICLE_CHECKED_IN -> current.get("jobStatus") != null
          && !Set.of("CANCELLED", "DELIVERED", "CLOSED").contains(current.get("jobStatus"));
      case INSPECTION_COMPLETED -> status.equals("COMPLETED")
          && !"CANCELLED".equals(current.get("jobStatus"));
      case ESTIMATE_APPROVAL -> NotificationPolicy.current(event, proof, purpose.template);
      case ESTIMATE_EXPLANATION -> Boolean.TRUE.equals(current.get("approvalValid"));
      case REPAIR_PROGRESS, READY_FOR_COLLECTION -> NotificationPolicy.current(event, proof, purpose.template);
      case INVOICE_AVAILABLE -> status.equals("ISSUED");
      case PAYMENT_CONFIRMATION -> "PAYMENT".equals(current.get("recordType"));
      case SERVICE_FOLLOW_UP, MAINTENANCE_REMINDER -> Set.of("DELIVERED", "CLOSED").contains(status);
    };
  }

  private static void put(Map<String, String> facts, String key, Object value) {
    if (value != null) facts.put(key, value.toString().replaceAll("[\\p{Cntrl}]", " ").strip());
  }

  static Map<String, Object> render(Map<String, Object> template, Verified verified,
                                    Language language, Tone tone, boolean details) {
    var facts = verified.facts();
    boolean tamil = language == Language.ta;
    var lines = new ArrayList<String>();
    if (tone != Tone.CONCISE) {
      String salutation = tamil ? (tone == Tone.FRIENDLY ? "அன்புள்ள " : "வணக்கம் ")
          : (tone == Tone.FRIENDLY ? "Hi " : "Dear ");
      lines.add(salutation + facts.get("customerName") + ",\n");
    }
    lines.add(template.get("body").toString());
    if (details) {
      lines.add((tamil ? "வாகனப் பதிவு: " : "Vehicle registration: ") + facts.get("vehicleRegistration"));
      if (facts.containsKey("appointmentTime")) {
        ZoneId zone = ZoneId.of(facts.getOrDefault("appointmentZone", "UTC"));
        String when = DateTimeFormatter.ofPattern("dd-MM-uuuu HH:mm VV").format(
            Instant.parse(facts.get("appointmentTime")).atZone(zone));
        lines.add((tamil ? "முன்பதிவு நேரம்: " : "Appointment time: ") + when);
      }
      if (facts.containsKey("amount") && facts.containsKey("currency"))
        lines.add((tamil ? "பதிவான தொகை: " : "Recorded amount: ")
            + facts.get("currency") + " " + facts.get("amount"));
      if (facts.containsKey("invoiceNumber"))
        lines.add((tamil ? "விலைப்பட்டியல் எண்: " : "Invoice number: ") + facts.get("invoiceNumber"));
    }
    if (tone == Tone.FRIENDLY) lines.add(tamil ? "\nநன்றி!" : "\nThank you!");
    return Map.of("subject", template.get("subject"), "body", String.join("\n", lines),
        "verifiedFacts", facts);
  }
}
