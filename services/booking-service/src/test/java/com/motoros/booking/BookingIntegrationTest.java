package com.motoros.booking;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class BookingIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  static final UUID owner = UUID.randomUUID(),
      vehicle = UUID.randomUUID(),
      actor = UUID.randomUUID();
  static final HttpServer references;
  static final java.util.concurrent.atomic.AtomicBoolean failIntake =
      new java.util.concurrent.atomic.AtomicBoolean(true);
  static volatile String terminal = "DELIVERED";

  static {
    try {
      references = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      references.createContext(
          "/api/",
          e -> {
            var hours = new HashMap<String, Object>();
            for (var day : DayOfWeek.values())
              hours.put(day.name(), Map.of("open", "00:00", "close", "23:59"));
            Object result =
                e.getRequestURI().getPath().contains("branches")
                    ? Map.of(
                        "status",
                        "ACTIVE",
                        "timezone",
                        "UTC",
                        "settings",
                        Map.of("appointmentCapacity", 2),
                        "operatingHours",
                        hours)
                    : e.getRequestURI().getPath().contains("vehicles")
                        ? Map.of(
                            "status",
                            "ACTIVE",
                            "customerId",
                            owner,
                            "registration",
                            "TN01M4001",
                            "make",
                            "Test",
                            "model",
                            "Car")
                        : Map.of("status", "ACTIVE", "name", "Test owner");
            byte[] body = Records.json(result).getBytes();
            e.getResponseHeaders().set("Content-Type", "application/json");
            e.sendResponseHeaders(200, body.length);
            e.getResponseBody().write(body);
            e.close();
          });
      references.createContext(
          "/api/check-ins",
          e -> {
            boolean fail = failIntake.getAndSet(false);
            byte[] body =
                (fail
                        ? "{}"
                        : Records.json(
                            Map.of(
                                "id",
                                "00000000-0000-0000-0000-000000000444",
                                "workOrderId",
                                "00000000-0000-0000-0000-000000000445")))
                    .getBytes();
            e.getResponseHeaders().set("Content-Type", "application/json");
            e.sendResponseHeaders(fail ? 503 : 200, body.length);
            e.getResponseBody().write(body);
            e.close();
          });
      references.createContext(
          "/api/work-orders/",
          e -> {
            byte[] body = Records.json(Map.of("status", terminal)).getBytes();
            e.getResponseHeaders().set("Content-Type", "application/json");
            e.sendResponseHeaders(200, body.length);
            e.getResponseBody().write(body);
            e.close();
          });
      references.start();
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add("motoros.workorder-url", () -> "http://127.0.0.1:" + references.getAddress().getPort());
    r.add("motoros.tenant-url", () -> "http://127.0.0.1:" + references.getAddress().getPort());
    r.add("motoros.customer-url", () -> "http://127.0.0.1:" + references.getAddress().getPort());
  }

  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate db;

  @org.springframework.test.context.bean.override.mockito.MockitoBean
  AuthorizationResolver resolver;

  @org.springframework.test.context.bean.override.mockito.MockitoBean ServiceTokens tokens;

  @BeforeEach
  void auth() {
    org.mockito.Mockito.when(tokens.token()).thenReturn("explicit-test-token");
    org.mockito.Mockito.when(
            resolver.resolve(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.nullable(Permission.class)))
        .thenAnswer(
            c -> {
              org.springframework.security.oauth2.jwt.Jwt j = c.getArgument(0);
              UUID t = c.getArgument(1);
              var branches =
                  j.getClaimAsStringList("branches").stream().map(UUID::fromString).toList();
              return new AuthorizationContext(
                  actor,
                  t,
                  "BRAND_OWNER",
                  true,
                  Arrays.stream(Permission.values()).map(Enum::name).toList(),
                  branches,
                  branches);
            });
  }

  RequestPostProcessor staff(UUID tenant, UUID branch) {
    return request -> {
      request.addHeader("X-MotorOS-Tenant", tenant.toString());
      return jwt()
          .jwt(
              j ->
                  j.issuer("https://identity.example.test/realm")
                      .subject(actor.toString())
                      .claim("scope", "motoros.api")
                      .claim("branches", List.of(branch.toString())))
          .postProcessRequest(request);
    };
  }

  String input(UUID branch, Instant start, Long version) {
    var out = new HashMap<String, Object>();
    out.put("branchId", branch);
    out.put("customerId", owner);
    out.put("vehicleId", vehicle);
    out.put("serviceCategoryId", "00000000-0000-0000-0000-000000000401");
    out.put("requestedStartTime", start.toString());
    out.put("estimatedDurationMinutes", 60);
    out.put("customerComplaint", "Inspect brakes");
    out.put("bookingSource", "STAFF");
    out.put("version", version);
    return Records.json(out);
  }

  Instant tomorrow() {
    return LocalDate.now(ZoneOffset.UTC).plusDays(1).atTime(10, 0).toInstant(ZoneOffset.UTC);
  }

  @Test
  void concurrentReservationsNeverExceedConfiguredCapacity() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID();
    var pool = Executors.newFixedThreadPool(6);
    try {
      var start = new CountDownLatch(1);
      var futures = new ArrayList<Future<Integer>>();
      for (int i = 0; i < 6; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return mvc.perform(
                          post("/api/appointments")
                              .with(staff(t, b))
                              .header("Idempotency-Key", UUID.randomUUID())
                              .contentType("application/json")
                              .content(input(b, tomorrow(), null)))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      start.countDown();
      var results = new ArrayList<Integer>();
      for (var f : futures) results.add(f.get(30, TimeUnit.SECONDS));
      assertEquals(2, results.stream().filter(s -> s == 201).count());
      assertEquals(4, results.stream().filter(s -> s == 409).count());
      assertEquals(
          2,
          db.queryForObject(
              "select count(*) from booking.appointment_capacity_reservations where tenant_id=? and"
                  + " active",
              Integer.class,
              t));
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void retryRescheduleCancelAndTenantIsolation() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID();
    String key = UUID.randomUUID().toString(), body = input(b, tomorrow(), null);
    var first =
        mvc.perform(
                post("/api/appointments")
                    .with(staff(t, b))
                    .header("Idempotency-Key", key)
                    .contentType("application/json")
                    .content(body))
            .andReturn()
            .getResponse();
    assertEquals(201, first.getStatus(), first.getContentAsString());
    String id = Records.object(first.getContentAsString()).get("id").toString();
    assertEquals(
        201,
        mvc.perform(
                post("/api/appointments")
                    .with(staff(t, b))
                    .header("Idempotency-Key", key)
                    .contentType("application/json")
                    .content(body))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from booking.appointments where tenant_id=?", Integer.class, t));
    assertEquals(
        404,
        mvc.perform(get("/api/appointments/" + id).with(staff(UUID.randomUUID(), b)))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        403,
        mvc.perform(get("/api/appointments/" + id).with(staff(t, UUID.randomUUID())))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        200,
        mvc.perform(
                post("/api/appointments/" + id + "/reschedule")
                    .with(staff(t, b))
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content(input(b, tomorrow().plusSeconds(7200), 0L)))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        200,
        mvc.perform(
                post("/api/appointments/" + id + "/cancel")
                    .with(staff(t, b))
                    .contentType("application/json")
                    .content("{\"version\":1,\"note\":\"Customer cancelled\"}"))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from booking.appointment_capacity_reservations where tenant_id=? and"
                + " active",
            Integer.class,
            t));
  }

  @Test
  void invalidTimeAndMissingKeyAreRejected() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID();
    assertEquals(
        400,
        mvc.perform(
                post("/api/appointments")
                    .with(staff(t, b))
                    .contentType("application/json")
                    .content(input(b, tomorrow(), null)))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        400,
        mvc.perform(
                post("/api/appointments")
                    .with(staff(t, b))
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content(input(b, Instant.now().minusSeconds(3600), null)))
            .andReturn()
            .getResponse()
            .getStatus());
  }

  @Test
  void intakeFailureRetainsRequestAndReconcilesWithoutDuplicateJob() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID();
    failIntake.set(true);
    String create =
        mvc.perform(
                post("/api/appointments")
                    .with(staff(t, b))
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content(input(b, tomorrow(), null)))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String id = Records.object(create).get("id").toString();
    assertEquals(
        200,
        mvc.perform(
                post("/api/appointments/" + id + "/confirm")
                    .with(staff(t, b))
                    .contentType("application/json")
                    .content("{\"version\":0,\"note\":\"Confirm intake\"}"))
            .andReturn()
            .getResponse()
            .getStatus());
    String key = UUID.randomUUID().toString();
    String body =
        Records.json(
            Map.of(
                "branchId",
                b,
                "vehicleId",
                vehicle,
                "customerId",
                owner,
                "odometerKilometers",
                1000,
                "complaints",
                "Test coordination",
                "serviceRequested",
                "Service"));
    assertEquals(
        503,
        mvc.perform(
                post("/api/appointments/" + id + "/check-in")
                    .with(staff(t, b))
                    .header("Idempotency-Key", key)
                    .contentType("application/json")
                    .content(body))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        "RETRY_REQUIRED",
        db.queryForObject(
            "select check_in_state from booking.appointments where id=?",
            String.class,
            UUID.fromString(id)));
    var resumed =
        mvc.perform(post("/api/appointments/" + id + "/reconcile").with(staff(t, b)))
            .andReturn()
            .getResponse();
    assertEquals(200, resumed.getStatus(), resumed.getContentAsString());
    assertEquals(
        "CHECKED_IN", Records.object(resumed.getContentAsString()).get("appointmentStatus"));
    assertEquals(
        409,
        mvc.perform(
                post("/api/appointments/" + id + "/check-in")
                    .with(staff(t, b))
                    .header("Idempotency-Key", key)
                    .contentType("application/json")
                    .content(body.replace("Test coordination", "Changed coordination")))
            .andReturn()
            .getResponse()
            .getStatus());
    terminal = "CANCELLED";
    var cancelled =
        mvc.perform(post("/api/appointments/" + id + "/reconcile").with(staff(t, b)))
            .andReturn()
            .getResponse();
    assertEquals(
        "CANCELLED", Records.object(cancelled.getContentAsString()).get("appointmentStatus"));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from booking.appointment_capacity_reservations where tenant_id=? and"
                + " active",
            Integer.class,
            t));
  }

  @AfterAll
  static void stop() {
    references.stop(0);
  }
}
