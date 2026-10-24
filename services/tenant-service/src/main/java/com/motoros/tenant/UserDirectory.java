package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class UserDirectory {
  private final JdbcTemplate db;
  private final OidcProfileClient profiles;

  UserDirectory(JdbcTemplate db, OidcProfileClient profiles) {
    this.db = db;
    this.profiles = profiles;
  }

  public Map<String, Object> current(Jwt jwt, boolean refresh) {
    String issuer = jwt.getIssuer().toString();
    var existing =
        db.queryForList(
            "select * from tenant.platform_users where issuer=? and subject=?",
            issuer,
            jwt.getSubject());
    if (refresh || existing.isEmpty()) {
      var p = profiles.profile(jwt);
      Object verified = p.get("email_verified");
      if (!(Boolean.TRUE.equals(verified) || "true".equals(verified))
          || !(p.get("email") instanceof String email)
          || email.length() > 254)
        throw new ResponseStatusException(
            FORBIDDEN, "Verify your identity-provider email before continuing");
      String display = Objects.toString(p.getOrDefault("name", email));
      if (display.length() > 120) display = display.substring(0, 120);
      db.update(
          "insert into"
              + " tenant.platform_users(id,issuer,subject,email,email_verified,display_name,status)"
              + " values(?,?,?,?,true,?,'ACTIVE') on conflict(issuer,subject) do update set"
              + " email=excluded.email,email_verified=true,updated_at=now()",
          UUID.randomUUID(),
          issuer,
          jwt.getSubject(),
          email.toLowerCase(Locale.ROOT),
          display);
      existing =
          db.queryForList(
              "select * from tenant.platform_users where issuer=? and subject=?",
              issuer,
              jwt.getSubject());
    }
    var user = existing.getFirst();
    if (!"ACTIVE".equals(user.get("status")))
      throw new ResponseStatusException(FORBIDDEN, "User account is inactive");
    return user;
  }
}
