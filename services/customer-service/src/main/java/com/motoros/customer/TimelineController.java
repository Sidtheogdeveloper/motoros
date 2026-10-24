package com.motoros.customer;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/vehicles")
public class TimelineController {
  private final Registry registry;
  private final ServiceTokens tokens;
  private final RestClient http;

  TimelineController(
      Registry registry,
      ServiceTokens tokens,
      @Value("${motoros.workorder-url:http://127.0.0.1:8083}") String url) {
    this.registry = registry;
    this.tokens = tokens;
    var factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    factory.setReadTimeout(Duration.ofSeconds(8));
    http = RestClient.builder().baseUrl(url).requestFactory(factory).build();
  }

  @GetMapping("/{id}/timeline")
  public Map<String, Object> timeline(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    Access.require(j, Permission.VEHICLE_HISTORY_READ);
    Access.branch(j, branchId);
    Registry.paging(page, size);
    registry.vehicle(Access.tenant(j), id);
    try {
      return http.get()
          .uri(
              "/api/vehicles/{id}/timeline?branchId={branch}&page={page}&size={size}",
              id,
              branchId,
              page,
              size)
          .headers(
              h -> {
                h.setBearerAuth(tokens.token());
                h.set("X-User-Token", j.getTokenValue());
                h.set("X-MotorOS-Tenant", Access.tenant(j).toString());
                h.set("X-Correlation-ID", Correlation.current());
              })
          .retrieve()
          .body(Map.class);
    } catch (HttpClientErrorException e) {
      throw new ResponseStatusException(
          e.getStatusCode(), "History is not accessible in this context");
    } catch (Exception e) {
      throw new ResponseStatusException(
          SERVICE_UNAVAILABLE,
          "Service timeline unavailable. Retry when Work Order Service is healthy.");
    }
  }
}
