package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class InvitationService {
  private final JdbcTemplate db;
  private final Administration admin;
  private final AuthorizationService auth;
  private final UserDirectory users;
  private final AuditEvents audit;
  private final InvitationCipher cipher;
  private final String appUrl;

  InvitationService(
      JdbcTemplate db,
      Administration admin,
      AuthorizationService auth,
      UserDirectory users,
      AuditEvents audit,
      InvitationCipher cipher,
      @Value("${motoros.app-url}") String appUrl) {
    this.db = db;
    this.admin = admin;
    this.auth = auth;
    this.users = users;
    this.audit = audit;
    this.cipher = cipher;
    this.appUrl = appUrl;
  }

  static String hash(String token) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private String token() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private void queue(UUID invitation, String email, String token) {
    String body =
        "You have been invited to a MotorOS workshop. Sign in with this verified email address,"
            + " review the invitation and accept it.\n\n"
            + appUrl
            + "/invitations/accept?token="
            + token
            + "\n\n"
            + "This single-use link expires in 24 hours. If you did not expect it, ignore this"
            + " email.";
    db.update(
        "insert into tenant.invitation_mail_outbox(id,invitation_id,recipient,encrypted_body)"
            + " values(?,?,?,?)",
        UUID.randomUUID(),
        invitation,
        email,
        cipher.encrypt(body));
  }

  @Transactional
  public Map<String, Object> create(Jwt jwt, UUID tenant, InvitationController.InviteInput in) {
    admin.lock(tenant);
    var c = auth.resolve(jwt, tenant, Permission.STAFF_INVITE);
    admin.grant(c, in.role(), in.branchIds());
    String email = in.email().trim().toLowerCase(Locale.ROOT);
    UUID id = UUID.randomUUID();
    String token = token();
    db.update(
        "insert into"
            + " tenant.staff_invitations(id,tenant_id,email,role,token_hash,status,inviter_id,expires_at)"
            + " values(?,?,?,?,?,'PENDING',?,now()+interval '24 hours')",
        id,
        tenant,
        email,
        in.role(),
        hash(token),
        c.userId());
    for (UUID branch : in.branchIds() == null ? List.<UUID>of() : in.branchIds())
      db.update(
          "insert into tenant.invitation_branches(tenant_id,invitation_id,branch_id) values(?,?,?)",
          tenant,
          id,
          branch);
    queue(id, email, token);
    audit.record(c.userId(), tenant, null, "STAFF_INVITED", id, "SUCCESS");
    return view(id);
  }

  private List<UUID> branches(UUID invitation) {
    return db.queryForList(
        "select branch_id from tenant.invitation_branches where invitation_id=? order by branch_id",
        UUID.class,
        invitation);
  }

  Map<String, Object> view(UUID id) {
    var row =
        admin.one(
            "select"
                + " i.id,i.tenant_id,i.email,i.role,i.status,i.expires_at,i.accepted_at,i.created_at,i.updated_at,i.version,(select"
                + " o.status from tenant.invitation_mail_outbox o where o.invitation_id=i.id order"
                + " by o.created_at desc limit 1) as delivery_status from tenant.staff_invitations"
                + " i where i.id=?",
            id);
    var dto = Rows.dto(row);
    if ("PENDING".equals(row.get("status"))
        && ((java.sql.Timestamp) row.get("expires_at")).toInstant().isBefore(Instant.now()))
      dto.put("status", "EXPIRED");
    dto.put("branches", branches(id));
    return dto;
  }

  public List<Map<String, Object>> list(Jwt jwt, UUID tenant, int page, int size) {
    var c = auth.resolve(jwt, tenant, Permission.STAFF_INVITE);
    Administration.paging(page, size);
    return db
        .queryForList(
            "select id,role from tenant.staff_invitations where tenant_id=? order by created_at"
                + " desc,id",
            tenant)
        .stream()
        .filter(
            r ->
                c.tenantWide()
                    || (Administration.grantable(c.role()).contains(r.get("role").toString())
                        && branches((UUID) r.get("id")).stream()
                            .allMatch(c.assignedBranches()::contains)))
        .skip((long) page * size)
        .limit(size)
        .map(r -> view((UUID) r.get("id")))
        .toList();
  }

  @Transactional
  public Map<String, Object> revise(Jwt jwt, UUID tenant, UUID id, Long version, boolean resend) {
    admin.lock(tenant);
    var c = auth.resolve(jwt, tenant, Permission.STAFF_INVITE);
    var row =
        admin.one(
            "select * from tenant.staff_invitations where id=? and tenant_id=? for update",
            id,
            tenant);
    admin.version(((Number) row.get("version")).longValue(), version);
    admin.grant(c, row.get("role").toString(), branches(id));
    if (!"PENDING".equals(row.get("status")))
      throw new ResponseStatusException(CONFLICT, "Only pending invitations can be changed");
    db.update(
        "update tenant.invitation_mail_outbox set status='CANCELLED' where invitation_id=? and"
            + " status in ('PENDING','FAILED')",
        id);
    if (resend) {
      String next = token();
      db.update(
          "update tenant.staff_invitations set token_hash=?,expires_at=now()+interval '24"
              + " hours',version=version+1,updated_at=now() where id=?",
          hash(next),
          id);
      queue(id, row.get("email").toString(), next);
    } else
      db.update(
          "update tenant.staff_invitations set status='REVOKED',version=version+1,updated_at=now()"
              + " where id=?",
          id);
    audit.record(
        c.userId(),
        tenant,
        null,
        resend ? "INVITATION_RESENT" : "INVITATION_REVOKED",
        id,
        "SUCCESS");
    return view(id);
  }

  @Transactional
  public Map<String, Object> accept(Jwt jwt, String token) {
    var user = users.current(jwt, true);
    var candidates =
        db.queryForList(
            "select id,tenant_id from tenant.staff_invitations where token_hash=?", hash(token));
    if (candidates.size() != 1)
      throw new ResponseStatusException(NOT_FOUND, "Invitation not found");
    UUID tenant = (UUID) candidates.getFirst().get("tenant_id");
    admin.lock(tenant);
    var row =
        admin.one(
            "select * from tenant.staff_invitations where id=? for update",
            candidates.getFirst().get("id"));
    if (!hash(token).equals(row.get("token_hash")))
      throw new ResponseStatusException(CONFLICT, "Invitation was replaced");
    if (!"PENDING".equals(row.get("status"))
        || !((java.sql.Timestamp) row.get("expires_at")).toInstant().isAfter(Instant.now()))
      throw new ResponseStatusException(CONFLICT, "Invitation is expired, revoked or already used");
    if (!Boolean.TRUE.equals(user.get("email_verified"))
        || !row.get("email").toString().equalsIgnoreCase(user.get("email").toString())) {
      audit.denied((UUID) user.get("id"), tenant, "INVITATION_WRONG_ACCOUNT");
      throw new ResponseStatusException(
          FORBIDDEN, "Sign in with the verified email address that received this invitation");
    }
    var inviter =
        admin.one(
            "select u.*,m.role as membership_role,m.status as membership_status from"
                + " tenant.platform_users u join tenant.tenant_memberships m on m.user_id=u.id and"
                + " m.tenant_id=? where u.id=?",
            tenant,
            row.get("inviter_id"));
    if (!"ACTIVE".equals(inviter.get("status"))
        || !"ACTIVE".equals(inviter.get("membership_status"))
        || !Administration.grantable(inviter.get("membership_role").toString())
            .contains(row.get("role").toString()))
      throw new ResponseStatusException(FORBIDDEN, "Inviter no longer has assignment authority");
    if (!"ACTIVE"
        .equals(admin.one("select status from tenant.tenants where id=?", tenant).get("status")))
      throw new ResponseStatusException(FORBIDDEN, "Workshop is inactive");
    var ids = branches((UUID) row.get("id"));
    if (!"BRAND_OWNER".equals(inviter.get("membership_role"))) {
      var m =
          admin.one(
              "select id from tenant.tenant_memberships where user_id=? and tenant_id=?",
              row.get("inviter_id"),
              tenant);
      if (!admin.assignmentIds(tenant, (UUID) m.get("id")).containsAll(ids))
        throw new ResponseStatusException(FORBIDDEN, "Inviter branch assignment changed");
    }
    for (UUID b : ids)
      if (!"ACTIVE"
          .equals(
              admin
                  .one("select status from tenant.branches where id=? and tenant_id=?", b, tenant)
                  .get("status")))
        throw new ResponseStatusException(CONFLICT, "An invited branch is inactive");
    var existing =
        db.queryForList(
            "select id,status from tenant.tenant_memberships where tenant_id=? and user_id=?",
            tenant,
            user.get("id"));
    if (!existing.isEmpty() && "ACTIVE".equals(existing.getFirst().get("status")))
      throw new ResponseStatusException(
          CONFLICT, "You already have an active membership; ask an owner to edit it");
    UUID membership = existing.isEmpty() ? UUID.randomUUID() : (UUID) existing.getFirst().get("id");
    String role = row.get("role").toString(),
        scope =
            role.equals("BRAND_OWNER") ? "TENANT" : role.equals("CUSTOMER") ? "NONE" : "BRANCHES";
    if (existing.isEmpty())
      db.update(
          "insert into tenant.tenant_memberships(id,tenant_id,user_id,role,scope,status)"
              + " values(?,?,?,?,?,'ACTIVE')",
          membership,
          tenant,
          user.get("id"),
          role,
          scope);
    else {
      db.update(
          "update tenant.tenant_memberships set"
              + " role=?,scope=?,status='ACTIVE',version=version+1,updated_at=now() where id=?",
          role,
          scope,
          membership);
      db.update("delete from tenant.branch_memberships where membership_id=?", membership);
    }
    for (UUID branch : ids)
      db.update(
          "insert into tenant.branch_memberships(tenant_id,membership_id,branch_id) values(?,?,?)",
          tenant,
          membership,
          branch);
    db.update(
        "update tenant.staff_invitations set"
            + " status='ACCEPTED',accepted_by=?,accepted_at=now(),updated_at=now(),version=version+1"
            + " where id=?",
        user.get("id"),
        row.get("id"));
    audit.record(
        (UUID) user.get("id"), tenant, null, "INVITATION_ACCEPTED", row.get("id"), "SUCCESS");
    return Map.of("tenantId", tenant, "membershipId", membership, "role", role);
  }
}
