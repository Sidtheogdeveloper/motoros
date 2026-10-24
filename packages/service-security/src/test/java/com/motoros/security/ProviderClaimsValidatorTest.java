package com.motoros.security;

import static org.junit.jupiter.api.Assertions.*;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class ProviderClaimsValidatorTest {
  Map<String, Object> claims() {
    return new HashMap<>(
        Map.of(
            "sub",
            "provider-opaque-subject",
            "aud",
            List.of("motoros-api"),
            "scope",
            "openid motoros.api",
            "iat",
            Instant.now(),
            "exp",
            Instant.now().plusSeconds(300)));
  }

  boolean bad(Map<String, Object> claims) {
    return new ProviderClaimsValidator("motoros-api", "cognito-client")
        .validate(
            Jwt.withTokenValue("fixture")
                .header("alg", "RS256")
                .claims(c -> c.putAll(claims))
                .build())
        .hasErrors();
  }

  @Test
  void supportsKeycloakAndCognitoAccessTokens() {
    var c = claims();
    assertFalse(bad(c));
    c.remove("aud");
    c.put("client_id", "cognito-client");
    c.put("token_use", "access");
    assertFalse(bad(c));
    c.put("client_id", "untrusted-client");
    assertTrue(bad(c));
    c.put("client_id", "cognito-client");
    c.put("token_use", "id");
    assertTrue(bad(c));
  }

  @Test
  void rejectsMissingExpiryWrongAudienceAndMissingSubject() {
    for (String field : List.of("exp", "sub", "scope")) {
      var c = claims();
      c.remove(field);
      assertTrue(bad(c));
    }
    var c = claims();
    c.put("aud", List.of("other-api"));
    assertTrue(bad(c));
  }
}
