package com.motoros.foundation.events;

import com.motoros.foundation.Records;
import java.time.Instant;
import java.util.*;

/**
 * Transport contract. Aggregate versions are monotonically increasing source event sequence
 * numbers.
 */
public record EventEnvelope(
    UUID eventId,
    String eventType,
    int eventVersion,
    UUID tenantId,
    UUID branchId,
    String aggregateType,
    UUID aggregateId,
    long aggregateVersion,
    String occurredAt,
    String correlationId,
    UUID causationId,
    String producer,
    Map<String, Object> payload) {
  public static final Map<String, Set<String>> TYPES =
      Map.of(
          "tenant", Set.of("TenantCreated", "BranchCreated", "StaffInvited"),
          "customer", Set.of("CustomerRegistered", "VehicleRegistered", "VehicleUpdated"),
          "booking",
              Set.of(
                  "AppointmentBooked",
                  "AppointmentConfirmed",
                  "AppointmentRescheduled",
                  "AppointmentCancelled",
                  "AppointmentReminderDue"),
          "workorder",
              Set.of(
                  "VehicleCheckedIn",
                  "WorkOrderCreated",
                  "TechnicianAssigned",
                  "InspectionCompleted",
                  "WorkOrderStatusChanged",
                  "WorkOrderCompleted",
                  "VehicleReadyForDelivery",
                  "VehicleDelivered"),
          "inventory",
              Set.of(
                  "PartsReserved",
                  "PartsReservationFailed",
                  "PartsConsumed",
                  "PartReservationReleased",
                  "StockTransferRequested",
                  "StockTransferApproved",
                  "StockTransferDispatched",
                  "StockTransferReceived",
                  "StockTransferCancelled",
                  "StockTransferRejected",
                  "StockTransferInTransit",
                  "StockTransferStatusChanged",
                  "StockAdjusted",
                  "PartCatalogUpdated"),
          "billing",
              Set.of(
                  "EstimateCreated",
                  "EstimateRevised",
                  "EstimateDraftUpdated",
                  "EstimateSubmitted",
                  "EstimateApproved",
                  "EstimateRejected",
                  "EstimateExpired",
                  "EstimateCancelled",
                  "InvoiceDraftCreated",
                  "InvoiceIssued",
                  "PaymentRecorded",
                  "PaymentReconciled",
                  "PaymentRefunded",
                  "InvoiceCreditRecorded",
                  "CommercialSettingsUpdated"),
          "notification",
              Set.of("NotificationRequested", "NotificationSent", "NotificationFailed"));

  public EventEnvelope {
    if (eventId == null
        || tenantId == null
        || aggregateId == null
        || causationId == null
        || eventVersion != 1
        || aggregateVersion < 1
        || aggregateType == null
        || !aggregateType.matches("[a-z_]{1,80}")
        || correlationId == null
        || !correlationId.matches("[A-Za-z0-9-]{1,64}")
        || !(TYPES.getOrDefault(producer, Set.of()).contains(eventType)
            || ("ProjectionSnapshot".equals(eventType) && TYPES.containsKey(producer)))
        || payload == null
        || !aggregateId.toString().equals(String.valueOf(payload.get("resourceId"))))
      throw new IllegalArgumentException("INVALID_EVENT_CONTRACT");
    Instant.parse(occurredAt);
    if (!occurredAt.endsWith("Z") || payload.size() > 24)
      throw new IllegalArgumentException("INVALID_EVENT_CONTRACT");
    var allowed =
        Set.of(
            "resourceId",
            "customerId",
            "vehicleId",
            "workOrderId",
            "invoiceId",
            "estimateId",
            "partId",
            "status",
            "resourceVersion",
            "startsAt",
            "checkInAt",
            "completedAt",
            "amount",
            "currency",
            "quantity",
            "recordType",
            "revision",
            "sourceBranchId",
            "destinationBranchId",
            "channel",
            "templateKey");
    if (!allowed.containsAll(payload.keySet()))
      throw new IllegalArgumentException("UNSAFE_EVENT_PAYLOAD");
    var canonical = new TreeMap<String, Object>(payload);
    for (String decimal : List.of("amount", "quantity"))
      if (canonical.get(decimal) != null) canonical.put(decimal, canonical.get(decimal).toString());
    for (String key :
        List.of(
            "resourceId",
            "customerId",
            "vehicleId",
            "workOrderId",
            "invoiceId",
            "estimateId",
            "partId",
            "sourceBranchId",
            "destinationBranchId"))
      if (canonical.get(key) != null) UUID.fromString(canonical.get(key).toString());
    for (String key : List.of("amount", "quantity"))
      if (canonical.get(key) != null
          && !canonical.get(key).toString().matches("[0-9]{1,19}(?:\\.[0-9]{1,4})?"))
        throw new IllegalArgumentException("INVALID_DECIMAL_PAYLOAD");
    for (String key : List.of("resourceVersion", "revision"))
      if (canonical.get(key) != null && !canonical.get(key).toString().matches("[0-9]{1,19}"))
        throw new IllegalArgumentException("INVALID_VERSION_PAYLOAD");
    for (String key : List.of("startsAt", "checkInAt", "completedAt"))
      if (canonical.get(key) != null) Instant.parse(canonical.get(key).toString());
    payload = Collections.unmodifiableMap(canonical);
  }

  public static EventEnvelope read(String body) {
    try {
      return Records.JSON.readValue(body, EventEnvelope.class);
    } catch (Exception e) {
      throw new IllegalArgumentException("INVALID_EVENT_CONTRACT");
    }
  }

  public static EventEnvelope from(Map<String, Object> r) {
    return new EventEnvelope(
        Records.uuid(r.get("event_id")),
        r.get("canonical_type").toString(),
        ((Number) r.get("event_version")).intValue(),
        Records.uuid(r.get("tenant_id")),
        r.get("branch_id") == null ? null : Records.uuid(r.get("branch_id")),
        r.get("aggregate_type").toString(),
        Records.uuid(r.get("aggregate_id")),
        ((Number) r.get("aggregate_version")).longValue(),
        Records.instant(r.get("occurred_at")).toString(),
        r.get("correlation_id").toString(),
        Records.uuid(r.get("causation_id")),
        r.get("producer").toString(),
        Records.object(r.get("payload")));
  }
}
