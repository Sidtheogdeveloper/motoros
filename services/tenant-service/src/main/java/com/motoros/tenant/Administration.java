package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class Administration {
  final JdbcTemplate db;
  final AuthorizationService auth;
  final UserDirectory users;
  final AuditEvents audit;

  Administration(
      JdbcTemplate db, AuthorizationService auth, UserDirectory users, AuditEvents audit) {
    this.db = db;
    this.auth = auth;
    this.users = users;
    this.audit = audit;
  }

  static String text(String value, String fallback) {
    return value == null ? fallback : value.trim();
  }

  static void regional(String timezone, String currency) {
    try {
      ZoneId.of(timezone);
      Currency.getInstance(currency);
    } catch (Exception e) {
      throw new ResponseStatusException(BAD_REQUEST, "Valid time zone and currency required");
    }
  }

  Map<String, Object> one(String sql, Object... args) {
    var rows = db.queryForList(sql, args);
    if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "Record not found");
    return rows.getFirst();
  }

  public List<Map<String, Object>> historyBranches(UUID tenant) {
    return db.queryForList(
        "select id,name from tenant.branches where tenant_id=? order by name", tenant);
  }

  public List<Map<String, Object>> auditEvents(UUID tenant, int page, int size) {
    return db
        .queryForList(
            "select * from tenant.audit_events where tenant_id=? order by created_at desc limit ?"
                + " offset ?",
            tenant,
            size,
            page * size)
        .stream()
        .map(Rows::dto)
        .toList();
  }

  void lock(UUID tenant) {
    one("select id from tenant.tenants where id=? for update", tenant);
  }

  void version(long current, Long expected) {
    if (expected == null || current != expected)
      throw new ResponseStatusException(CONFLICT, "Record changed. Refresh before saving.");
  }

  void branchInput(TenantAdminController.BranchInput in) {
    if(in.settings()!=null){for(String key:List.of("appointmentCapacity","serviceBays")){Object value=in.settings().get(key);if(value!=null&&(!(value instanceof Number n)||n.doubleValue()!=n.intValue()||n.intValue()<1||n.intValue()>100))throw new ResponseStatusException(BAD_REQUEST,"Capacity must be an integer between 1 and 100");}Object dates=in.settings().get("closedDates");if(dates!=null){if(!(dates instanceof List<?> list)||list.size()>366)throw new ResponseStatusException(BAD_REQUEST,"Invalid branch closure dates");for(Object date:(List<?>)dates)try{LocalDate.parse(date.toString());}catch(Exception e){throw new ResponseStatusException(BAD_REQUEST,"Use ISO closure dates");}}}

    String code = text(in.branchCode(), "").toUpperCase(Locale.ROOT);
    if (!code.matches("[A-Z0-9][A-Z0-9_-]{1,19}"))
      throw new ResponseStatusException(BAD_REQUEST, "Use a 2-20 character branch code");
    try {
      ZoneId.of(text(in.timezone(), "Asia/Kolkata"));
    } catch (Exception e) {
      throw new ResponseStatusException(BAD_REQUEST, "Invalid branch time zone");
    }
    if (in.operatingHours() != null)
      for (var entry : in.operatingHours().entrySet()) {
        try {
          DayOfWeek.valueOf(entry.getKey());
          var v = entry.getValue();
          if (!Boolean.TRUE.equals(v.get("closed"))) {
            var a = LocalTime.parse(Objects.toString(v.get("open")));
            var b = LocalTime.parse(Objects.toString(v.get("close")));
            if (a.equals(b)) throw new IllegalArgumentException();
          }
        } catch (Exception e) {
          throw new ResponseStatusException(BAD_REQUEST, "Invalid operating hours");
        }
      }
    if (Rows.json(in.settings() == null ? Map.of() : in.settings()).length() > 4096)
      throw new ResponseStatusException(BAD_REQUEST, "Branch settings too large");
  }

  Map<String, Object> insertBranch(UUID tenant, TenantAdminController.BranchInput in) {
    branchInput(in);
    UUID id = UUID.randomUUID();
    db.update(
        "insert into"
            + " tenant.branches(id,tenant_id,name,city,created_at,branch_code,address,state,postal_code,phone,email,timezone,operating_hours,settings)"
            + " values(?,?,?,?,now(),?,?,?,?,?,?,?,?::jsonb,?::jsonb)",
        id,
        tenant,
        in.name().trim(),
        in.city().trim(),
        in.branchCode().trim().toUpperCase(Locale.ROOT),
        in.address(),
        in.state(),
        in.postalCode(),
        in.phone(),
        in.email(),
        text(in.timezone(), "Asia/Kolkata"),
        Rows.json(in.operatingHours() == null ? Map.of() : in.operatingHours()),
        Rows.json(in.settings() == null ? Map.of() : in.settings()));
    return Rows.dto(one("select * from tenant.branches where id=? and tenant_id=?", id, tenant));
  }

  @Transactional
  public Map<String, Object> onboard(Jwt jwt, TenantAdminController.WorkshopInput in) {
    var user = users.current(jwt, true);
    String tz = text(in.timezone(), "Asia/Kolkata"),
        currency = text(in.currency(), "INR").toUpperCase(Locale.ROOT);
    regional(tz, currency);
    UUID tenant = UUID.randomUUID(), membership = UUID.randomUUID();
    db.update(
        "insert into"
            + " tenant.tenants(id,name,business_email,business_phone,business_address,country,timezone,currency,created_at)"
            + " values(?,?,?,?,?,?,?,?,now())",
        tenant,
        in.name().trim(),
        in.businessEmail(),
        in.businessPhone(),
        in.businessAddress(),
        text(in.country(), "India"),
        tz,
        currency);
    db.update(
        "insert into tenant.tenant_memberships(id,tenant_id,user_id,role,scope,status)"
            + " values(?,?,?,'BRAND_OWNER','TENANT','ACTIVE')",
        membership,
        tenant,
        user.get("id"));
    var branch = insertBranch(tenant, in.primaryBranch());
    audit.record(
        (UUID) user.get("id"),
        tenant,
        (UUID) branch.get("id"),
        "TENANT_CREATED",
        tenant,
        "SUCCESS");
    return Map.of(
        "tenant",
        Rows.dto(one("select * from tenant.tenants where id=?", tenant)),
        "branch",
        branch);
  }

  public Map<String, Object> tenant(Jwt jwt, UUID tenant) {
    auth.resolve(jwt, tenant, Permission.TENANT_READ);
    return Rows.dto(one("select * from tenant.tenants where id=?", tenant));
  }

  @Transactional
  public Map<String, Object> updateTenant(
      Jwt jwt, UUID tenant, TenantAdminController.BrandInput in) {
    lock(tenant);
    var c = auth.resolve(jwt, tenant, Permission.TENANT_UPDATE);
    var row = one("select * from tenant.tenants where id=?", tenant);
    version(((Number) row.get("version")).longValue(), in.version());
    String tz = text(in.timezone(), row.get("timezone").toString()),
        currency = text(in.currency(), row.get("currency").toString()).toUpperCase(Locale.ROOT);
    regional(tz, currency);
    db.update(
        "update tenant.tenants set"
            + " name=?,business_email=?,business_phone=?,business_address=?,country=?,timezone=?,currency=?,updated_at=now(),version=version+1"
            + " where id=?",
        in.name().trim(),
        in.businessEmail(),
        in.businessPhone(),
        in.businessAddress(),
        text(in.country(), "India"),
        tz,
        currency,
        tenant);
    audit.record(c.userId(), tenant, null, "TENANT_UPDATED", tenant, "SUCCESS");
    return tenant(jwt, tenant);
  }

  @Transactional
  public Map<String, Object> createBranch(
      Jwt jwt, UUID tenant, TenantAdminController.BranchInput in) {
    lock(tenant);
    var c = auth.resolve(jwt, tenant, Permission.BRANCH_CREATE);
    var branch = insertBranch(tenant, in);
    audit.record(
        c.userId(), tenant, (UUID) branch.get("id"), "BRANCH_CREATED", branch.get("id"), "SUCCESS");
    return branch;
  }

  public List<Map<String, Object>> branches(Jwt jwt, UUID tenant, int page, int size) {
    var c = auth.resolve(jwt, tenant, Permission.BRANCH_READ);
    paging(page, size);
    return db
        .queryForList(
            "select * from tenant.branches where tenant_id=? order by created_at,id", tenant)
        .stream()
        .filter(r -> c.assignedBranches().contains((UUID) r.get("id")))
        .skip((long) page * size)
        .limit(size)
        .map(Rows::dto)
        .toList();
  }

  public Map<String, Object> branch(Jwt jwt, UUID tenant, UUID id) {
    var c = auth.resolve(jwt, tenant, Permission.BRANCH_READ);
    auth.branch(c, id, false);
    return Rows.dto(one("select * from tenant.branches where tenant_id=? and id=?", tenant, id));
  }

  @Transactional
  public Map<String, Object> updateBranch(
      Jwt jwt, UUID tenant, UUID id, TenantAdminController.BranchInput in) {
    lock(tenant);
    var c = auth.resolve(jwt, tenant, Permission.BRANCH_UPDATE);
    auth.branch(c, id, false);
    var row = one("select * from tenant.branches where tenant_id=? and id=?", tenant, id);
    version(((Number) row.get("version")).longValue(), in.version());
    branchInput(in);
    String status = text(in.status(), row.get("status").toString());
    if (!Set.of("ACTIVE", "INACTIVE").contains(status))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid branch status");
    db.update(
        "update tenant.branches set"
            + " name=?,branch_code=?,city=?,address=?,state=?,postal_code=?,phone=?,email=?,timezone=?,operating_hours=?::jsonb,settings=?::jsonb,status=?,version=version+1,updated_at=now()"
            + " where id=? and tenant_id=?",
        in.name().trim(),
        in.branchCode().trim().toUpperCase(Locale.ROOT),
        in.city().trim(),
        in.address(),
        in.state(),
        in.postalCode(),
        in.phone(),
        in.email(),
        text(in.timezone(), "Asia/Kolkata"),
        Rows.json(in.operatingHours() == null ? Map.of() : in.operatingHours()),
        Rows.json(in.settings() == null ? Map.of() : in.settings()),
        status,
        id,
        tenant);
    audit.record(
        c.userId(),
        tenant,
        id,
        status.equals("INACTIVE") ? "BRANCH_DEACTIVATED" : "BRANCH_UPDATED",
        id,
        "SUCCESS");
    return branch(jwt, tenant, id);
  }

  public static void paging(int page, int size) {
    if (page < 0 || size < 1 || size > 100)
      throw new ResponseStatusException(BAD_REQUEST, "Page must be non-negative; size 1-100");
  }

  public List<String> permissions(String role) {
    return db.queryForList(
        "select permission from tenant.role_permissions where role=? order by permission",
        String.class,
        role);
  }

  static Set<String> grantable(String role) {
    return switch (role) {
      case "BRAND_OWNER" ->
          Set.of(
              "BRAND_OWNER",
              "REGIONAL_MANAGER",
              "BRANCH_MANAGER",
              "SERVICE_ADVISOR",
              "MECHANIC",
              "INVENTORY_MANAGER",
              "CUSTOMER");
      case "REGIONAL_MANAGER" ->
          Set.of("BRANCH_MANAGER", "SERVICE_ADVISOR", "MECHANIC", "INVENTORY_MANAGER");
      case "BRANCH_MANAGER" -> Set.of("SERVICE_ADVISOR", "MECHANIC", "INVENTORY_MANAGER");
      default -> Set.of();
    };
  }

  public void grant(AuthorizationContext c, String role, List<UUID> branches) {
    if (!grantable(c.role()).contains(role))
      throw new ResponseStatusException(FORBIDDEN, "Role exceeds your assignment authority");
    var ids = branches == null ? List.<UUID>of() : branches;
    if (role.equals("BRAND_OWNER") || role.equals("CUSTOMER")) {
      if (!ids.isEmpty())
        throw new ResponseStatusException(BAD_REQUEST, "This role does not use branch assignments");
    } else {
      if (ids.isEmpty() || ids.size() > 100 || ids.stream().distinct().count() != ids.size())
        throw new ResponseStatusException(BAD_REQUEST, "Select distinct assigned branches");
      for (UUID id : ids) auth.branch(c, id, true);
    }
  }

  public List<Map<String, Object>> staff(
      Jwt jwt, UUID tenant, String q, String role, UUID branch, int page, int size) {
    var c = auth.resolve(jwt, tenant, null);
    if (!c.permissions().contains("STAFF_INVITE") && !c.permissions().contains("STAFF_ASSIGN_ROLE"))
      throw new ResponseStatusException(FORBIDDEN, "Staff management permission required");
    paging(page, size);
    var sql =
        new StringBuilder(
            "select"
                + " m.id,m.user_id,m.tenant_id,m.role,m.scope,m.status,m.created_at,m.updated_at,m.version,u.display_name,u.email,u.phone"
                + " from tenant.tenant_memberships m join tenant.platform_users u on u.id=m.user_id"
                + " where m.tenant_id=? and (lower(u.display_name) like ? or lower(u.email) like"
                + " ?)");
    var args =
        new ArrayList<Object>(
            List.of(
                tenant,
                "%" + q.toLowerCase(Locale.ROOT) + "%",
                "%" + q.toLowerCase(Locale.ROOT) + "%"));
    if (role != null && !role.isBlank()) {
      sql.append(" and m.role=?");
      args.add(role);
    }
    if (branch != null) {
      sql.append(
          " and (m.scope='TENANT' or exists(select 1 from tenant.branch_memberships bm where"
              + " bm.tenant_id=m.tenant_id and bm.membership_id=m.id and bm.branch_id=?))");
      args.add(branch);
    }
    if (!c.tenantWide()) {
      if (c.assignedBranches().isEmpty()) return List.of();
      sql.append(
          " and exists(select 1 from tenant.branch_memberships bm where bm.tenant_id=m.tenant_id"
              + " and bm.membership_id=m.id and bm.branch_id in (");
      sql.append(String.join(",", Collections.nCopies(c.assignedBranches().size(), "?")))
          .append("))");
      args.addAll(c.assignedBranches());
    }
    sql.append(" order by m.created_at,m.id limit ? offset ?");
    args.add(size);
    args.add((long) page * size);
    return db.queryForList(sql.toString(), args.toArray()).stream()
        .map(
            row -> {
              var dto = Rows.dto(row);
              dto.put("branches", assignmentIds(tenant, (UUID) row.get("id")));
              dto.put("permissions", permissions(row.get("role").toString()));
              return dto;
            })
        .toList();
  }

  List<UUID> assignmentIds(UUID tenant, UUID membership) {
    return db.queryForList(
        "select branch_id from tenant.branch_memberships where tenant_id=? and membership_id=?"
            + " order by branch_id",
        UUID.class,
        tenant,
        membership);
  }

  public Map<String, Object> staffDetail(Jwt jwt, UUID tenant, UUID member) {
    var c = auth.resolve(jwt, tenant, null);
    if (!c.permissions().contains("STAFF_INVITE") && !c.permissions().contains("STAFF_ASSIGN_ROLE"))
      throw new ResponseStatusException(FORBIDDEN);
    var row =
        one(
            "select"
                + " m.id,m.user_id,m.tenant_id,m.role,m.scope,m.status,m.created_at,m.updated_at,m.version,u.display_name,u.email,u.phone"
                + " from tenant.tenant_memberships m join tenant.platform_users u on u.id=m.user_id"
                + " where m.id=? and m.tenant_id=?",
            member,
            tenant);
    var branches = assignmentIds(tenant, member);
    if (!c.tenantWide() && branches.stream().noneMatch(c.assignedBranches()::contains))
      throw new ResponseStatusException(NOT_FOUND);
    var dto = Rows.dto(row);
    dto.put("branches", branches);
    dto.put("permissions", permissions(row.get("role").toString()));
    return dto;
  }

  @Transactional
  public Map<String, Object> updateStaff(
      Jwt jwt, UUID tenant, UUID member, TenantAdminController.StaffInput in) {
    lock(tenant);
    var c = auth.resolve(jwt, tenant, Permission.STAFF_ASSIGN_ROLE);
    var target =
        one(
            "select * from tenant.tenant_memberships where id=? and tenant_id=? for update",
            member,
            tenant);
    if (c.userId().equals(target.get("user_id")))
      throw new ResponseStatusException(
          FORBIDDEN, "You cannot change your own role or assignments");
    version(((Number) target.get("version")).longValue(), in.version());
    if (!grantable(c.role()).contains(target.get("role").toString()))
      throw new ResponseStatusException(FORBIDDEN, "Cannot modify this privileged membership");
    if (!c.tenantWide()) for (UUID b : assignmentIds(tenant, member)) auth.branch(c, b, false);
    String role = text(in.role(), target.get("role").toString()),
        status = text(in.status(), target.get("status").toString());
    if (!Set.of("ACTIVE", "INACTIVE").contains(status))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid membership status");
    List<UUID> requestedBranches =
        in.branchIds() == null ? assignmentIds(tenant, member) : in.branchIds();
    grant(c, role, requestedBranches);
    if ("BRAND_OWNER".equals(target.get("role"))
        && "ACTIVE".equals(target.get("status"))
        && (!role.equals("BRAND_OWNER") || !status.equals("ACTIVE"))) {
      Long owners =
          db.queryForObject(
              "select count(*) from tenant.tenant_memberships where tenant_id=? and"
                  + " role='BRAND_OWNER' and status='ACTIVE'",
              Long.class,
              tenant);
      if (owners == null || owners <= 1)
        throw new ResponseStatusException(
            CONFLICT, "The final active brand owner must be retained");
    }
    db.update(
        "update tenant.tenant_memberships set"
            + " role=?,scope=?,status=?,updated_at=now(),version=version+1 where id=? and"
            + " tenant_id=?",
        role,
        role.equals("BRAND_OWNER") ? "TENANT" : role.equals("CUSTOMER") ? "NONE" : "BRANCHES",
        status,
        member,
        tenant);
    db.update(
        "delete from tenant.branch_memberships where membership_id=? and tenant_id=?",
        member,
        tenant);
    for (UUID branch : requestedBranches)
      db.update(
          "insert into tenant.branch_memberships(tenant_id,membership_id,branch_id) values(?,?,?)",
          tenant,
          member,
          branch);
    audit.record(
        c.userId(),
        tenant,
        null,
        status.equals("INACTIVE") ? "STAFF_DEACTIVATED" : "STAFF_ROLE_ASSIGNED",
        member,
        "SUCCESS");
    return staffDetail(jwt, tenant, member);
  }

  @Transactional
  public Map<String, Object> platformStatus(
      Jwt jwt, UUID tenant, TenantAdminController.StatusInput in) {
    var user = users.current(jwt, true);
    if (!Boolean.TRUE.equals(user.get("platform_admin")))
      throw new ResponseStatusException(FORBIDDEN, "Platform administration permission required");
    lock(tenant);
    var target = one("select * from tenant.tenants where id=?", tenant);
    version(((Number) target.get("version")).longValue(), in.version());
    if (!Set.of("ACTIVE", "SUSPENDED", "INACTIVE").contains(in.status()))
      throw new ResponseStatusException(BAD_REQUEST);
    db.update(
        "update tenant.tenants set status=?,version=version+1,updated_at=now() where id=?",
        in.status(),
        tenant);
    audit.record((UUID) user.get("id"), tenant, null, "TENANT_STATUS_CHANGED", tenant, "SUCCESS");
    return Rows.dto(one("select id,name,status,version from tenant.tenants where id=?", tenant));
  }
}
