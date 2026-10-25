package com.motoros.foundation.events;

import io.micrometer.cloudwatch2.*;
import io.micrometer.core.instrument.Clock;
import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cloudwatch.CloudWatchAsyncClient;

/** Cloud-only exporter; namespaces and dimensions contain no tenant/customer identifiers. */
@Configuration
@ConditionalOnProperty(name = "motoros.cloud", havingValue = "true")
public class CloudMetrics {
  @Bean(destroyMethod = "close")
  CloudWatchAsyncClient cloudMetricsClient(Environment env) {
    return CloudWatchAsyncClient.builder()
        .region(Region.of(env.getRequiredProperty("AWS_REGION")))
        .build();
  }

  @Bean(destroyMethod = "close")
  CloudWatchMeterRegistry cloudMetricsRegistry(CloudWatchAsyncClient client, Environment env) {
    var config =
        new CloudWatchConfig() {
          public String get(String key) {
            return null;
          }

          public String namespace() {
            return "MotorOS/" + env.getRequiredProperty("MOTOROS_ENVIRONMENT");
          }

          public Duration step() {
            return Duration.ofMinutes(1);
          }
        };
    var registry = new CloudWatchMeterRegistry(config, Clock.SYSTEM, client);
    registry
        .config()
        .commonTags(
            "service",
            env.getRequiredProperty("spring.application.name"),
            "environment",
            env.getRequiredProperty("MOTOROS_ENVIRONMENT"));
    registry
        .config()
        .meterFilter(
            io.micrometer.core.instrument.config.MeterFilter.denyUnless(
                id ->
                    id.getName().startsWith("motoros.")
                        || java.util.Set.of(
                                "hikaricp.connections.active",
                                "hikaricp.connections.pending",
                                "hikaricp.connections.timeout")
                            .contains(id.getName())));
    return registry;
  }
}
