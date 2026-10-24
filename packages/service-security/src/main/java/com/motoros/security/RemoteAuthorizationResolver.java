package com.motoros.security;

import static org.springframework.http.HttpStatus.*;

import java.net.http.HttpClient;
import java.time.*;
import java.util.*;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

public class RemoteAuthorizationResolver implements AuthorizationResolver {
  private final RestClient http;
  private final ServiceTokens tokens;

  public RemoteAuthorizationResolver(String url, ServiceTokens tokens) {
    this.tokens = tokens;
    var f =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    f.setReadTimeout(Duration.ofSeconds(5));
    http = RestClient.builder().baseUrl(url).requestFactory(f).build();
  }

  public AuthorizationContext resolve(Jwt identity, UUID tenant, Permission permission) {
    try {
      return http.get()
          .uri(
              b -> {
                b.path("/api/internal/context").queryParam("tenantId", tenant);
                if (permission != null) b.queryParam("permission", permission);
                return b.build();
              })
          .headers(
              h -> {
                h.setBearerAuth(tokens.token());
                h.set("X-Correlation-ID", Correlation.current());
                h.set("X-User-Token", identity.getTokenValue());
              })
          .retrieve()
          .body(AuthorizationContext.class);
    } catch (org.springframework.web.client.HttpClientErrorException e) {
      throw new ResponseStatusException(
          e.getStatusCode().value() == 401 ? UNAUTHORIZED : FORBIDDEN,
          "Current membership does not permit this request");
    } catch (Exception e) {
      throw new ResponseStatusException(
          SERVICE_UNAVAILABLE, "Authorization service unavailable; request denied");
    }
  }
}
