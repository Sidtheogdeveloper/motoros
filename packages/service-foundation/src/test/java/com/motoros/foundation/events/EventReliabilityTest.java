package com.motoros.foundation.events;

import static org.junit.jupiter.api.Assertions.*;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
class EventReliabilityTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  static JdbcTemplate db;
  static EventStore store;
  UUID tenant = UUID.randomUUID(),
      branch = UUID.randomUUID(),
      customer = UUID.randomUUID(),
      vehicle = UUID.randomUUID();

  @BeforeAll
  static void setup() {
    var ds =
        new DriverManagerDataSource(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    db = new JdbcTemplate(ds);
    store = new EventStore(db, new DataSourceTransactionManager(ds), "booking");
    Flyway.configure()
        .dataSource(ds)
        .defaultSchema("booking")
        .schemas("booking")
        .locations("filesystem:../../services/booking-service/src/main/resources/db/migration")
        .load()
        .migrate();
    db.execute("create table booking.test_effects(id uuid primary key,value int not null)");
  }

  @BeforeEach
  void clean() {
    db.execute("truncate booking.appointments cascade");
    db.execute(
        "truncate"
            + " booking.outbox_events,booking.event_aggregate_versions,booking.processed_events,booking.test_effects,booking.messaging_runtime_metadata,booking.reconciliation_sources");
  }

  UUID appointment() {
    UUID id = UUID.randomUUID();
    Instant start = Instant.now().plusSeconds(172800);
    db.update(
        "insert into"
            + " booking.appointments(id,tenant_id,branch_id,customer_id,vehicle_id,service_category_id,requested_start_time,expected_end_time,estimated_duration_minutes,customer_complaint,appointment_status,booking_source,registration,vehicle_model,customer_name,branch_timezone,created_by)"
            + " values(?,?,?,?,?,'00000000-0000-0000-0000-000000000401',?,?,60,'Synthetic"
            + " test','REQUESTED','STAFF','TEST123','Test vehicle','Test"
            + " customer','Asia/Kolkata',?)",
        id,
        tenant,
        branch,
        customer,
        vehicle,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(3600)),
        UUID.randomUUID());
    return id;
  }

  EventEnvelope event() {
    return EventEnvelope.from(
        db.queryForMap("select * from booking.outbox_events order by created_at,event_id limit 1"));
  }

  @Test
  void businessCommitAndRollbackAreAtomic() {
    store.tx.executeWithoutResult(
        t -> {
          appointment();
          t.setRollbackOnly();
        });
    assertEquals(0, db.queryForObject("select count(*) from booking.outbox_events", Integer.class));
    store.tx.executeWithoutResult(t -> appointment());
    assertEquals(1, db.queryForObject("select count(*) from booking.outbox_events", Integer.class));
    var event = event();
    assertEquals(tenant, event.tenantId());
    assertEquals(customer.toString(), event.payload().get("customerId"));
    assertFalse(event.payload().containsKey("customer_name"));
    assertEquals("AppointmentBooked", event.eventType());
  }

  @Test
  void independentPublishersClaimEachEventOnce() throws Exception {
    for (int i = 0; i < 20; i++) appointment();
    var pool = Executors.newFixedThreadPool(8);
    try {
      var jobs = new ArrayList<Callable<List<Map<String, Object>>>>();
      for (int i = 0; i < 8; i++) jobs.add(() -> store.claim(3, 45));
      var seen = new HashSet<UUID>();
      int total = 0;
      for (var f : pool.invokeAll(jobs))
        for (var row : f.get()) {
          total++;
          assertTrue(seen.add((UUID) row.get("event_id")));
        }
      assertEquals(20, total);
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void abandonedClaimIsRecoveredAndOldOwnerIsFenced() {
    appointment();
    var old = store.claim(1, 45).getFirst();
    db.update("update booking.outbox_events set lease_until=now()-interval '1 second'");
    var recovered = store.claim(1, 45).getFirst();
    assertNotEquals(old.get("claim_token"), recovered.get("claim_token"));
    assertFalse(store.published(old));
    assertTrue(store.published(recovered));
    assertEquals(2, db.queryForObject("select attempts from booking.outbox_events", Integer.class));
  }

  @Test
  void brokerFailureLeavesRetryableDurableRecord() {
    appointment();
    var row = store.claim(1, 45).getFirst();
    store.failed(row, "BROKER_UNAVAILABLE", false);
    assertEquals(
        "PENDING", db.queryForObject("select status from booking.outbox_events", String.class));
    assertTrue(store.claim(1, 45).isEmpty());
    db.update("update booking.outbox_events set next_attempt_at=now()-interval '1 second'");
    assertEquals(1, store.claim(1, 45).size());
  }

  @Test
  void duplicateAfterAcknowledgmentCrashAppliesOneEffect() {
    appointment();
    var e = event();
    UUID effect = UUID.randomUUID();
    Runnable handle = () -> db.update("insert into booking.test_effects values(?,1)", effect);
    assertTrue(store.inbox("test", e, handle));
    assertFalse(store.inbox("test", e, handle));
    assertEquals(1, db.queryForObject("select count(*) from booking.test_effects", Integer.class));
  }

  @Test
  void failedConsumerRollsBackInboxAndBusinessEffect() {
    appointment();
    var e = event();
    UUID id = UUID.randomUUID();
    assertThrows(
        IllegalStateException.class,
        () ->
            store.inbox(
                "test",
                e,
                () -> {
                  db.update("insert into booking.test_effects values(?,1)", id);
                  throw new IllegalStateException("simulated crash");
                }));
    assertEquals(
        0, db.queryForObject("select count(*) from booking.processed_events", Integer.class));
    assertEquals(0, db.queryForObject("select count(*) from booking.test_effects", Integer.class));
    assertTrue(
        store.inbox(
            "test", e, () -> db.update("insert into booking.test_effects values(?,1)", id)));
  }

  @Test
  void sameEventIdCannotBeReboundToAnotherTenant() {
    appointment();
    var e = event();
    store.inbox("test", e, () -> {});
    var spoof =
        new EventEnvelope(
            e.eventId(),
            e.eventType(),
            e.eventVersion(),
            UUID.randomUUID(),
            e.branchId(),
            e.aggregateType(),
            e.aggregateId(),
            e.aggregateVersion(),
            e.occurredAt(),
            e.correlationId(),
            e.causationId(),
            e.producer(),
            e.payload());
    assertThrows(
        IllegalArgumentException.class,
        () -> store.inbox("test", spoof, () -> fail("Cross-tenant side effect")));
  }

  @Test
  void invalidVersionProducerOrPersonalPayloadIsRejected() {
    appointment();
    String body = com.motoros.foundation.Records.json(event());
    assertThrows(
        IllegalArgumentException.class,
        () -> EventEnvelope.read(body.replace("\"eventVersion\":1", "\"eventVersion\":2")));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            EventEnvelope.read(
                body.replace("\"producer\":\"booking\"", "\"producer\":\"public-client\"")));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            EventEnvelope.read(
                body.replace("\"payload\":{", "\"payload\":{\"email\":\"private@example.test\",")));
  }

  @Test
  void aggregateSequenceIncreasesAndPayloadDoesNotContainComplaint() {
    UUID id = appointment();
    db.update(
        "update booking.appointments set appointment_status='CONFIRMED',version=version+1 where"
            + " id=?",
        id);
    var events = db.queryForList("select * from booking.outbox_events order by aggregate_version");
    assertEquals(2, events.size());
    assertEquals(2, EventEnvelope.from(events.getLast()).aggregateVersion());
    assertFalse(
        com.motoros.foundation.Records.json(EventEnvelope.from(events.getLast()))
            .contains("Synthetic test"));
  }

  @Test
  void localBrokerGenerationReplaysPublishedEventsOnlyOnce() {
    appointment();
    var row = store.claim(1, 45).getFirst();
    store.published(row);
    var broker = org.mockito.Mockito.mock(EventBroker.class);
    org.mockito.Mockito.when(broker.emulator()).thenReturn(true);
    org.mockito.Mockito.when(broker.localGeneration()).thenReturn("100");
    var worker =
        new EventWorker(
            store,
            broker,
            null,
            List.of(),
            new io.micrometer.core.instrument.simple.SimpleMeterRegistry(),
            io.micrometer.observation.ObservationRegistry.create(),
            true,
            false);
    worker.recoverLocalBroker();
    assertEquals(
        "PUBLISHED", db.queryForObject("select status from booking.outbox_events", String.class));
    org.mockito.Mockito.when(broker.localGeneration()).thenReturn("200");
    worker.recoverLocalBroker();
    assertEquals(
        "PENDING", db.queryForObject("select status from booking.outbox_events", String.class));
    var reclaimed = store.claim(1, 45).getFirst();
    store.published(reclaimed);
    worker.recoverLocalBroker();
    assertEquals(
        "PUBLISHED", db.queryForObject("select status from booking.outbox_events", String.class));
  }

  @Test
  void authoritativeBackfillIsAvailableWithoutSendingHistoricNotifications() {
    appointment();
    db.execute("delete from booking.outbox_events");
    new SourceReconciliation(store).reconcile();
    var snapshot = event();
    assertEquals("ProjectionSnapshot", snapshot.eventType());
    assertEquals(customer.toString(), snapshot.payload().get("customerId"));
    assertTrue(store.claim(10, 120).isEmpty());
    new SourceReconciliation(store).reconcile();
    assertEquals(1, db.queryForObject("select count(*) from booking.outbox_events", Integer.class));
  }
}
