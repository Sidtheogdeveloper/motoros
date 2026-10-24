package com.motoros.security;

import java.time.*;
import java.util.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.Jwt;

final class ProviderClaimsValidator implements OAuth2TokenValidator<Jwt> {
  private final String audience;
  private final Set<String> clients;

  ProviderClaimsValidator(String audience, String clients) {
    this.audience = audience;
    this.clients = new HashSet<>(Arrays.asList(clients.split(",")));
  }

  public OAuth2TokenValidatorResult validate(Jwt jwt) {
    String client = jwt.getClaimAsString("client_id");
    String use = jwt.getClaimAsString("token_use");
    boolean intended =
        (jwt.getAudience() != null && jwt.getAudience().contains(audience))
            || (client != null && clients.contains(client) && "access".equals(use));
    String scope = jwt.getClaimAsString("scope");
    boolean valid =
        jwt.getSubject() != null
            && !jwt.getSubject().isBlank()
            && jwt.getSubject().length() <= 255
            && jwt.getExpiresAt() != null
            && jwt.getIssuedAt() != null
            && jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
            && !jwt.getIssuedAt().isAfter(Instant.now().plusSeconds(60))
            && intended
            && (use == null || use.equals("access"))
            && scope != null;
    return valid
        ? OAuth2TokenValidatorResult.success()
        : OAuth2TokenValidatorResult.failure(
            new OAuth2Error("invalid_token", "Invalid access token claims", null));
  }
}
