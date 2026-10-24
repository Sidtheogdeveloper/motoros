package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class IdentityController {
  private final UserDirectory users;
  private final AuthorizationService auth;
  private final JdbcTemplate db;

  IdentityController(UserDirectory users, AuthorizationService auth, JdbcTemplate db) {
    this.users = users;
    this.auth = auth;
    this.db = db;
  }

  @GetMapping({"/auth/me", "/auth/session"})
  public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
    return Map.of("user", Rows.dto(users.current(jwt, true)), "memberships", auth.memberships(jwt));
  }

  record Profile(@NotBlank @Size(max = 120) String displayName, @Size(max = 32) String phone) {}

  @PatchMapping("/auth/profile")
  public Map<String, Object> profile(
      @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Profile in) {
    var user = users.current(jwt, true);
    db.update(
        "update tenant.platform_users set display_name=?,phone=?,updated_at=now() where id=?",
        in.displayName().trim(),
        in.phone(),
        user.get("id"));
    return Rows.dto(users.current(jwt, false));
  }

  @GetMapping("/me/memberships")
  public List<Map<String, Object>> memberships(@AuthenticationPrincipal Jwt jwt) {
    return auth.memberships(jwt);
  }

  @GetMapping("/me/permissions")
  public AuthorizationContext permissions(@AuthenticationPrincipal Jwt jwt) {
    return auth.resolve(jwt, Access.tenant(jwt), null);
  }

  @GetMapping("/internal/context")
  public AuthorizationContext internal(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam UUID tenantId,
      @RequestParam(required = false) Permission permission,
      HttpServletRequest request) {
    if (request.getAttribute("trustedService") == null)
      throw new ResponseStatusException(FORBIDDEN);
    return auth.resolve(jwt, tenantId, permission);
  }

  @GetMapping("/roles")
  public Map<String, Object> roles(@AuthenticationPrincipal Jwt jwt) {
    var c = auth.resolve(jwt, Access.tenant(jwt), null);
    return Map.of(
        "grantableRoles", Administration.grantable(c.role()), "permissions", c.permissions());
  }

  @GetMapping("/platform/tenants")
  public List<Map<String, Object>> platformTenants(@AuthenticationPrincipal Jwt jwt) {
    var user = users.current(jwt, true);
    if (!Boolean.TRUE.equals(user.get("platform_admin")))
      throw new ResponseStatusException(FORBIDDEN, "Platform administrator access required");
    return db
        .queryForList("select id,name,status,version from tenant.tenants order by created_at")
        .stream()
        .map(Rows::dto)
        .toList();
  }
}
