package com.motoros.analytics;

import static org.junit.jupiter.api.Assertions.*;

import com.motoros.foundation.events.*;
import java.time.Instant;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
class AnalyticsProjectionTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  static EventStore store;
  static AnalyticsConsumer consumer;
  UUID tenant = UUID.randomUUID(), branch = UUID.randomUUID(), aggregate = UUID.randomUUID();

  @BeforeAll
  static void setup() {
    var ds =
        new DriverManagerDataSource(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    Flyway.configure()
        .dataSource(ds)
        .schemas("analytics")
        .defaultSchema("analytics")
        .locations("classpath:db/migration")
        .load()
        .migrate();
    store = new EventStore(new JdbcTemplate(ds), new DataSourceTransactionManager(ds), "analytics");
    consumer = new AnalyticsConsumer(store);
  }

  EventEnvelope event(long version, String status) {
    return new EventEnvelope(
        UUID.randomUUID(),
        "WorkOrderStatusChanged",
        1,
        tenant,
        branch,
        "work_orders",
        aggregate,
        version,
        Instant.now().toString(),
        UUID.randomUUID().toString(),
        UUID.randomUUID(),
        "workorder",
        Map.of("resourceId", aggregate.toString(), "status", status));
  }

  @Test
  void reorderedOlderEventCannotOverwriteNewerSnapshot() {
    var newer = event(8, "QUALITY_CHECK");
    var older = event(7, "IN_PROGRESS");
    store.inbox("analytics", newer, () -> consumer.handle(newer, Map.of()));
    store.inbox("analytics", older, () -> consumer.handle(older, Map.of()));
    assertEquals(
        "QUALITY_CHECK",
        store.db.queryForObject(
            "select snapshot->>'status' from analytics.aggregate_projections where tenant_id=? and"
                + " aggregate_id=?",
            String.class,
            tenant,
            aggregate));
  }

  @Test
  void reconciliationRepairsLostProjectionWithoutDuplicatingBusinessRecords() {
    var e = event(3, "DELIVERED");
    store.inbox("analytics", e, () -> consumer.handle(e, Map.of()));
    store.db.update(
        "delete from analytics.aggregate_projections where tenant_id=? and aggregate_id=?",
        tenant,
        aggregate);
    consumer.handle(e, Map.of());
    consumer.handle(e, Map.of());
    assertEquals(
        1,
        store.db.queryForObject(
            "select count(*) from analytics.aggregate_projections where tenant_id=? and"
                + " aggregate_id=?",
            Integer.class,
            tenant,
            aggregate));
  }

  @Test
  void duplicatePaymentOnlyProjectsOneCollection() {
    UUID id = UUID.randomUUID();
    var e =
        new EventEnvelope(
            UUID.randomUUID(),
            "PaymentRecorded",
            1,
            tenant,
            branch,
            "payments",
            id,
            1,
            Instant.now().toString(),
            UUID.randomUUID().toString(),
            UUID.randomUUID(),
            "billing",
            Map.of(
                "resourceId",
                id.toString(),
                "amount",
                "708.00",
                "currency",
                "INR",
                "recordType",
                "PAYMENT"));
    assertTrue(store.inbox("analytics", e, () -> consumer.handle(e, Map.of())));
    assertFalse(store.inbox("analytics", e, () -> consumer.handle(e, Map.of())));
    assertEquals(
        "708.00",
        store.db.queryForObject(
            "select recorded_payment_collections::text from analytics.branch_billing_metrics where"
                + " tenant_id=? and branch_id=?",
            String.class,
            tenant,
            branch));
  }

  private void project(UUID tenantId, UUID branchId, String producer, String type, UUID id,
                       Map<String, Object> snapshot) {
    store.db.update("""
        insert into analytics.aggregate_projections(tenant_id,branch_id,producer,aggregate_type,
          aggregate_id,aggregate_version,event_id,snapshot,occurred_at,updated_at)
        values(?,?,?,?,?,1,?,?::jsonb,now(),now()-interval '2 days')
        """, tenantId, branchId, producer, type, id, UUID.randomUUID(),
        com.motoros.foundation.Records.json(snapshot));
  }

  private org.springframework.security.oauth2.jwt.Jwt manager(String... permissions) {
    return org.springframework.security.oauth2.jwt.Jwt.withTokenValue("test")
        .header("alg", "none").claim("motorosAuthorized", true)
        .claim("tenant", tenant.toString()).claim("branches", List.of(branch.toString()))
        .claim("permissions", List.of(permissions)).build();
  }

  @Test
  @SuppressWarnings("unchecked")
  void fixedMetricQueriesHonorLedgerDatesScopeAndCurrency() {
    var invoice = UUID.randomUUID();
    var invoiceFields = Map.<String, Object>of(
        "status", "ISSUED", "amount", "100.10", "currency", "INR",
        "issuedAt", "2025-01-01T00:00:00Z");
    project(tenant, branch, "billing", "invoices", invoice, invoiceFields);
    project(UUID.randomUUID(), branch, "billing", "invoices", UUID.randomUUID(), invoiceFields);
    project(tenant, UUID.randomUUID(), "billing", "invoices", UUID.randomUUID(), invoiceFields);
    project(tenant, branch, "billing", "payments", UUID.randomUUID(), Map.of(
        "invoiceId", invoice.toString(), "amount", "90.20", "currency", "INR",
        "recordType", "PAYMENT", "paymentAt", "2025-01-02T00:00:00Z"));
    project(tenant, branch, "billing", "payments", UUID.randomUUID(), Map.of(
        "invoiceId", invoice.toString(), "amount", "0.30", "currency", "INR",
        "recordType", "REFUND", "paymentAt", "2025-01-03T00:00:00Z"));
    var controller = new MetricQueryController(store);
    var auth = manager("ANALYTICS_BRANCH_READ", "AI_ANALYTICS_USE");
    var start = java.time.LocalDate.parse("2025-01-01");
    var end = java.time.LocalDate.parse("2025-02-01");
    var values = Map.of(
        MetricQueryController.Metric.invoice_value, "100.10",
        MetricQueryController.Metric.collected_payments, "89.90",
        MetricQueryController.Metric.outstanding_balance, "10.20",
        MetricQueryController.Metric.unpaid_invoices, "1");
    for (var entry : values.entrySet()) {
      var result = controller.query(auth, entry.getKey(), MetricQueryController.Dimension.month,
          start, end, null, null);
      var rows = (List<Map<String, Object>>) result.get("rows");
      assertEquals(1, rows.size());
      assertEquals("2025-01", rows.getFirst().get("label"));
      assertEquals(entry.getValue(), rows.getFirst().get("value"));
      assertEquals(List.of(branch), result.get("staleBranchIds"));
    }
    assertEquals(List.of(), controller.query(auth, MetricQueryController.Metric.invoice_value,
        MetricQueryController.Dimension.total, end, end.plusMonths(1), null, null).get("rows"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
        () -> controller.query(auth, MetricQueryController.Metric.invoice_value,
            MetricQueryController.Dimension.total, start, end, List.of(UUID.randomUUID()), null));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
        () -> controller.query(manager("ANALYTICS_BRANCH_READ"), MetricQueryController.Metric.invoice_value,
            MetricQueryController.Dimension.total, start, end, null, null));
  }

  @Test
  @SuppressWarnings("unchecked")
  void scopedVisitAndCategoryQueriesUseBusinessDates() {
    var job = UUID.randomUUID();
    var category = UUID.randomUUID();
    String customer = UUID.randomUUID().toString();
    project(tenant, branch, "workorder", "work_orders", UUID.randomUUID(), Map.of(
        "customerId", customer, "completedAt", "2024-10-01T08:00:00Z"));
    project(tenant, branch, "workorder", "work_orders", job, Map.of(
        "customerId", customer, "checkInAt", "2025-01-01T08:00:00Z",
        "completedAt", "2025-01-01T09:15:00Z"));
    project(tenant, branch, "booking", "appointments", UUID.randomUUID(), Map.of(
        "workOrderId", job.toString(), "serviceCategoryId", category.toString(),
        "startsAt", "2025-01-01T08:00:00Z"));
    project(tenant, branch, "billing", "invoices", UUID.randomUUID(), Map.of(
        "workOrderId", job.toString(), "status", "ISSUED", "amount", "90.01",
        "currency", "INR", "issuedAt", "2025-01-01T09:30:00Z"));
    project(tenant, branch, "billing", "estimates", UUID.randomUUID(), Map.of(
        "status", "APPROVED", "decidedAt", "2025-01-01T09:30:00Z"));
    project(tenant, branch, "billing", "estimates", UUID.randomUUID(), Map.of(
        "status", "REJECTED", "decidedAt", "2025-01-01T09:30:00Z"));
    var controller = new MetricQueryController(store);
    var auth = manager("ANALYTICS_BRANCH_READ", "AI_ANALYTICS_USE");
    var values = Map.of(
        MetricQueryController.Metric.repeat_customer_rate, "100.00",
        MetricQueryController.Metric.average_turnaround, "75.00",
        MetricQueryController.Metric.estimate_approval_rate, "50.00",
        MetricQueryController.Metric.average_invoice_value, "90.01");
    for (var entry : values.entrySet()) {
      var group = entry.getKey() == MetricQueryController.Metric.average_invoice_value
          ? MetricQueryController.Dimension.service : MetricQueryController.Dimension.total;
      var result = controller.query(auth, entry.getKey(), group, java.time.LocalDate.parse("2025-01-01"),
          java.time.LocalDate.parse("2025-02-01"), null, null);
      var rows = (List<Map<String, Object>>) result.get("rows");
      assertEquals(entry.getValue(), rows.getFirst().get("value"));
      if (group == MetricQueryController.Dimension.service)
        assertEquals(category.toString(), rows.getFirst().get("label"));
    }
  }
}
