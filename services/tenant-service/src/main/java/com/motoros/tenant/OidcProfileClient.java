package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import java.net.http.HttpClient;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

@Component
public class OidcProfileClient {
  private final RestClient http;
  private final String endpoint;

  public OidcProfileClient(@Value("${motoros.oidc.userinfo-uri}") String endpoint) {
    this.endpoint = endpoint;
    var f =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    f.setReadTimeout(Duration.ofSeconds(5));
    http = RestClient.builder().requestFactory(f).build();
  }

  public Map<String, Object> profile(Jwt jwt) {
    try {
      var info =
          http.get()
              .uri(endpoint)
              .headers(h -> h.setBearerAuth(jwt.getTokenValue()))
              .retrieve()
              .body(Map.class);
      if (info == null || !jwt.getSubject().equals(info.get("sub")))
        throw new ResponseStatusException(UNAUTHORIZED, "Identity profile mismatch");
      return info;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Identity provider unavailable");
    }
  }
}
