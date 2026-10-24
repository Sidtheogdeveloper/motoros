package com.motoros.customer;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class CustomerIntegrationTest {
  static final UUID BRANCH = UUID.fromString("00000000-0000-0000-0000-000000000003");
  @Autowired com.fasterxml.jackson.databind.ObjectMapper json;
  @Autowired org.springframework.jdbc.core.JdbcTemplate db;
  @org.springframework.test.context.bean.override.mockito.MockitoBean DocumentStorage storage;

  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  @DynamicPropertySource
  static void configure(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
    r.add("motoros.jwt-secret", () -> "test-only-not-a-live-secret-0123456789abcdef0123456789");
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

  @Autowired CustomerRepository customers;
  @Autowired VehicleRepository vehicles;

  @Test
  void malformedHttpRequestsKeepTheirClientErrorStatus() throws Exception {
    var identity = staff(UUID.randomUUID(), "BRAND_OWNER");
    mvc.perform(
            patch("/api/customers").with(identity).contentType("application/json").content("{}"))
        .andExpect(status().isMethodNotAllowed())
        .andExpect(header().exists("Allow"));
    mvc.perform(get("/api/unknown").with(identity)).andExpect(status().isNotFound());
  }

  private org.springframework.test.web.servlet.request.RequestPostProcessor staff(
      UUID tenant, String role) {
    return request -> {
      request.addHeader("X-MotorOS-Tenant", tenant.toString());
      return jwt()
          .jwt(
              j ->
                  j.issuer("https://identity.example.test/realm")
                      .subject(UUID.randomUUID().toString())
                      .claim("scope", "motoros.api")
                      .claim("tenant", tenant.toString())
                      .claim("role", role)
                      .claim("branches", List.of(BRANCH.toString())))
          .postProcessRequest(request);
    };
  }

  @Test
  void tenantsCannotReadEachOthersCustomersOrVehicles() throws Exception {
    UUID a = UUID.randomUUID(), b = UUID.randomUUID();
    var c = customers.save(new Customer(a, "Isolation test", "test@example.test", ""));
    var v = vehicles.save(new Vehicle(a, c.id, "TEST-1", "Toyota", "Corolla"));
    mvc.perform(get("/api/customers/" + c.id).with(staff(b, "BRAND_OWNER")))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/vehicles/" + v.id).with(staff(b, "BRAND_OWNER")))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/vehicles/" + v.id).with(staff(a, "MECHANIC")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.registration").value("TEST-1"));
  }

  @Test
  void rejectsCrossTenantVehicleOwnership() throws Exception {
    var c = customers.save(new Customer(UUID.randomUUID(), "Other brand", null, null));
    mvc.perform(
            post("/api/vehicles")
                .with(staff(UUID.randomUUID(), "BRAND_OWNER"))
                .contentType("application/json")
                .content(
                    "{\"customerId\":\""
                        + c.id
                        + "\",\"registration\":\"TEST\",\"make\":\"Honda\",\"model\":\"City\"}"))
        .andExpect(status().isNotFound());
  }

  @Test
  void validatesInputAndEnforcesRole() throws Exception {
    var tenant = UUID.randomUUID();
    mvc.perform(
            post("/api/customers")
                .with(staff(tenant, "BRAND_OWNER"))
                .contentType("application/json")
                .content("{\"name\":\"\"}"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/customers")
                .with(staff(tenant, "MECHANIC"))
                .contentType("application/json")
                .content("{\"name\":\"Denied\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/customers")).andExpect(status().isUnauthorized());
  }

  com.fasterxml.jackson.databind.JsonNode postJson(
      UUID tenant, String path, Object body, int expected) throws Exception {
    var result =
        mvc.perform(
                post("/api/" + path)
                    .with(staff(tenant, "BRAND_OWNER"))
                    .contentType("application/json")
                    .content(json.writeValueAsString(body)))
            .andExpect(status().is(expected))
            .andReturn();
    return json.readTree(result.getResponse().getContentAsString());
  }

  UUID customer(UUID t, String name) throws Exception {
    return UUID.fromString(postJson(t, "customers", Map.of("name", name), 201).path("id").asText());
  }

  com.fasterxml.jackson.databind.JsonNode vehicle(UUID t, UUID owner, String registration)
      throws Exception {
    return postJson(
        t,
        "vehicles",
        Map.of(
            "customerId",
            owner,
            "registration",
            registration,
            "make",
            "Toyota",
            "model",
            "Corolla",
            "branchId",
            BRANCH),
        201);
  }

  @Test
  void normalizedDuplicateDetectionAndSearchNeverMerge() throws Exception {
    UUID t = UUID.randomUUID();
    var first =
        postJson(
            t,
            "customers",
            Map.of(
                "name",
                "Contact Owner",
                "email",
                " Owner@Example.test ".trim(),
                "phone",
                "98765 43210"),
            201);
    postJson(t, "customers", Map.of("name", "Duplicate", "email", "OWNER@example.test"), 409);
    postJson(t, "customers", Map.of("name", "Phone duplicate", "phone", "+91 9876543210"), 409);
    postJson(
        t,
        "customers",
        Map.of(
            "name",
            "Reviewed separate person",
            "email",
            "owner@example.test",
            "duplicateReason",
            "Shared family contact reviewed"),
        201);
    mvc.perform(get("/api/customers?q=owner@example.test&size=1").with(staff(t, "BRAND_OWNER")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(2))
        .andExpect(jsonPath("$.content.length()").value(1));
    mvc.perform(
            patch("/api/customers/" + first.path("id").asText())
                .with(staff(t, "BRAND_OWNER"))
                .contentType("application/json")
                .content(
                    json.writeValueAsString(
                        Map.of(
                            "name",
                            "Renamed original",
                            "email",
                            "owner@example.test",
                            "phone",
                            "9876543210",
                            "version",
                            0))))
        .andExpect(status().isOk());
    UUID owner = UUID.fromString(first.path("id").asText());
    var v = vehicle(t, owner, "TN 01 AB-1234");
    vehicleDuplicate(t, owner, "tn01ab1234", 409);
    var vin = "1HGCM82633A004352";
    postJson(
        t,
        "vehicles",
        Map.of(
            "customerId",
            owner,
            "registration",
            "TN02AB1234",
            "make",
            "Honda",
            "model",
            "City",
            "vin",
            vin),
        201);
    postJson(
        t,
        "vehicles",
        Map.of(
            "customerId",
            owner,
            "registration",
            "TN03AB1234",
            "make",
            "Honda",
            "model",
            "City",
            "vin",
            vin),
        409);
    mvc.perform(get("/api/vehicles?q=tn-01-ab-1234").with(staff(t, "BRAND_OWNER")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(1));
  }

  void vehicleDuplicate(UUID t, UUID owner, String reg, int expected) throws Exception {
    postJson(
        t,
        "vehicles",
        Map.of("customerId", owner, "registration", reg, "make", "Toyota", "model", "Corolla"),
        expected);
  }

  @Test
  void ownershipTransferIsAtomicVersionedAndSensitive() throws Exception {
    UUID t = UUID.randomUUID(),
        a = customer(t, "First Owner"),
        b = customer(t, "Next Owner"),
        foreign = customer(UUID.randomUUID(), "Foreign Owner");
    var v = vehicle(t, a, "TRANSFER-1");
    String id = v.path("id").asText();
    postJson(
        t,
        "vehicles/" + id + "/ownership",
        Map.of(
            "customerId", b, "version", 0, "branchId", BRANCH, "reason", "Customer sale reviewed"),
        200);
    mvc.perform(get("/api/vehicles/" + id + "/ownership").with(staff(t, "BRAND_OWNER")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(2));
    postJson(
        t,
        "vehicles/" + id + "/ownership",
        Map.of(
            "customerId", a, "version", 0, "branchId", BRANCH, "reason", "Stale transfer rejected"),
        409);
    postJson(
        t,
        "vehicles/" + id + "/ownership",
        Map.of(
            "customerId",
            foreign,
            "version",
            1,
            "branchId",
            BRANCH,
            "reason",
            "Foreign transfer rejected"),
        404);
    mvc.perform(get("/api/vehicles/" + id).with(staff(t, "BRAND_OWNER")))
        .andExpect(jsonPath("$.customerId").value(b.toString()));
    mvc.perform(get("/api/vehicles/" + id).with(staff(t, "MECHANIC")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.customerId").doesNotExist());
    mvc.perform(get("/api/vehicles/" + id + "/ownership").with(staff(t, "MECHANIC")))
        .andExpect(status().isForbidden());
  }

  @Test
  void readingsRejectDecreaseAndInvalidBranchAndContactsAreSearchable() throws Exception {
    UUID t = UUID.randomUUID(), owner = customer(t, "Reading Owner");
    String id = vehicle(t, owner, "READING-1").path("id").asText();
    postJson(
        t, "vehicles/" + id + "/odometer", Map.of("kilometers", 15000, "branchId", BRANCH), 201);
    postJson(
        t, "vehicles/" + id + "/odometer", Map.of("kilometers", 14999, "branchId", BRANCH), 409);
    postJson(
        t,
        "vehicles/" + id + "/odometer",
        Map.of("kilometers", 16000, "branchId", UUID.randomUUID()),
        403);
    postJson(
        t,
        "customers/" + owner + "/contacts",
        Map.of("kind", "EMAIL", "label", "Work", "value", "secondary@example.test"),
        201);
    mvc.perform(get("/api/customers?q=secondary@example.test").with(staff(t, "BRAND_OWNER")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(1));
  }

  @Test
  void documentsValidateBytesAndNeverExposeCrossTenantObjects() throws Exception {
    UUID t = UUID.randomUUID(), owner = customer(t, "Document Owner");
    String id = vehicle(t, owner, "DOCUMENT-1").path("id").asText();
    byte[] bytes = "%PDF-1.7\nSynthetic document".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    String digest =
        java.util.HexFormat.of()
            .formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
    org.mockito.Mockito.when(
            storage.upload(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString()))
        .thenReturn(
            Map.of("url", "http://127.0.0.1/upload", "headers", Map.of(), "expiresIn", 300));
    var upload =
        postJson(
            t,
            "vehicles/" + id + "/documents/uploads",
            Map.of(
                "fileName",
                "service.pdf",
                "contentType",
                "application/pdf",
                "byteSize",
                bytes.length,
                "sha256",
                digest,
                "branchId",
                BRANCH,
                "visibility",
                "TECHNICAL"),
            201);
    String doc = upload.path("documentId").asText();
    org.mockito.Mockito.when(
            storage.readPending(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(bytes);
    postJson(t, "documents/" + doc + "/complete", Map.of("version", 0), 200);
    mvc.perform(get("/api/vehicles/" + id + "/documents").with(staff(t, "BRAND_OWNER")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[0].objectKey").doesNotExist());
    postJson(UUID.randomUUID(), "documents/" + doc + "/download", Map.of(), 404);
    postJson(t, "documents/" + doc + "/complete", Map.of("version", 0), 409);
    var bad =
        postJson(
            t,
            "vehicles/" + id + "/documents/uploads",
            Map.of(
                "fileName",
                "bad.pdf",
                "contentType",
                "application/pdf",
                "byteSize",
                bytes.length,
                "sha256",
                "0".repeat(64),
                "branchId",
                BRANCH,
                "visibility",
                "CUSTOMER_PRIVATE"),
            201);
    postJson(
        t, "documents/" + bad.path("documentId").asText() + "/complete", Map.of("version", 0), 400);
    postJson(
        t,
        "vehicles/" + id + "/documents/uploads",
        Map.of(
            "fileName",
            "evil.exe",
            "contentType",
            "application/octet-stream",
            "byteSize",
            100,
            "sha256",
            digest,
            "branchId",
            BRANCH,
            "visibility",
            "TECHNICAL"),
        400);
  }

  @Test
  void customerEditsUseOptimisticVersionsAndConcurrentDuplicateVehiclesStayUnique()
      throws Exception {
    UUID tenant = UUID.randomUUID(), owner = customer(tenant, "Versioned customer");
    mvc.perform(
            patch("/api/customers/" + owner)
                .with(staff(tenant, "BRAND_OWNER"))
                .contentType("application/json")
                .content("{\"name\":\"Updated customer\",\"version\":0}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(1));
    mvc.perform(
            patch("/api/customers/" + owner)
                .with(staff(tenant, "BRAND_OWNER"))
                .contentType("application/json")
                .content("{\"name\":\"Stale overwrite\",\"version\":0}"))
        .andExpect(status().isConflict());
    var executor = java.util.concurrent.Executors.newFixedThreadPool(2);
    var gate = new java.util.concurrent.CountDownLatch(1);
    try {
      java.util.concurrent.Callable<Integer> create =
          () -> {
            gate.await();
            return mvc.perform(
                    post("/api/vehicles")
                        .with(staff(tenant, "BRAND_OWNER"))
                        .contentType("application/json")
                        .content(
                            json.writeValueAsString(
                                Map.of(
                                    "customerId",
                                    owner,
                                    "registration",
                                    "CONCURRENT-1",
                                    "make",
                                    "Honda",
                                    "model",
                                    "City"))))
                .andReturn()
                .getResponse()
                .getStatus();
          };
      var a = executor.submit(create);
      var b = executor.submit(create);
      gate.countDown();
      var statuses = List.of(a.get(), b.get());
      assertEquals(1, statuses.stream().filter(n -> n == 201).count());
      assertEquals(1, statuses.stream().filter(n -> n == 409).count());
    } finally {
      executor.shutdownNow();
    }
  }
}
