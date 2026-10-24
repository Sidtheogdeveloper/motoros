package com.motoros.security;

import static org.springframework.http.HttpStatus.*;

import java.util.*;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

public final class Access {
  private Access() {}

  public static UUID tenant(Jwt jwt) {
    requireContext(jwt);
    return UUID.fromString(jwt.getClaimAsString("tenant"));
  }

  public static UUID user(Jwt jwt) {
    requireContext(jwt);
    return UUID.fromString(jwt.getClaimAsString("motorosUser"));
  }

  private static void requireContext(Jwt jwt) {
    if (!Boolean.TRUE.equals(jwt.getClaim("motorosAuthorized")))
      throw new ResponseStatusException(FORBIDDEN, "Verified MotorOS membership required");
  }

  public static void require(Jwt jwt, Permission permission) {
    requireContext(jwt);
    var p = jwt.getClaimAsStringList("permissions");
    if (p == null || !p.contains(permission.name()))
      throw new ResponseStatusException(FORBIDDEN, "Permission required: " + permission.name());
  }

  public static void branch(Jwt jwt, UUID branch) {
    requireContext(jwt);
    var ids = jwt.getClaimAsStringList("branches");
    if (branch == null || ids == null || !ids.contains(branch.toString()))
      throw new ResponseStatusException(FORBIDDEN, "Active branch membership required");
  }
}
