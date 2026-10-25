package com.motoros.security;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class CognitoClaimsTest {
  private Jwt token(String client, String use) {
    return Jwt.withTokenValue("synthetic-test-token")
        .header("alg", "RS256")
        .subject("synthetic-subject")
        .issuedAt(Instant.now().minusSeconds(10))
        .expiresAt(Instant.now().plusSeconds(290))
        .claim("client_id", client)
        .claim("token_use", use)
        .claim("scope", "motoros/api")
        .build();
  }

  @Test
  void generatedCognitoClientIdAuthenticatesAnAccessTokenWithoutAudience() {
    assertFalse(
        new ProviderClaimsValidator("motoros-api", "generated-client")
            .validate(token("generated-client", "access"))
            .hasErrors());
  }

  @Test
  void anotherClientAndIdTokensAreRejected() {
    var validator = new ProviderClaimsValidator("motoros-api", "generated-client");
    assertTrue(validator.validate(token("another-client", "access")).hasErrors());
    assertTrue(validator.validate(token("generated-client", "id")).hasErrors());
  }
}
