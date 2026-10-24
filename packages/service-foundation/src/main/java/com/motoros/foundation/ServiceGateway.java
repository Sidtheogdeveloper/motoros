package com.motoros.foundation;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.*;
import org.springframework.http.HttpMethod;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;

public class ServiceGateway {
  private final ServiceTokens tokens;
  private final RestClient client;

  public ServiceGateway(ServiceTokens tokens) {
    this.tokens = tokens;
    var factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    factory.setReadTimeout(Duration.ofSeconds(12));
    client =
        RestClient.builder()
            .requestFactory(factory)
            .messageConverters(
                converters ->
                    converters.replaceAll(
                        converter ->
                            converter
                                    instanceof
                                    org.springframework.http.converter.json
                                        .MappingJackson2HttpMessageConverter
                                ? new org.springframework.http.converter.json
                                    .MappingJackson2HttpMessageConverter(Records.JSON)
                                : converter))
            .build();
  }

  public Object call(Jwt jwt, String base, String path, String method, Object data, String key) {
    try {
      var req =
          client
              .method(HttpMethod.valueOf(method))
              .uri(base + path)
              .headers(
                  h -> {
                    h.setBearerAuth(tokens.token());
                    h.set("X-User-Token", jwt.getTokenValue());
                    h.set("X-MotorOS-Tenant", Access.tenant(jwt).toString());
                    h.set("X-Correlation-ID", Correlation.current());
                    h.set("Content-Type", "application/json");
                    if (key != null) h.set("Idempotency-Key", key);
                  });
      if (data != null) req.body(data);
      return req.retrieve().body(Object.class);
    } catch (HttpClientErrorException e) {
      throw new ResponseStatusException(
          e.getStatusCode(), "Referenced service rejected this operation");
    } catch (Exception e) {
      throw new ResponseStatusException(
          SERVICE_UNAVAILABLE,
          "Required service is unavailable; retry with the same operation key");
    }
  }

  public Map<String, Object> get(Jwt j, String base, String path) {
    return (Map<String, Object>) call(j, base, path, "GET", null, null);
  }

  public Map<String, Object> post(Jwt j, String base, String path, Object data, String key) {
    return (Map<String, Object>) call(j, base, path, "POST", data, key);
  }

  public List<Map<String, Object>> list(Jwt j, String base, String path) {
    return (List<Map<String, Object>>) call(j, base, path, "GET", null, null);
  }
}
