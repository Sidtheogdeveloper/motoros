package com.motoros.foundation.events;

import com.motoros.foundation.Records;
import com.motoros.security.ServiceTokens;
import java.time.Duration;
import java.util.*;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

public final class EventGateway {
  private final ServiceTokens tokens;
  private final Map<String, String> urls;
  private final RestClient http;

  public EventGateway(ServiceTokens tokens, Map<String, String> urls) {
    this.tokens = tokens;
    this.urls = Map.copyOf(urls);
    var factory =
        new JdkClientHttpRequestFactory(
            java.net.http.HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
    factory.setReadTimeout(Duration.ofSeconds(5));
    http =
        RestClient.builder()
            .requestFactory(factory)
            .messageConverters(
                converters ->
                    converters.replaceAll(
                        c ->
                            c
                                    instanceof
                                    org.springframework.http.converter.json
                                        .MappingJackson2HttpMessageConverter
                                ? new org.springframework.http.converter.json
                                    .MappingJackson2HttpMessageConverter(Records.JSON)
                                : c))
            .build();
  }

  public Map<String, Object> get(String producer, String path, UUID tenant) {
    if (!urls.containsKey(producer)) throw new IllegalArgumentException("UNKNOWN_PRODUCER");
    return http.get()
        .uri(urls.get(producer) + path)
        .headers(
            h -> {
              h.setBearerAuth(tokens.token());
              h.set("X-MotorOS-Tenant", tenant.toString());
            })
        .retrieve()
        .body(Map.class);
  }

  public Map<String, Object> proof(EventEnvelope event) {
    var context =
        get(event.producer(), "/api/automation/event-proof/" + event.eventId(), event.tenantId());
    var verified = EventEnvelope.read(Records.json(context.get("event")));
    if (!EventStore.hash(event).equals(EventStore.hash(verified)))
      throw new IllegalArgumentException("SOURCE_PROOF_MISMATCH");
    return context;
  }
}
