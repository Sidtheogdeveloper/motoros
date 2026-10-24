package com.motoros.tenant;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@SpringBootTest(
    properties = {
      "motoros.invitation-key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "motoros.mail-enabled=false"
    })
@AutoConfigureMockMvc
@Testcontainers
class OnboardingIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
  }

  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate db;
  @Autowired ObjectMapper json;
  @Autowired InvitationCipher cipher;
  @MockitoBean OidcProfileClient profiles;

  @BeforeEach
  void profileFixture() {
    org.mockito.Mockito.when(profiles.profile(org.mockito.ArgumentMatchers.any()))
        .thenAnswer(
            call -> {
              var j = (org.springframework.security.oauth2.jwt.Jwt) call.getArgument(0);
              return Map.of(
                  "sub",
                  j.getSubject(),
                  "email",
                  j.getSubject() + "@example.test",
                  "email_verified",
                  true,
                  "name",
                  "Integration fixture");
            });
  }

  RequestPostProcessor identity(UUID sub) {
    return jwt()
        .jwt(
            j ->
                j.issuer("https://identity.example.test/realm")
                    .subject(sub.toString())
                    .claim("scope", "openid motoros.api")
                    .claim("role", "BRAND_OWNER"));
  }

  JsonNode response(org.springframework.test.web.servlet.RequestBuilder request, int status)
      throws Exception {
    var result = mvc.perform(request).andExpect(status().is(status)).andReturn();
    return json.readTree(result.getResponse().getContentAsString());
  }

  String branch(String code) {
    return "{\"name\":\"" + code + "\",\"branchCode\":\"" + code + "\",\"city\":\"Chennai\"}";
  }

  UUID onboard(UUID user) throws Exception {
    var result =
        response(
            post("/api/tenants")
                .with(identity(user))
                .contentType("application/json")
                .content(
                    "{\"name\":\"Test"
                        + " Workshop\",\"businessEmail\":\"business@example.test\",\"primaryBranch\":"
                        + branch("NORTH")
                        + "}"),
            201);
    return UUID.fromString(result.path("tenant").path("id").asText());
  }

  UUID primary(UUID tenant) {
    return db.queryForObject(
        "select id from tenant.branches where tenant_id=?", UUID.class, tenant);
  }

  UUID internalUser(UUID subject) {
    return db.queryForObject(
        "select id from tenant.platform_users where subject=?", UUID.class, subject.toString());
  }

  record Invited(UUID id, String token) {}

  Invited invite(UUID owner, UUID tenant, UUID recipient, String role, UUID branch)
      throws Exception {
    var created =
        response(
            post("/api/tenants/" + tenant + "/invitations")
                .with(identity(owner))
                .contentType("application/json")
                .content(
                    json.writeValueAsString(
                        Map.of(
                            "email",
                            recipient + "@example.test",
                            "role",
                            role,
                            "branchIds",
                            role.equals("BRAND_OWNER") ? List.of() : List.of(branch)))),
            201);
    assertFalse(created.has("tokenHash"));
    assertFalse(created.has("token"));
    UUID id = UUID.fromString(created.path("id").asText());
    String encrypted =
        db.queryForObject(
            "select encrypted_body from tenant.invitation_mail_outbox where invitation_id=? order"
                + " by created_at desc limit 1",
            String.class,
            id);
    var m =
        java.util.regex.Pattern.compile("token=([A-Za-z0-9_-]+)")
            .matcher(cipher.decrypt(encrypted));
    assertTrue(m.find());
    assertFalse(encrypted.contains(m.group(1)));
    return new Invited(id, m.group(1));
  }

  JsonNode accept(UUID user, Invited invitation, int status) throws Exception {
    return response(
        post("/api/invitations/accept")
            .with(identity(user))
            .contentType("application/json")
            .content(json.writeValueAsString(Map.of("token", invitation.token()))),
        status);
  }

  @Test
  void onboardingIsAtomicAndPasswordsWereRemoved() throws Exception {
    UUID owner = UUID.randomUUID();
    long before = db.queryForObject("select count(*) from tenant.tenants", Long.class);
    response(
        post("/api/tenants")
            .with(identity(owner))
            .contentType("application/json")
            .content(
                "{\"name\":\"Atomic\",\"businessEmail\":\"atomic@example.test\",\"primaryBranch\":"
                    + branch("!")
                    + "}"),
        400);
    assertEquals(before, db.queryForObject("select count(*) from tenant.tenants", Long.class));
    UUID tenant = onboard(owner);
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from tenant.tenant_memberships where tenant_id=? and"
                + " role='BRAND_OWNER' and status='ACTIVE'",
            Integer.class,
            tenant));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from information_schema.columns where table_schema='tenant' and"
                + " column_name='password_hash'",
            Integer.class));
  }

  @Test
  void verifiedEmailBindingAndSingleUseInvitations() throws Exception {
    UUID owner = UUID.randomUUID(), manager = UUID.randomUUID();
    UUID tenant = onboard(owner), branch = primary(tenant);
    var invited = invite(owner, tenant, manager, "BRANCH_MANAGER", branch);
    accept(owner, invited, 403);
    accept(manager, invited, 200);
    accept(manager, invited, 409);
    response(get("/api/branches").header("X-MotorOS-Tenant", tenant).with(identity(manager)), 200);
  }

  @Test
  void expiredAndRevokedInvitationsAreRejected() throws Exception {
    UUID owner = UUID.randomUUID(), recipient = UUID.randomUUID();
    UUID tenant = onboard(owner), branch = primary(tenant);
    var expired = invite(owner, tenant, recipient, "MECHANIC", branch);
    db.update(
        "update tenant.staff_invitations set expires_at=now()-interval '1 second' where id=?",
        expired.id());
    accept(recipient, expired, 409);
    var revoked = invite(owner, tenant, UUID.randomUUID(), "MECHANIC", branch);
    response(
        post("/api/invitations/" + revoked.id() + "/revoke")
            .header("X-MotorOS-Tenant", tenant)
            .with(identity(owner))
            .contentType("application/json")
            .content("{\"version\":0}"),
        200);
    accept(recipient, revoked, 409);
  }

  @Test
  void branchScopeEscalationAndImmediateRevocation() throws Exception {
    UUID owner = UUID.randomUUID(), manager = UUID.randomUUID(), other = UUID.randomUUID();
    UUID tenant = onboard(owner), foreign = onboard(other), north = primary(tenant);
    var south =
        response(
            post("/api/branches")
                .header("X-MotorOS-Tenant", tenant)
                .with(identity(owner))
                .contentType("application/json")
                .content(branch("SOUTH")),
            201);
    UUID southId = UUID.fromString(south.path("id").asText());
    var invited = invite(owner, tenant, manager, "BRANCH_MANAGER", southId);
    var accepted = accept(manager, invited, 200);
    UUID membership = UUID.fromString(accepted.path("membershipId").asText());
    var visible =
        response(
            get("/api/branches").header("X-MotorOS-Tenant", tenant).with(identity(manager)), 200);
    assertEquals(1, visible.size());
    assertEquals(southId.toString(), visible.get(0).path("id").asText());
    response(get("/api/tenants/" + foreign).with(identity(manager)), 403);
    response(
        post("/api/tenants/" + tenant + "/invitations")
            .with(identity(manager))
            .contentType("application/json")
            .content(
                json.writeValueAsString(
                    Map.of(
                        "email",
                        "bad@example.test",
                        "role",
                        "BRAND_OWNER",
                        "branchIds",
                        List.of()))),
        403);
    response(
        post("/api/tenants/" + tenant + "/invitations")
            .with(identity(manager))
            .contentType("application/json")
            .content(
                json.writeValueAsString(
                    Map.of(
                        "email",
                        "other@example.test",
                        "role",
                        "MECHANIC",
                        "branchIds",
                        List.of(north)))),
        403);
    response(
        post("/api/tenants/" + tenant + "/staff/" + membership + "/deactivate")
            .with(identity(owner))
            .contentType("application/json")
            .content("{\"version\":0}"),
        200);
    response(get("/api/branches").header("X-MotorOS-Tenant", tenant).with(identity(manager)), 403);
  }

  @Test
  void ownRoleCannotBeChangedAndFinalOwnerRemains() throws Exception {
    UUID owner = UUID.randomUUID();
    UUID tenant = onboard(owner);
    UUID member =
        db.queryForObject(
            "select id from tenant.tenant_memberships where tenant_id=?", UUID.class, tenant);
    response(
        patch("/api/tenants/" + tenant + "/staff/" + member + "/roles")
            .with(identity(owner))
            .contentType("application/json")
            .content("{\"role\":\"MECHANIC\",\"branchIds\":[],\"version\":0}"),
        403);
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from tenant.tenant_memberships where tenant_id=? and"
                + " role='BRAND_OWNER' and status='ACTIVE'",
            Integer.class,
            tenant));
  }

  @Test
  void concurrentOwnerRevocationsCannotRemoveFinalOwner() throws Exception {
    UUID first = UUID.randomUUID(), second = UUID.randomUUID();
    UUID tenant = onboard(first);
    onboard(second);
    UUID secondId =
        db.queryForObject(
            "select id from tenant.platform_users where subject=?", UUID.class, second.toString());
    UUID firstMember =
        db.queryForObject(
            "select id from tenant.tenant_memberships where tenant_id=?", UUID.class, tenant);
    UUID secondMember = UUID.randomUUID();
    db.update(
        "insert into tenant.tenant_memberships(id,tenant_id,user_id,role,scope,status)"
            + " values(?,?,?,'BRAND_OWNER','TENANT','ACTIVE')",
        secondMember,
        tenant,
        secondId);
    var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
    var gate = new java.util.concurrent.CountDownLatch(1);
    try {
      var a =
          pool.submit(
              () -> {
                gate.await();
                return mvc.perform(
                        post("/api/tenants/" + tenant + "/staff/" + secondMember + "/deactivate")
                            .with(identity(first))
                            .contentType("application/json")
                            .content("{\"version\":0}"))
                    .andReturn()
                    .getResponse()
                    .getStatus();
              });
      var b =
          pool.submit(
              () -> {
                gate.await();
                return mvc.perform(
                        post("/api/tenants/" + tenant + "/staff/" + firstMember + "/deactivate")
                            .with(identity(second))
                            .contentType("application/json")
                            .content("{\"version\":0}"))
                    .andReturn()
                    .getResponse()
                    .getStatus();
              });
      gate.countDown();
      var statuses = List.of(a.get(), b.get());
      assertEquals(1, statuses.stream().filter(v -> v == 200).count());
      assertEquals(1, statuses.stream().filter(v -> v == 403).count());
      assertEquals(
          1,
          db.queryForObject(
              "select count(*) from tenant.tenant_memberships where tenant_id=? and"
                  + " role='BRAND_OWNER' and status='ACTIVE'",
              Integer.class,
              tenant));
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void historyLabelsAndAuditEndpointUseTheOwningService() throws Exception {
    UUID user = UUID.randomUUID(), tenant = onboard(user);
    response(
        get("/api/history-branches").header("X-MotorOS-Tenant", tenant).with(identity(user)), 200);
    var audit = response(get("/api/tenants/" + tenant + "/audit").with(identity(user)), 200);
    assertTrue(audit.size() > 0);
  }

  @Test
  void qualificationAttestationRespectsRoleAndFullMembershipScope() throws Exception {
    UUID owner = UUID.randomUUID(), manager = UUID.randomUUID(), advisor = UUID.randomUUID();
    UUID tenant = onboard(owner), a = primary(tenant);
    var second =
        response(
            post("/api/branches")
                .with(identity(owner))
                .header("X-MotorOS-Tenant", tenant)
                .contentType("application/json")
                .content(branch("SOUTH")),
            201);
    UUID b = UUID.fromString(second.path("id").asText());
    accept(manager, invite(owner, tenant, manager, "REGIONAL_MANAGER", a), 200);
    var accepted = accept(advisor, invite(owner, tenant, advisor, "SERVICE_ADVISOR", a), 200);
    UUID member = UUID.fromString(accepted.path("membershipId").asText());
    response(
        patch("/api/tenants/" + tenant + "/staff/" + member)
            .with(identity(owner))
            .header("X-MotorOS-Tenant", tenant)
            .contentType("application/json")
            .content(json.writeValueAsString(Map.of("version", 0, "branchIds", List.of(a, b)))),
        200);
    String body =
        json.writeValueAsString(
            Map.of(
                "branchId",
                a,
                "qualityReview",
                true,
                "safetyReview",
                true,
                "attestation",
                "Reviewed workshop competence and role scope",
                "version",
                0));
    response(
        patch("/api/tenants/" + tenant + "/staff/" + member + "/capabilities")
            .with(identity(manager))
            .header("X-MotorOS-Tenant", tenant)
            .contentType("application/json")
            .content(body),
        403);
    UUID ownerMember =
        db.queryForObject(
            "select id from tenant.tenant_memberships where tenant_id=? and user_id=?",
            UUID.class,
            tenant,
            internalUser(owner));
    response(
        patch("/api/tenants/" + tenant + "/staff/" + ownerMember + "/capabilities")
            .with(identity(manager))
            .header("X-MotorOS-Tenant", tenant)
            .contentType("application/json")
            .content(body),
        403);
    response(
        patch("/api/tenants/" + tenant + "/staff/" + member + "/capabilities")
            .with(identity(owner))
            .header("X-MotorOS-Tenant", tenant)
            .contentType("application/json")
            .content(body),
        200);
    response(
        patch("/api/tenants/" + tenant + "/staff/" + member)
            .with(identity(owner))
            .header("X-MotorOS-Tenant", tenant)
            .contentType("application/json")
            .content(json.writeValueAsString(Map.of("version", 1, "branchIds", List.of(a)))),
        200);
    response(
        patch("/api/tenants/" + tenant + "/staff/" + member + "/capabilities")
            .with(identity(manager))
            .header("X-MotorOS-Tenant", tenant)
            .contentType("application/json")
            .content(
                json.writeValueAsString(
                    Map.of(
                        "branchId",
                        a,
                        "qualityReview",
                        true,
                        "safetyReview",
                        true,
                        "attestation",
                        "Scoped regional manager reviewed workshop competence",
                        "version",
                        1))),
        200);
  }
}
