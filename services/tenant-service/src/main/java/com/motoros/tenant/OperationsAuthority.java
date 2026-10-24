package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class OperationsAuthority {
  private final Records rows;
  private final AuthorizationService authority;
  private final AuditEvents audit;

  public OperationsAuthority(JdbcTemplate db, AuthorizationService authority, AuditEvents audit) {
    this.rows = new Records(db);
    this.authority = authority;
    this.audit = audit;
  }

  public record Capability(
      @NotNull UUID branchId,
      boolean qualityReview,
      boolean safetyReview,
      @NotBlank @Size(min = 10, max = 1000) String attestation,
      @NotNull @Min(0) Long version) {}

  public record Unavailable(
      @NotNull UUID branchId,
      @NotNull Instant startsAt,
      @NotNull Instant endsAt,
      @NotBlank @Size(max = 300) String reason) {}

  @GetMapping("/branches/{id}/operations")
  public Map<String, Object> branch(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.BRANCH_READ);
    Access.branch(j, id);
    var row =
        rows.one(
            "select id,tenant_id,name,branch_code,timezone,operating_hours,settings,status,version"
                + " from tenant.branches where tenant_id=? and id=?",
            Access.tenant(j),
            id);
    return Records.dto(row);
  }

  @GetMapping("/branches/{id}/technicians")
  public List<Map<String, Object>> technicians(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestParam(required = false) Instant at) {
    Access.branch(j, id);
    if (!j.getClaimAsStringList("permissions").contains("WORKORDER_READ")
        && !j.getClaimAsStringList("permissions").contains("BOOKING_READ"))
      throw new ResponseStatusException(FORBIDDEN);
    UUID t = Access.tenant(j);
    return rows
        .db
        .queryForList(
            "select m.id as"
                + " membership_id,m.user_id,u.display_name,m.role,m.status,coalesce(c.quality_review,false)"
                + " as quality_review,coalesce(c.safety_review,false) as"
                + " safety_review,coalesce(c.version,0) as capability_version from"
                + " tenant.tenant_memberships m join tenant.platform_users u on u.id=m.user_id left"
                + " join tenant.staff_capabilities c on c.tenant_id=m.tenant_id and"
                + " c.membership_id=m.id where m.tenant_id=? and m.status='ACTIVE' and"
                + " u.status='ACTIVE' and (m.scope='TENANT' or exists(select 1 from"
                + " tenant.branch_memberships b where b.tenant_id=m.tenant_id and"
                + " b.membership_id=m.id and b.branch_id=?)) and m.role!='CUSTOMER' order by"
                + " u.display_name,m.id",
            t,
            id)
        .stream()
        .map(
            row -> {
              var result = Records.dto(row);
              UUID member = (UUID) row.get("membership_id");
              boolean unavailable =
                  !rows.db
                      .queryForList(
                          "select 1 from tenant.staff_unavailability where tenant_id=? and"
                              + " membership_id=? and branch_id=? and starts_at<=? and ends_at>?"
                              + " limit 1",
                          t,
                          member,
                          id,
                          java.sql.Timestamp.from(at == null ? Instant.now() : at),
                          java.sql.Timestamp.from(at == null ? Instant.now() : at))
                      .isEmpty();
              boolean technician =
                  rows.db.queryForObject(
                          "select count(*) from tenant.role_permissions where role=? and"
                              + " permission='WORKORDER_UPDATE'",
                          Integer.class,
                          row.get("role"))
                      > 0;
              result.put("technician", technician);
              result.put("available", !unavailable);
              return result;
            })
        .toList();
  }

  @GetMapping("/staff/{user}/eligibility")
  public Map<String, Object> eligible(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID user,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "TECHNICIAN") String kind,
      @RequestParam(required = false) Instant startsAt,
      @RequestParam(required = false) Instant endsAt) {
    Access.branch(j, branchId);
    var found =
        technicians(j, branchId, startsAt).stream()
            .filter(m -> user.toString().equals(m.get("userId").toString()))
            .findFirst()
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        FORBIDDEN, "Active branch staff membership required"));
    boolean allowed =
        switch (kind) {
          case "TECHNICIAN" -> Boolean.TRUE.equals(found.get("technician"));
          case "QUALITY_REVIEWER" ->
              Boolean.TRUE.equals(found.get("qualityReview"))
                  && rows.db.queryForObject(
                          "select count(*) from tenant.role_permissions where role=? and"
                              + " permission='WORKORDER_QUALITY_CHECK'",
                          Integer.class,
                          found.get("role"))
                      > 0;
          case "SAFETY_REVIEWER" ->
              Boolean.TRUE.equals(found.get("safetyReview"))
                  && rows.db.queryForObject(
                          "select count(*) from tenant.role_permissions where role=? and"
                              + " permission='WORKORDER_INSPECTION_REVIEW'",
                          Integer.class,
                          found.get("role"))
                      > 0;
          case "ADVISOR" ->
              rows.db.queryForObject(
                      "select count(*) from tenant.role_permissions where role=? and"
                          + " permission='WORKORDER_CREATE'",
                      Integer.class,
                      found.get("role"))
                  > 0;
          case "STAFF" -> true;
          default -> false;
        };
    if (!allowed)
      throw new ResponseStatusException(
          FORBIDDEN, "Employee is unavailable or lacks workshop-attested qualification");
    if (!Boolean.TRUE.equals(found.get("available")))
      throw new ResponseStatusException(
          CONFLICT, "Employee is unavailable during the requested interval");
    if (startsAt != null
        && endsAt != null
        && !rows.db
            .queryForList(
                "select 1 from tenant.staff_unavailability where tenant_id=? and membership_id=?"
                    + " and branch_id=? and starts_at<? and ends_at>? limit 1",
                Access.tenant(j),
                Records.uuid(found.get("membershipId")),
                branchId,
                java.sql.Timestamp.from(endsAt),
                java.sql.Timestamp.from(startsAt))
            .isEmpty())
      throw new ResponseStatusException(
          CONFLICT, "Employee is unavailable during the requested interval");
    return found;
  }

  @PatchMapping("/tenants/{tenant}/staff/{member}/capabilities")
  @Transactional
  public Map<String, Object> capabilities(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID tenant,
      @PathVariable UUID member,
      @Valid @RequestBody Capability in) {
    var a = authority.resolve(j, tenant, Permission.STAFF_ASSIGN_ROLE);
    authority.branch(a, in.branchId(), true);
    var target =
        rows.one(
            "select * from tenant.tenant_memberships where tenant_id=? and id=? for update",
            tenant,
            member);
    if (a.userId().equals(target.get("user_id")))
      throw new ResponseStatusException(
          FORBIDDEN, "A second authorized manager must attest qualifications");
    if (!Administration.grantable(a.role()).contains(target.get("role").toString()))
      throw new ResponseStatusException(FORBIDDEN, "Cannot attest this privileged membership");
    if (!a.tenantWide()) {
      if ("TENANT".equals(target.get("scope")))
        throw new ResponseStatusException(FORBIDDEN, "Tenant-wide attestation authority required");
      for (UUID assigned :
          rows.db.queryForList(
              "select branch_id from tenant.branch_memberships where tenant_id=? and"
                  + " membership_id=?",
              UUID.class,
              tenant,
              member)) authority.branch(a, assigned, false);
    }
    eligible(j, (UUID) target.get("user_id"), in.branchId(), "STAFF", null, null);
    if (in.safetyReview() && !in.qualityReview())
      throw new ResponseStatusException(
          BAD_REQUEST, "Safety reviewers also require quality-review attestation");
    rows.lock("capability" + tenant + member);
    var existing =
        rows.db.queryForList(
            "select * from tenant.staff_capabilities where tenant_id=? and membership_id=?",
            tenant,
            member);
    long current =
        existing.isEmpty() ? 0 : ((Number) existing.getFirst().get("version")).longValue();
    if (in.version() != current)
      throw new ResponseStatusException(CONFLICT, "Qualification record changed");
    rows.db.update(
        "insert into"
            + " tenant.staff_capabilities(tenant_id,membership_id,quality_review,safety_review,attestation,attested_by,version)"
            + " values(?,?,?,?,?,?,1) on conflict(tenant_id,membership_id) do update set"
            + " quality_review=excluded.quality_review,safety_review=excluded.safety_review,attestation=excluded.attestation,attested_by=excluded.attested_by,version=tenant.staff_capabilities.version+1,updated_at=now()",
        tenant,
        member,
        in.qualityReview(),
        in.safetyReview(),
        in.attestation(),
        a.userId());
    audit.record(
        a.userId(), tenant, in.branchId(), "WORKSHOP_QUALIFICATION_ATTESTED", member, "SUCCESS");
    return Records.dto(
        rows.one(
            "select * from tenant.staff_capabilities where tenant_id=? and membership_id=?",
            tenant,
            member));
  }

  @PostMapping("/tenants/{tenant}/staff/{member}/unavailability")
  @Transactional
  public Map<String, Object> unavailable(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID tenant,
      @PathVariable UUID member,
      @Valid @RequestBody Unavailable in) {
    var a = authority.resolve(j, tenant, Permission.WORKORDER_ASSIGN);
    authority.branch(a, in.branchId(), true);
    var target =
        rows.one(
            "select * from tenant.tenant_memberships where tenant_id=? and id=?", tenant, member);
    eligible(j, (UUID) target.get("user_id"), in.branchId(), "STAFF", null, null);
    if (!in.endsAt().isAfter(in.startsAt())
        || Duration.between(in.startsAt(), in.endsAt()).toDays() > 365)
      throw new ResponseStatusException(BAD_REQUEST, "Invalid unavailability interval");
    UUID id = UUID.randomUUID();
    rows.db.update(
        "insert into"
            + " tenant.staff_unavailability(id,tenant_id,membership_id,branch_id,starts_at,ends_at,reason)"
            + " values(?,?,?,?,?,?,?)",
        id,
        tenant,
        member,
        in.branchId(),
        java.sql.Timestamp.from(in.startsAt()),
        java.sql.Timestamp.from(in.endsAt()),
        in.reason());
    audit.record(
        a.userId(), tenant, in.branchId(), "STAFF_UNAVAILABILITY_RECORDED", member, "SUCCESS");
    return Map.of("id", id);
  }
}
