package com.motoros.billing;

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
class BillingIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  static final UUID actor = UUID.randomUUID(),
      customer = UUID.randomUUID(),
      vehicle = UUID.randomUUID(),
      task = UUID.randomUUID();
  static volatile UUID branch, partReference, approvedEstimate = UUID.randomUUID();
  static volatile int consumedQuantity = 1;
  static final HttpServer references;

  static {
    try {
      references = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      references.createContext(
          "/api/",
          e -> {
            String path = e.getRequestURI().getPath();
            Object result =
                path.contains("consumption")
                    ? Map.of(
                        "parts",
                        List.of(Map.of("partId", partReference, "quantity", consumedQuantity)))
                    : path.contains("work-orders")
                        ? Map.of(
                            "branchId",
                            branch,
                            "customerId",
                            customer,
                            "vehicleId",
                            vehicle,
                            "status",
                            "QUALITY_CHECK",
                            "commercialEstimateId",
                            approvedEstimate,
                            "qualityPassedAt",
                            Instant.now().toString(),
                            "jobCardNumber",
                            "JOB-TEST",
                            "tasks",
                            List.of(
                                Map.of("id", task, "taskDescription", "Replace approved filter")))
                        : path.contains("customers")
                            ? Map.of(
                                "status",
                                "ACTIVE",
                                "email",
                                "customer@example.test",
                                "name",
                                "Customer")
                            : path.contains("vehicles")
                                ? Map.of(
                                    "status",
                                    "ACTIVE",
                                    "customerId",
                                    customer,
                                    "registration",
                                    "TNTEST5",
                                    "make",
                                    "Test",
                                    "model",
                                    "Vehicle")
                                : path.contains("parts")
                                    ? Map.of(
                                        "active",
                                        true,
                                        "currency",
                                        "INR",
                                        "sellingPrice",
                                        "100.00",
                                        "version",
                                        0,
                                        "sku",
                                        "FILTER-1")
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
    r.add(
        "motoros.invitation-key",
        () ->
            UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", ""));
    r.add("motoros.mail-enabled", () -> false);
    for (String n : List.of("tenant", "customer", "workorder", "inventory"))
      r.add("motoros." + n + "-url", () -> "http://127.0.0.1:" + references.getAddress().getPort());
  }

  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate db;
  @Autowired ApprovalCipher cipher;
  @Autowired EstimateExpiry expiry;

  @org.springframework.test.context.bean.override.mockito.MockitoBean
  AuthorizationResolver resolver;

  @org.springframework.test.context.bean.override.mockito.MockitoBean ServiceTokens tokens;
  @org.springframework.test.context.bean.override.mockito.MockitoBean InvoiceStorage storage;

  @BeforeEach
  void auth() {
    consumedQuantity = 1;
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
              return new AuthorizationContext(
                  actor,
                  c.getArgument(1),
                  j.getClaimAsString("testRole"),
                  true,
                  j.getClaimAsStringList("testPermissions"),
                  branches,
                  branches);
            });
  }

  RequestPostProcessor identity(UUID t, String role, String email, UUID b) {
    return req -> {
      req.addHeader("X-MotorOS-Tenant", t.toString());
      return jwt()
          .jwt(
              j ->
                  j.issuer("https://identity.example.test/realm")
                      .subject(actor.toString())
                      .claim("scope", "motoros.api")
                      .claim("branches", List.of(b.toString()))
                      .claim("testRole", role)
                      .claim("email", email)
                      .claim("email_verified", true)
                      .claim(
                          "testPermissions",
                          role.equals("CUSTOMER")
                              ? List.of()
                              : Arrays.stream(Permission.values()).map(Enum::name).toList()))
          .postProcessRequest(req);
    };
  }

  RequestPostProcessor staff(UUID t) {
    return identity(t, "BRAND_OWNER", "staff@example.test", branch);
  }

  Map<String, Object> command(
      String path, UUID t, Object body, String key, int expected, RequestPostProcessor identity)
      throws Exception {
    var response =
        mvc.perform(
                post(path)
                    .with(identity)
                    .contentType("application/json")
                    .header("Idempotency-Key", key)
                    .content(Records.json(body)))
            .andReturn()
            .getResponse();
    assertEquals(expected, response.getStatus(), response.getContentAsString());
    return Records.object(response.getContentAsString());
  }

  Map<String, Object> command(String path, UUID t, Object body) throws Exception {
    return command(path, t, body, UUID.randomUUID().toString(), 200, staff(t));
  }

  Map<String, Object> draft(UUID t) throws Exception {
    branch = UUID.randomUUID();
    partReference = UUID.randomUUID();
    var conf = new LinkedHashMap<String, Object>();
    conf.put("branchId", branch);
    conf.put("currency", "INR");
    conf.put("laborHourlyRate", "200.00");
    conf.put("taxRate", "18");
    conf.put("legalName", "Test workshop");
    conf.put("address", "Test address");
    conf.put("taxLabel", "Configured tax");
    conf.put("paymentRequiredBeforeDelivery", true);
    conf.put("version", 0);
    var res =
        mvc.perform(
                put("/api/billing/settings")
                    .with(staff(t))
                    .contentType("application/json")
                    .content(Records.json(conf)))
            .andReturn()
            .getResponse();
    assertEquals(200, res.getStatus(), res.getContentAsString());
    return command(
        "/api/estimates",
        t,
        Map.of(
            "branchId",
            branch,
            "workOrderId",
            UUID.randomUUID(),
            "expiresAt",
            Instant.now().plus(Duration.ofDays(2)).toString(),
            "note",
            "Requested repair scope",
            "items",
            List.of(
                Map.of(
                    "itemType",
                    "PART",
                    "partId",
                    partReference,
                    "description",
                    "Approved filter",
                    "quantity",
                    1,
                    "unitPrice",
                    "0.01",
                    "discountPercent",
                    0))));
  }

  String token(UUID t, UUID id) {
    String encrypted =
        db.queryForObject(
            "select encrypted_body from billing.approval_mail_outbox where tenant_id=? and"
                + " estimate_id=?",
            String.class,
            t,
            id);
    String body = cipher.decrypt(encrypted);
    return body.substring(body.indexOf("#token=") + 7).split("&")[0];
  }

  Map<String, Object> submitted(UUID t) throws Exception {
    var e = draft(t);
    return command(
        "/api/estimates/" + e.get("id") + "/submit",
        t,
        Map.of("version", e.get("version"), "note", "Send for customer decision"));
  }

  Map<String, Object> approved(UUID t) throws Exception {
    var e = submitted(t);
    String token = token(t, Records.uuid(e.get("id")));
    command(
        "/api/estimates/" + e.get("id") + "/approve",
        t,
        Map.of("token", token, "decision", "APPROVED", "note", "I approve this listed repair"),
        UUID.randomUUID().toString(),
        200,
        identity(t, "CUSTOMER", "customer@example.test", branch));
    approvedEstimate = Records.uuid(e.get("id"));
    return e;
  }

  @Test
  void catalogPricesOverrideClientValuesAndSubmittedSnapshotsAreImmutable() throws Exception {
    UUID t = UUID.randomUUID();
    var e = submitted(t);
    assertEquals(
        0,
        new java.math.BigDecimal("118.00")
            .compareTo(new java.math.BigDecimal(e.get("total").toString())));
    assertThrows(
        org.springframework.dao.DataAccessException.class,
        () ->
            db.update(
                "update billing.estimate_items set unit_price=1 where tenant_id=? and"
                    + " estimate_id=?",
                t,
                Records.uuid(e.get("id"))));
    assertThrows(
        org.springframework.dao.DataAccessException.class,
        () ->
            db.update(
                "update billing.estimates set total=1,subtotal=1,tax_total=0 where tenant_id=? and"
                    + " id=?",
                t,
                Records.uuid(e.get("id"))));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from billing.outbox_events where tenant_id=? and"
                + " event_type='EstimateSubmitted'",
            Integer.class,
            t));
  }

  @Test
  void approvalIsBoundToCustomerTenantCurrentVersionAndExpiry() throws Exception {
    UUID t = UUID.randomUUID();
    var e = submitted(t);
    UUID id = Records.uuid(e.get("id"));
    String token = token(t, id);
    var decision = Map.of("token", token, "decision", "APPROVED", "note", "Approve");
    command(
        "/api/estimates/" + id + "/approve",
        t,
        decision,
        UUID.randomUUID().toString(),
        403,
        staff(t));
    command(
        "/api/estimates/" + id + "/approve",
        t,
        decision,
        UUID.randomUUID().toString(),
        403,
        identity(t, "CUSTOMER", "wrong@example.test", branch));
    command(
        "/api/estimates/" + id + "/approve",
        UUID.randomUUID(),
        decision,
        UUID.randomUUID().toString(),
        404,
        identity(UUID.randomUUID(), "CUSTOMER", "customer@example.test", branch));
    var revised =
        command(
            "/api/estimates/" + id + "/revise",
            t,
            Map.of("version", e.get("version"), "note", "Additional work requires approval"));
    command(
        "/api/estimates/" + id + "/approve",
        t,
        decision,
        UUID.randomUUID().toString(),
        409,
        identity(t, "CUSTOMER", "customer@example.test", branch));
    assertEquals(2, ((Number) revised.get("revision")).intValue());
    var newer =
        command(
            "/api/estimates/" + revised.get("id") + "/submit",
            t,
            Map.of("version", revised.get("version"), "note", "Revised scope"));
    UUID newId = Records.uuid(newer.get("id"));
    String newToken = token(t, newId);
    db.update(
        "update billing.estimate_approvals set expires_at=now()-interval '1 second' where"
            + " tenant_id=? and estimate_id=?",
        t,
        newId);
    command(
        "/api/estimates/" + newId + "/approve",
        t,
        Map.of("token", newToken, "decision", "APPROVED", "note", "Too late"),
        UUID.randomUUID().toString(),
        403,
        identity(t, "CUSTOMER", "customer@example.test", branch));
  }

  @Test
  void issuedInvoicesPaymentsAndRetriesAreImmutableAndCannotOverpay() throws Exception {
    UUID t = UUID.randomUUID();
    var e = approved(t);
    var invoice = command("/api/invoices", t, Map.of("estimateId", e.get("id")));
    String issueKey = UUID.randomUUID().toString();
    var change = Map.of("version", invoice.get("version"), "note", "Issue approved invoice");
    String path = "/api/invoices/" + invoice.get("id") + "/issue";
    consumedQuantity = 0;
    command(path, t, change, issueKey, 409, staff(t));
    consumedQuantity = 1;
    invoice = command(path, t, change, issueKey, 200, staff(t));
    assertEquals(
        invoice.get("invoiceNumber"),
        command(path, t, change, issueKey, 200, staff(t)).get("invoiceNumber"));
    UUID id = Records.uuid(invoice.get("id"));
    assertThrows(
        org.springframework.dao.DataAccessException.class,
        () -> db.update("update billing.invoices set total=1 where tenant_id=? and id=?", t, id));
    var pool = Executors.newFixedThreadPool(2);
    var start = new CountDownLatch(1);
    var futures = new ArrayList<Future<Integer>>();
    try {
      for (int i = 0; i < 2; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return mvc.perform(
                          post("/api/payments")
                              .with(staff(t))
                              .contentType("application/json")
                              .header("Idempotency-Key", UUID.randomUUID())
                              .content(
                                  Records.json(
                                      Map.of(
                                          "invoiceId",
                                          id,
                                          "amount",
                                          "118.00",
                                          "method",
                                          "UPI",
                                          "externalReference",
                                          UUID.randomUUID(),
                                          "note",
                                          "Manually recorded; provider unverified"))))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      start.countDown();
      var results = new ArrayList<Integer>();
      for (var f : futures) results.add(f.get(30, TimeUnit.SECONDS));
      assertEquals(1, results.stream().filter(x -> x == 200).count());
      assertEquals(1, results.stream().filter(x -> x == 409).count());
    } finally {
      pool.shutdownNow();
    }
    var response = mvc.perform(get("/api/invoices/" + id).with(staff(t))).andReturn().getResponse();
    assertEquals("PAID", Records.object(response.getContentAsString()).get("paymentStatus"));
    assertEquals(
        404,
        mvc.perform(get("/api/invoices/" + id).with(staff(UUID.randomUUID())))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from billing.outbox_events where tenant_id=? and"
                + " event_type='PaymentRecorded'",
            Integer.class,
            t));
  }

  @Test
  void elapsedDraftExpiresWithItsAuditAndOutboxInOneTransaction() throws Exception {
    UUID tenant = UUID.randomUUID();
    var e = draft(tenant);
    UUID id = Records.uuid(e.get("id"));
    db.update(
        "update billing.estimates set expires_at=now()-interval '1 second' where tenant_id=? and"
            + " id=?",
        tenant,
        id);
    expiry.expire();
    assertEquals(
        "EXPIRED",
        db.queryForObject(
            "select status from billing.estimates where tenant_id=? and id=?",
            String.class,
            tenant,
            id));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from billing.outbox_events where tenant_id=? and aggregate_id=? and"
                + " event_type='EstimateExpired'",
            Integer.class,
            tenant,
            id));
  }
}
