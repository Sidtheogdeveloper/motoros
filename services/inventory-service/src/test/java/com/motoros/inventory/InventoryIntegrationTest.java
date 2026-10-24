package com.motoros.inventory;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
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
class InventoryIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  static final UUID actor = UUID.randomUUID();
  static volatile UUID jobBranch, approvedPart;
  static volatile String jobStatus = "IN_PROGRESS";
  static final HttpServer references;

  static {
    try {
      references = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      references.createContext(
          "/api/",
          e -> {
            Object result =
                e.getRequestURI().getPath().contains("commercial")
                    ? Map.of(
                        "approvalValid",
                        true,
                        "estimateId",
                        UUID.randomUUID(),
                        "revision",
                        1,
                        "parts",
                        List.of(Map.of("partId", approvedPart, "quantity", 1)))
                    : e.getRequestURI().getPath().contains("work-orders")
                        ? Map.of("status", jobStatus, "branchId", jobBranch)
                        : Map.of("status", "ACTIVE");
            byte[] bytes = Records.json(result).getBytes();
            e.getResponseHeaders().set("Content-Type", "application/json");
            e.sendResponseHeaders(200, bytes.length);
            e.getResponseBody().write(bytes);
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
    for (String name : List.of("tenant", "workorder", "billing"))
      r.add(
          "motoros." + name + "-url",
          () -> "http://127.0.0.1:" + references.getAddress().getPort());
  }

  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate db;

  @org.springframework.test.context.bean.override.mockito.MockitoBean
  AuthorizationResolver resolver;

  @org.springframework.test.context.bean.override.mockito.MockitoBean ServiceTokens tokens;

  @BeforeEach
  void auth() {
    jobStatus = "IN_PROGRESS";
    org.mockito.Mockito.when(tokens.token()).thenReturn("explicit-test-token");
    org.mockito.Mockito.when(
            resolver.resolve(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.nullable(Permission.class)))
        .thenAnswer(
            c -> {
              var j = (org.springframework.security.oauth2.jwt.Jwt) c.getArgument(0);
              var branches =
                  j.getClaimAsStringList("branches").stream().map(UUID::fromString).toList();
              var perms = j.getClaimAsStringList("testPermissions");
              return new AuthorizationContext(
                  actor, c.getArgument(1), "BRAND_OWNER", true, perms, branches, branches);
            });
  }

  RequestPostProcessor staff(UUID t, UUID... branches) {
    return staffPermissions(
        t, Arrays.stream(Permission.values()).map(Enum::name).toList(), branches);
  }

  RequestPostProcessor staffPermissions(UUID t, List<String> permissions, UUID... branches) {
    return req -> {
      req.addHeader("X-MotorOS-Tenant", t.toString());
      return jwt()
          .jwt(
              j ->
                  j.issuer("https://identity.example.test/realm")
                      .subject(actor.toString())
                      .claim("scope", "motoros.api")
                      .claim("branches", Arrays.stream(branches).map(UUID::toString).toList())
                      .claim("testPermissions", permissions))
          .postProcessRequest(req);
    };
  }

  Map<String, Object> call(String path, UUID t, UUID b, Object body, String key, int expected)
      throws Exception {
    var response =
        mvc.perform(
                post(path)
                    .with(staff(t, b))
                    .contentType("application/json")
                    .header("Idempotency-Key", key)
                    .content(Records.json(body)))
            .andReturn()
            .getResponse();
    assertEquals(expected, response.getStatus(), response.getContentAsString());
    return Records.object(response.getContentAsString());
  }

  Map<String, Object> call(String path, UUID t, UUID b, Object body) throws Exception {
    return call(path, t, b, body, UUID.randomUUID().toString(), 200);
  }

  UUID part(UUID t, UUID b) throws Exception {
    return Records.uuid(
        call(
                "/api/parts",
                t,
                b,
                Map.of(
                    "sku",
                    "TEST-" + UUID.randomUUID(),
                    "name",
                    "Oil filter",
                    "category",
                    "Filters",
                    "currency",
                    "INR",
                    "purchasePrice",
                    "80.00",
                    "sellingPrice",
                    "100.00",
                    "active",
                    true))
            .get("id"));
  }

  void receipt(UUID t, UUID b, UUID p, int n) throws Exception {
    call(
        "/api/inventory/receipts",
        t,
        b,
        Map.of("branchId", b, "partId", p, "quantity", n, "reason", "Supplier delivery"));
  }

  @Test
  void simultaneousLastUnitReservationsHaveOneWinnerAndDurableFailures() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), p = part(t, b);
    jobBranch = b;
    approvedPart = p;
    receipt(t, b, p, 1);
    var pool = Executors.newFixedThreadPool(8);
    var start = new CountDownLatch(1);
    var futures = new ArrayList<Future<Integer>>();
    try {
      for (int i = 0; i < 8; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return mvc.perform(
                          post("/api/inventory/reservations")
                              .with(staff(t, b))
                              .contentType("application/json")
                              .header("Idempotency-Key", UUID.randomUUID())
                              .content(
                                  Records.json(
                                      Map.of(
                                          "branchId",
                                          b,
                                          "partId",
                                          p,
                                          "workOrderId",
                                          UUID.randomUUID(),
                                          "quantity",
                                          1))))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      start.countDown();
      var statuses = new ArrayList<Integer>();
      for (var f : futures) statuses.add(f.get(30, TimeUnit.SECONDS));
      assertEquals(1, statuses.stream().filter(x -> x == 200).count());
      assertEquals(7, statuses.stream().filter(x -> x == 409).count());
      assertEquals(
          1,
          db.queryForObject(
                  "select reserved from inventory.branch_stock where tenant_id=? and part_id=?",
                  java.math.BigDecimal.class,
                  t,
                  p)
              .intValueExact());
      assertEquals(
          7,
          db.queryForObject(
              "select count(*) from inventory.outbox_events where tenant_id=? and"
                  + " event_type='PartReservationFailed'",
              Integer.class,
              t));
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void receiptsReservationsConsumptionAndRetriesConserveStock() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), p = part(t, b);
    jobBranch = b;
    approvedPart = p;
    String receiptKey = UUID.randomUUID().toString();
    var input = Map.of("branchId", b, "partId", p, "quantity", 2, "reason", "Delivery");
    var first = call("/api/inventory/receipts", t, b, input, receiptKey, 200);
    assertEquals(
        first.get("id"), call("/api/inventory/receipts", t, b, input, receiptKey, 200).get("id"));
    call(
        "/api/inventory/receipts",
        t,
        b,
        Map.of("branchId", b, "partId", p, "quantity", 3, "reason", "Changed"),
        receiptKey,
        409);
    var reservation =
        call(
            "/api/inventory/reservations",
            t,
            b,
            Map.of("branchId", b, "partId", p, "workOrderId", UUID.randomUUID(), "quantity", 1));
    String key = UUID.randomUUID().toString();
    String path = "/api/inventory/reservations/" + reservation.get("id") + "/consume";
    var change = Map.of("version", 0, "note", "Installed approved filter");
    call(path, t, b, change, key, 200);
    call(path, t, b, change, key, 200);
    assertEquals(
        1,
        db.queryForObject(
                "select on_hand from inventory.branch_stock where tenant_id=? and part_id=?",
                java.math.BigDecimal.class,
                t,
                p)
            .intValueExact());
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from inventory.outbox_events where tenant_id=? and"
                + " event_type='PartConsumed'",
            Integer.class,
            t));
  }

  @Test
  void transferPartialReceiptDamageAndDuplicateReceiptNeverCreateStock() throws Exception {
    UUID t = UUID.randomUUID(), a = UUID.randomUUID(), b = UUID.randomUUID(), p = part(t, a);
    receipt(t, a, p, 5);
    var create =
        Map.of(
            "sourceBranchId",
            a,
            "destinationBranchId",
            b,
            "items",
            List.of(Map.of("partId", p, "quantity", 3)),
            "note",
            "Supply OMR");
    var response =
        mvc.perform(
                post("/api/inventory/transfers")
                    .with(staff(t, a, b))
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content(Records.json(create)))
            .andReturn()
            .getResponse();
    assertEquals(200, response.getStatus(), response.getContentAsString());
    var x = Records.object(response.getContentAsString());
    String path = "/api/inventory/transfers/" + x.get("id");
    call(
        path + "/dispatch",
        t,
        a,
        Map.of("version", 0, "note", "Invalid"),
        UUID.randomUUID().toString(),
        409);
    x = call(path + "/approve", t, a, Map.of("version", 0, "note", "Approved by source"));
    x = call(path + "/dispatch", t, a, Map.of("version", x.get("version"), "note", "Dispatched"));
    assertEquals(
        2,
        db.queryForObject(
                "select on_hand from inventory.branch_stock where tenant_id=? and branch_id=? and"
                    + " part_id=?",
                java.math.BigDecimal.class,
                t,
                a,
                p)
            .intValueExact());
    String key = UUID.randomUUID().toString();
    var receive =
        Map.of(
            "version",
            x.get("version"),
            "items",
            List.of(Map.of("partId", p, "quantity", 1, "damagedQuantity", 0)),
            "note",
            "First receipt");
    x = call(path + "/receive", t, b, receive, key, 200);
    assertEquals("PARTIALLY_RECEIVED", x.get("status"));
    call(path + "/receive", t, b, receive, key, 200);
    x =
        call(
            path + "/receive",
            t,
            b,
            Map.of(
                "version",
                x.get("version"),
                "items",
                List.of(Map.of("partId", p, "quantity", 1, "damagedQuantity", 1)),
                "note",
                "One item damaged and quarantined"));
    assertEquals("COMPLETED", x.get("status"));
    assertEquals(
        2,
        db.queryForObject(
                "select on_hand from inventory.branch_stock where tenant_id=? and branch_id=? and"
                    + " part_id=?",
                java.math.BigDecimal.class,
                t,
                b,
                p)
            .intValueExact());
    assertEquals(
        2,
        db.queryForObject(
            "select count(*) from inventory.transfer_history where tenant_id=? and transfer_id=?"
                + " and action in ('PARTIALLY_RECEIVED','COMPLETED')",
            Integer.class,
            t,
            Records.uuid(x.get("id"))));
  }

  @Test
  void isolationCostRedactionAndNegativeStockAreEnforced() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), p = part(t, b);
    receipt(t, b, p, 1);
    assertEquals(
        404,
        mvc.perform(get("/api/parts/" + p).with(staff(UUID.randomUUID(), b)))
            .andReturn()
            .getResponse()
            .getStatus());
    var result =
        mvc.perform(get("/api/parts/" + p).with(staffPermissions(t, List.of("INVENTORY_READ"), b)))
            .andReturn()
            .getResponse();
    assertEquals(200, result.getStatus());
    assertFalse(Records.object(result.getContentAsString()).containsKey("purchasePrice"));
    assertEquals(
        403,
        mvc.perform(get("/api/inventory/stock?branchId=" + b).with(staff(t, UUID.randomUUID())))
            .andReturn()
            .getResponse()
            .getStatus());
    call(
        "/api/inventory/adjustments",
        t,
        b,
        Map.of("branchId", b, "partId", p, "quantity", -2, "reason", "Invalid removal"),
        UUID.randomUUID().toString(),
        409);
    assertEquals(
        1,
        db.queryForObject(
                "select on_hand from inventory.branch_stock where tenant_id=? and part_id=?",
                java.math.BigDecimal.class,
                t,
                p)
            .intValueExact());
  }

  @Test
  void aClosedJobCannotConsumeButItsStockCanStillBeReleased() throws Exception {
    UUID t = UUID.randomUUID(), b = UUID.randomUUID(), p = part(t, b);
    jobBranch = b;
    approvedPart = p;
    receipt(t, b, p, 1);
    var x =
        call(
            "/api/inventory/reservations",
            t,
            b,
            Map.of("branchId", b, "partId", p, "workOrderId", UUID.randomUUID(), "quantity", 1));
    jobStatus = "CLOSED";
    call(
        "/api/inventory/reservations/" + x.get("id") + "/consume",
        t,
        b,
        Map.of("version", 0, "note", "Closed job cannot install"),
        UUID.randomUUID().toString(),
        409);
    call(
        "/api/inventory/reservations/" + x.get("id") + "/release",
        t,
        b,
        Map.of("version", 0, "note", "Release after closure"));
    assertEquals(
        0,
        db.queryForObject(
                "select reserved from inventory.branch_stock where tenant_id=? and part_id=?",
                java.math.BigDecimal.class,
                t,
                p)
            .intValueExact());
  }

  @Test
  void approvedMissingQuantityClosesTransferWithoutCreditingUsableStock() throws Exception {
    UUID t = UUID.randomUUID(), a = UUID.randomUUID(), b = UUID.randomUUID(), p = part(t, a);
    receipt(t, a, p, 3);
    var response =
        mvc.perform(
                post("/api/inventory/transfers")
                    .with(staff(t, a, b))
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content(
                        Records.json(
                            Map.of(
                                "sourceBranchId",
                                a,
                                "destinationBranchId",
                                b,
                                "items",
                                List.of(Map.of("partId", p, "quantity", 2)),
                                "note",
                                "Transfer discrepancy fixture"))))
            .andReturn()
            .getResponse();
    assertEquals(200, response.getStatus(), response.getContentAsString());
    var x = Records.object(response.getContentAsString());
    String path = "/api/inventory/transfers/" + x.get("id");
    for (String action : List.of("approve", "dispatch"))
      x =
          call(
              path + "/" + action,
              t,
              a,
              Map.of("version", x.get("version"), "note", "Authorized " + action));
    x =
        call(
            path + "/receive",
            t,
            b,
            Map.of(
                "version",
                x.get("version"),
                "items",
                List.of(
                    Map.of("partId", p, "quantity", 1, "damagedQuantity", 0, "missingQuantity", 1)),
                "note",
                "Approved carrier loss evidence recorded"));
    assertEquals("COMPLETED", x.get("status"));
    assertEquals(
        1,
        db.queryForObject(
                "select on_hand from inventory.branch_stock where tenant_id=? and branch_id=? and"
                    + " part_id=?",
                java.math.BigDecimal.class,
                t,
                b,
                p)
            .intValueExact());
    assertEquals(
        1,
        db.queryForObject(
                "select missing_quantity from inventory.stock_transfer_items where tenant_id=? and"
                    + " transfer_id=?",
                java.math.BigDecimal.class,
                t,
                Records.uuid(x.get("id")))
            .intValueExact());
  }
}
