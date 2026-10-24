package com.motoros.workorder;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class WorkOrderIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  // Test-only Customer API contract server. Full cross-service isolation is tested by
  // isolation.mjs.
  static final HttpServer customer;
  static final Set<String> inactiveVehicles = java.util.concurrent.ConcurrentHashMap.newKeySet();

  static {
    try {
      customer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      customer.createContext(
          "/api/vehicles/",
          exchange -> {
            byte[] body =
                ("{\"status\":\""
                        + (inactiveVehicles.contains(exchange.getRequestURI().getPath())
                            ? "INACTIVE"
                            : "ACTIVE")
                        + "\"}")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
          });
      customer.createContext(
          "/api/branches/",
          exchange -> {
            byte[] body = "{\"status\":\"ACTIVE\",\"settings\":{}}".getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
          });
      customer.createContext(
          "/api/staff/",
          exchange -> {
            byte[] body = "{}".getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
          });
      customer.start();
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  @AfterAll
  static void stop() {
    customer.stop(0);
  }

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add("motoros.jwt-secret", () -> "test-only-not-a-live-secret-0123456789abcdef0123456789");
    r.add("motoros.tenant-url", () -> "http://127.0.0.1:" + customer.getAddress().getPort());
    r.add("motoros.customer-url", () -> "http://127.0.0.1:" + customer.getAddress().getPort());
  }

  @Autowired MockMvc mvc;

  @org.springframework.test.context.bean.override.mockito.MockitoBean
  com.motoros.security.AuthorizationResolver resolver;

  @org.junit.jupiter.api.BeforeEach
  void authorizationFixture() {
    org.mockito.Mockito.when(
            resolver.resolve(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.nullable(com.motoros.security.Permission.class)))
        .thenAnswer(
            call -> {
              org.springframework.security.oauth2.jwt.Jwt j = call.getArgument(0);
              java.util.UUID t = call.getArgument(1);
              java.util.List<String> p =
                  java.util.Arrays.stream(com.motoros.security.Permission.values())
                      .map(Enum::name)
                      .toList();
              if ("MECHANIC".equals(j.getClaimAsString("role")))
                p =
                    java.util.List.of(
                        "CUSTOMER_READ",
                        "VEHICLE_READ",
                        "VEHICLE_HISTORY_READ",
                        "WORKORDER_READ",
                        "WORKORDER_UPDATE");
              return new com.motoros.security.AuthorizationContext(
                  java.util.UUID.fromString(j.getSubject()),
                  t,
                  j.getClaimAsString("role"),
                  true,
                  p,
                  j.getClaimAsStringList("branches").stream()
                      .map(java.util.UUID::fromString)
                      .toList(),
                  j.getClaimAsStringList("branches").stream()
                      .map(java.util.UUID::fromString)
                      .toList());
            });
  }

  @Autowired WorkOrderRepository orders;
  @Autowired JdbcTemplate db;

  @org.springframework.test.context.bean.override.mockito.MockitoBean
  com.motoros.security.ServiceTokens tokens;

  @org.junit.jupiter.api.BeforeEach
  void serviceFixture() {
    org.mockito.Mockito.when(tokens.token()).thenReturn("explicit-test-service-token");
  }

  @Test
  void requiredBranchAndVersionAreValidatedBeforeChangingRecords() throws Exception {
    var tenant = UUID.randomUUID();
    var branch = UUID.randomUUID();
    var order =
        orders.saveAndFlush(new WorkOrder(tenant, branch, UUID.randomUUID(), "Validation test"));
    mvc.perform(get("/api/work-orders").with(staff(tenant, branch)))
        .andExpect(status().isBadRequest());
    mvc.perform(
            patch("/api/work-orders/" + order.id + "/status")
                .with(staff(tenant, branch))
                .contentType("application/json")
                .content("{\"status\":\"CHECKED_IN\",\"note\":\"No version\"}"))
        .andExpect(status().isBadRequest());
    assertEquals(Status.CREATED, orders.findById(order.id).orElseThrow().status);
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from workorder.work_order_audit_events where work_order_id=?",
            Integer.class,
            order.id));
  }

  private org.springframework.test.web.servlet.request.RequestPostProcessor staff(
      UUID tenant, UUID branch) {
    return request -> {
      request.addHeader("X-MotorOS-Tenant", tenant.toString());
      return jwt()
          .jwt(
              j ->
                  j.issuer("https://identity.example.test/realm")
                      .subject(UUID.randomUUID().toString())
                      .claim("scope", "motoros.api")
                      .claim("tenant", tenant.toString())
                      .claim("role", "BRAND_OWNER")
                      .claim("branches", List.of(branch.toString())))
          .postProcessRequest(request);
    };
  }

  @Test
  void staleUpdatesDoNotOverwriteOrCreateExtraAuditRows() throws Exception {
    var tenant = UUID.randomUUID();
    var branch = UUID.randomUUID();
    var o = orders.saveAndFlush(new WorkOrder(tenant, branch, UUID.randomUUID(), "Inspect brakes"));
    mvc.perform(
            patch("/api/work-orders/" + o.id + "/status")
                .with(staff(tenant, branch))
                .contentType("application/json")
                .content("{\"status\":\"CHECKED_IN\",\"version\":0,\"note\":\"Vehicle arrived\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(1));
    mvc.perform(
            patch("/api/work-orders/" + o.id + "/status")
                .with(staff(tenant, branch))
                .contentType("application/json")
                .content("{\"status\":\"INSPECTION\",\"version\":0,\"note\":\"Stale edit\"}"))
        .andExpect(status().isConflict());
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from workorder.work_order_audit_events where work_order_id=?",
            Integer.class,
            o.id));
    assertEquals(Status.CHECKED_IN, orders.findById(o.id).orElseThrow().status);
  }

  @Test
  void historySpansBranchesButOperationsStayScoped() throws Exception {
    var tenant = UUID.randomUUID();
    var a = UUID.randomUUID();
    var b = UUID.randomUUID();
    var vehicle = UUID.randomUUID();
    var order = new WorkOrder(tenant, a, vehicle, "Completed service");
    order.status = Status.CLOSED;
    orders.saveAndFlush(order);
    mvc.perform(
            get("/api/vehicles/" + vehicle + "/history")
                .param("branchId", b.toString())
                .with(staff(tenant, b)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].branchId").value(a.toString()));
    mvc.perform(get("/api/work-orders/" + order.id).with(staff(tenant, b)))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/work-orders/" + order.id).with(staff(UUID.randomUUID(), a)))
        .andExpect(status().isNotFound());
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from workorder.access_audit where vehicle_id=?",
            Integer.class,
            vehicle));
  }

  @Test
  void paginatedTimelineSharesCompletedHistoryWithSourceReferencesOnlyInsideTenant()
      throws Exception {
    UUID tenant = UUID.randomUUID(),
        anna = UUID.randomUUID(),
        vel = UUID.randomUUID(),
        vehicle = UUID.randomUUID();
    var completed = new WorkOrder(tenant, anna, vehicle, "Completed Anna Nagar inspection");
    completed.status = Status.CLOSED;
    orders.saveAndFlush(completed);
    orders.saveAndFlush(new WorkOrder(tenant, anna, vehicle, "Still in progress"));
    mvc.perform(
            get("/api/vehicles/" + vehicle + "/timeline?branchId=" + vel + "&size=1")
                .with(staff(tenant, vel)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(1))
        .andExpect(jsonPath("$.content[0].branchId").value(anna.toString()))
        .andExpect(jsonPath("$.content[0].source.service").value("workorder"));
    mvc.perform(
            get("/api/vehicles/" + vehicle + "/timeline?branchId=" + anna).with(staff(tenant, vel)))
        .andExpect(status().isForbidden());
    mvc.perform(
            get("/api/vehicles/" + vehicle + "/timeline?branchId=" + vel)
                .with(staff(UUID.randomUUID(), vel)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(0));
  }

  @Test
  void inactiveVehicleCannotCreateNewWorkButHistoryRemainsReadable() throws Exception {
    UUID tenant = UUID.randomUUID(), branch = UUID.randomUUID(), vehicle = UUID.randomUUID();
    inactiveVehicles.add("/api/vehicles/" + vehicle);
    mvc.perform(
            post("/api/work-orders")
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .with(staff(tenant, branch))
                .contentType("application/json")
                .content(
                    "{\"vehicleId\":\""
                        + vehicle
                        + "\",\"branchId\":\""
                        + branch
                        + "\",\"complaint\":\"Inactive intake\"}"))
        .andExpect(status().isConflict());
    mvc.perform(
            get("/api/vehicles/" + vehicle + "/timeline?branchId=" + branch)
                .with(staff(tenant, branch)))
        .andExpect(status().isOk());
  }

  private org.springframework.test.web.servlet.request.RequestPostProcessor actor(
      UUID tenant, UUID branch, UUID user) {
    return request -> {
      request.addHeader("X-MotorOS-Tenant", tenant.toString());
      return jwt()
          .jwt(
              j ->
                  j.issuer("https://identity.example.test/realm")
                      .subject(user.toString())
                      .claim("scope", "motoros.api")
                      .claim("role", "BRAND_OWNER")
                      .claim("branches", List.of(branch.toString())))
          .postProcessRequest(request);
    };
  }

  @Test
  void createsUniqueJobCardsAndReplaysOnlyIdenticalInput() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), u = UUID.randomUUID(), v = UUID.randomUUID();
    String key = UUID.randomUUID().toString();
    String body =
        "{\"branchId\":\"" + b + "\",\"vehicleId\":\"" + v + "\",\"complaint\":\"Test visit\"}";
    var first =
        mvc.perform(
                post("/api/work-orders")
                    .with(actor(t, b, u))
                    .header("Idempotency-Key", key)
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    var again =
        mvc.perform(
                post("/api/work-orders")
                    .with(actor(t, b, u))
                    .header("Idempotency-Key", key)
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertEquals(
        com.motoros.foundation.Records.object(first).get("id"),
        com.motoros.foundation.Records.object(again).get("id"));
    mvc.perform(
            post("/api/work-orders")
                .with(actor(t, b, u))
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(body.replace("Test visit", "Changed visit")))
        .andExpect(status().isConflict());
    mvc.perform(
            post("/api/work-orders")
                .with(actor(t, b, u))
                .header("Idempotency-Key", UUID.randomUUID())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isCreated());
    assertEquals(
        2,
        db.queryForObject(
            "select count(distinct job_card_number) from workorder.work_orders where tenant_id=?",
            Integer.class,
            t));
  }

  @Test
  void simultaneousAssignmentRejectsStaleVersionAndKeepsAudit() throws Exception {
    UUID t = UUID.randomUUID(),
        b = UUID.randomUUID(),
        u = UUID.randomUUID(),
        tech = UUID.randomUUID();
    var order = orders.saveAndFlush(new WorkOrder(t, b, UUID.randomUUID(), "Assign safely"));
    var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
    try {
      var start = new java.util.concurrent.CountDownLatch(1);
      var jobs = new ArrayList<java.util.concurrent.Future<Integer>>();
      for (int n = 0; n < 2; n++)
        jobs.add(
            pool.submit(
                () -> {
                  start.await();
                  return mvc.perform(
                          post("/api/work-orders/" + order.id + "/assign")
                              .with(actor(t, b, u))
                              .contentType("application/json")
                              .content(
                                  "{\"technicianId\":\""
                                      + tech
                                      + "\",\"version\":0,\"reason\":\"Concurrent assignment"
                                      + " test\"}"))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      start.countDown();
      var results = List.of(jobs.get(0).get(), jobs.get(1).get());
      assertEquals(1, results.stream().filter(v -> v == 200).count());
      assertEquals(1, results.stream().filter(v -> v == 409).count());
      assertEquals(
          1,
          db.queryForObject(
              "select count(*) from workorder.technician_assignments where work_order_id=?",
              Integer.class,
              order.id));
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void incompleteInspectionAndProductionApprovalCannotBeBypassed() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), u = UUID.randomUUID();
    var order = new WorkOrder(t, b, UUID.randomUUID(), "Inspection gates");
    order.status = Status.INSPECTION;
    orders.saveAndFlush(order);
    mvc.perform(
            post("/api/work-orders/" + order.id + "/transition")
                .with(actor(t, b, u))
                .contentType("application/json")
                .content(
                    "{\"status\":\"ESTIMATE_PENDING\",\"version\":0,\"note\":\"Cannot skip"
                        + " checklist\"}"))
        .andExpect(status().isConflict());
    var start =
        mvc.perform(
                post("/api/work-orders/" + order.id + "/inspections")
                    .with(actor(t, b, u))
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content("{\"templateId\":\"00000000-0000-0000-0000-000000000410\"}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String inspection = com.motoros.foundation.Records.object(start).get("id").toString();
    mvc.perform(
            post("/api/inspections/" + inspection + "/complete")
                .with(actor(t, b, u))
                .contentType("application/json")
                .content("{\"version\":0}"))
        .andExpect(status().isConflict());
    mvc.perform(
            post("/api/work-orders/" + order.id + "/development-approval")
                .with(actor(t, b, u))
                .contentType("application/json")
                .content(
                    "{\"version\":0,\"decision\":\"APPROVE\",\"reason\":\"Production cannot"
                        + " simulate approval\"}"))
        .andExpect(status().isForbidden());
    assertEquals(
        11,
        db.queryForObject(
            "select count(*) from workorder.inspection_findings where inspection_id=?",
            Integer.class,
            UUID.fromString(inspection)));
  }

  @Test
  void assignedMechanicCanRecordNotesAndRequestPartsWithoutJobCreationAuthority() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), u = UUID.randomUUID();
    var o = orders.saveAndFlush(new WorkOrder(t, b, UUID.randomUUID(), "Mechanic authorization"));
    db.update("update workorder.work_orders set assigned_technician_id=? where id=?", u, o.id);
    org.springframework.test.web.servlet.request.RequestPostProcessor mechanic =
        request -> {
          request.addHeader("X-MotorOS-Tenant", t.toString());
          return jwt()
              .jwt(
                  j ->
                      j.issuer("https://identity.example.test/realm")
                          .subject(u.toString())
                          .claim("scope", "motoros.api")
                          .claim("role", "MECHANIC")
                          .claim("branches", List.of(b.toString())))
              .postProcessRequest(request);
        };
    mvc.perform(
            post("/api/work-orders/" + o.id + "/notes")
                .with(mechanic)
                .contentType("application/json")
                .content(
                    "{\"kind\":\"TECHNICIAN\",\"note\":\"Observed brake noise during assigned"
                        + " inspection\"}"))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/work-orders/" + o.id + "/parts")
                .header("Idempotency-Key",UUID.randomUUID())
                .with(mechanic)
                .contentType("application/json")
                .content("{\"description\":\"Brake service part\",\"quantity\":1}"))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/work-orders")
                .with(mechanic)
                .header("Idempotency-Key", UUID.randomUUID())
                .contentType("application/json")
                .content(
                    "{\"branchId\":\""
                        + b
                        + "\",\"vehicleId\":\""
                        + o.vehicleId
                        + "\",\"complaint\":\"Cannot create a new visit\"}"))
        .andExpect(status().isForbidden());
  }
}
