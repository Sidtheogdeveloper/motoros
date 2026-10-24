package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthorizationService implements AuthorizationResolver {
  private final JdbcTemplate db;
  private final UserDirectory users;
  private final AuditEvents audit;

  AuthorizationService(JdbcTemplate db, UserDirectory users, AuditEvents audit) {
    this.db = db;
    this.users = users;
    this.audit = audit;
  }

  public AuthorizationContext resolve(Jwt jwt, UUID tenant, Permission permission) {
    UUID user = (UUID) users.current(jwt, false).get("id");
    var memberships =
        db.queryForList(
            "select m.* from tenant.tenant_memberships m join tenant.tenants t on t.id=m.tenant_id"
                + " where m.user_id=? and m.tenant_id=? and m.status='ACTIVE' and"
                + " t.status='ACTIVE'",
            user,
            tenant);
    if (memberships.size() != 1) {
      audit.denied(user, tenant, "MEMBERSHIP_ACCESS");
      throw new ResponseStatusException(FORBIDDEN, "Active workshop membership required");
    }
    var m = memberships.getFirst();
    boolean wide = "TENANT".equals(m.get("scope"));
    var rows =
        wide
            ? db.queryForList(
                "select id,status from tenant.branches where tenant_id=? order by created_at",
                tenant)
            : db.queryForList(
                "select b.id,b.status from tenant.branches b join tenant.branch_memberships bm on"
                    + " bm.branch_id=b.id and bm.tenant_id=b.tenant_id where bm.membership_id=? and"
                    + " bm.tenant_id=? order by b.created_at",
                m.get("id"),
                tenant);
    var assigned = rows.stream().map(r -> (UUID) r.get("id")).toList();
    var active =
        rows.stream()
            .filter(r -> "ACTIVE".equals(r.get("status")))
            .map(r -> (UUID) r.get("id"))
            .toList();
    List<String> permissions =
        db.queryForList(
            "select permission from tenant.role_permissions where role=? order by permission",
            String.class,
            m.get("role"));
    if (!wide && active.isEmpty())
      permissions =
          permissions.stream()
              .filter(p -> List.of("TENANT_READ", "BRANCH_READ").contains(p))
              .toList();
    if (permission != null && !permissions.contains(permission.name())) {
      audit.denied(user, tenant, "PERMISSION_" + permission.name());
      throw new ResponseStatusException(FORBIDDEN, "Permission required: " + permission.name());
    }
    return new AuthorizationContext(
        user, tenant, m.get("role").toString(), wide, permissions, active, assigned);
  }

  public List<Map<String, Object>> memberships(Jwt jwt) {
    UUID user = (UUID) users.current(jwt, false).get("id");
    return db
        .queryForList(
            "select m.id,m.tenant_id,t.name,m.role,m.scope,m.status,t.status as tenant_status from"
                + " tenant.tenant_memberships m join tenant.tenants t on t.id=m.tenant_id where"
                + " m.user_id=? and m.status='ACTIVE' order by t.created_at",
            user)
        .stream()
        .map(Rows::dto)
        .toList();
  }

  public void branch(AuthorizationContext c, UUID id, boolean active) {
    if (!(active ? c.branches() : c.assignedBranches()).contains(id))
      throw new ResponseStatusException(FORBIDDEN, "Branch assignment required");
  }
}
