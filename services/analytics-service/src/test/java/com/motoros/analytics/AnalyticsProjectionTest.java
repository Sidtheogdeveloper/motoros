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
}
