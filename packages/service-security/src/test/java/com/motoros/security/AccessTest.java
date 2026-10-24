package com.motoros.security;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

class AccessTest {
  Jwt context(UUID branch, List<String> permissions, boolean trusted) {
    return Jwt.withTokenValue("test-only")
        .header("alg", "RS256")
        .claim("motorosAuthorized", trusted)
        .claim("motorosUser", UUID.randomUUID().toString())
        .claim("tenant", UUID.randomUUID().toString())
        .claim("branches", List.of(branch.toString()))
        .claim("permissions", permissions)
        .build();
  }

  @Test
  void rawProviderRoleClaimsDoNotGrantMotorosAuthority() {
    var jwt = context(UUID.randomUUID(), List.of("TENANT_UPDATE"), false);
    assertThrows(
        ResponseStatusException.class, () -> Access.require(jwt, Permission.TENANT_UPDATE));
  }

  @Test
  void permissionAndBranchAreIndependent() {
    UUID branch = UUID.randomUUID();
    var jwt = context(branch, List.of("VEHICLE_HISTORY_READ"), true);
    assertDoesNotThrow(() -> Access.require(jwt, Permission.VEHICLE_HISTORY_READ));
    assertDoesNotThrow(() -> Access.branch(jwt, branch));
    assertThrows(ResponseStatusException.class, () -> Access.branch(jwt, UUID.randomUUID()));
    assertThrows(
        ResponseStatusException.class, () -> Access.require(jwt, Permission.TENANT_UPDATE));
  }
}
