package com.motoros.security;

import java.net.http.HttpClient;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

@Component
public class ServiceTokens {
  private final String tokenUri, clientId, secret, scope;
  private final RestClient http;
  private String cached;
  private Instant expiry = Instant.EPOCH;

  public ServiceTokens(
      @Value("${motoros.oidc.token-uri}") String tokenUri,
      @Value("${motoros.service-client-id:}") String clientId,
      @Value("${motoros.service-client-secret:}") String secret,
      @Value("${motoros.internal-scope:motoros.internal}") String scope) {
    this.tokenUri = tokenUri;
    this.clientId = clientId;
    this.secret = secret;
    this.scope = scope;
    var factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    factory.setReadTimeout(Duration.ofSeconds(5));
    http = RestClient.builder().requestFactory(factory).build();
  }

  public synchronized String token() {
    if (cached != null && Instant.now().isBefore(expiry)) return cached;
    if (clientId.isBlank() || secret.isBlank())
      throw new IllegalStateException("Service OAuth client is not configured");
    var form = new LinkedMultiValueMap<String, String>();
    form.add("grant_type", "client_credentials");
    form.add("scope", scope);
    var result =
        http.post()
            .uri(tokenUri)
            .headers(h -> h.setBasicAuth(clientId, secret))
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(form)
            .retrieve()
            .body(Map.class);
    if (result == null || !(result.get("access_token") instanceof String))
      throw new IllegalStateException("Service token unavailable");
    cached = (String) result.get("access_token");
    expiry =
        Instant.now()
            .plusSeconds(((Number) result.getOrDefault("expires_in", 60)).longValue() - 20);
    return cached;
  }
}
