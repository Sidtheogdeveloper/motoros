package com.motoros.foundation.events;

import com.motoros.security.ServiceTokens;
import io.micrometer.core.instrument.*;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.micrometer.observation.ObservationRegistry;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "motoros.events.enabled", havingValue = "true")
@Import({EventSourceController.class, EventAdminController.class})
public class EventConfiguration {
  @Bean
  static org.springframework.beans.factory.config.BeanPostProcessor eventTransactionCorrelation(
      ObjectProvider<javax.sql.DataSource> ds) {
    return new org.springframework.beans.factory.config.BeanPostProcessor() {
      public Object postProcessAfterInitialization(Object bean, String name) {
        if (bean
            instanceof
            org.springframework.transaction.support.AbstractPlatformTransactionManager manager) {
          manager.addListener(
              new org.springframework.transaction.TransactionExecutionListener() {
                public void afterBegin(
                    org.springframework.transaction.TransactionExecution execution,
                    Throwable failure) {
                  if (failure == null) {
                    var db = new JdbcTemplate(ds.getObject());
                    db.queryForObject(
                        "select set_config('motoros.correlation_id',?,true)",
                        String.class,
                        com.motoros.security.Correlation.current());
                    var context = io.opentelemetry.api.trace.Span.current().getSpanContext();
                    if (context.isValid())
                      db.queryForObject(
                          "select set_config('motoros.traceparent',?,true)",
                          String.class,
                          "00-"
                              + context.getTraceId()
                              + "-"
                              + context.getSpanId()
                              + "-"
                              + context.getTraceFlags().asHex());
                  }
                }
              });
        }
        return bean;
      }
    };
  }

  @Bean
  EventStore eventStore(JdbcTemplate db, PlatformTransactionManager manager, Environment env) {
    return new EventStore(
        db, manager, env.getRequiredProperty("spring.application.name").replace("motoros-", ""));
  }

  @Bean
  SourceReconciliation sourceReconciliation(EventStore store) {
    return new SourceReconciliation(store);
  }

  @Bean
  org.springframework.scheduling.config.ScheduledTaskRegistrar topologyMaintenance(
      EventBroker broker, Environment env) {
    var tasks = new org.springframework.scheduling.config.ScheduledTaskRegistrar();
    if (env.getProperty("motoros.events.bootstrap", Boolean.class, false))
      tasks.addFixedDelayTask(
          () -> {
            try {
              broker.bootstrap();
            } catch (Exception e) {
              org.slf4j.LoggerFactory.getLogger(EventConfiguration.class)
                  .warn("local_topology_unavailable category=TRANSPORT");
            }
          },
          30000);
    return tasks;
  }

  @Bean
  EventGateway eventGateway(ServiceTokens tokens, Environment env) {
    var urls = new HashMap<String, String>();
    String[] names = {
      "tenant",
      "customer",
      "workorder",
      "booking",
      "inventory",
      "billing",
      "notification",
      "analytics"
    };
    for (int i = 0; i < names.length; i++)
      urls.put(
          names[i],
          env.getProperty("motoros." + names[i] + "-url", "http://127.0.0.1:" + (8081 + i)));
    return new EventGateway(tokens, urls);
  }

  @Bean(destroyMethod = "close")
  EventBroker eventBroker(
      Environment env, ObjectProvider<io.opentelemetry.api.OpenTelemetry> telemetry) {
    String endpoint = env.getProperty("motoros.events.endpoint", "");
    var broker =
        new EventBroker(
                endpoint,
                env.getProperty("motoros.events.region", "ap-south-1"),
                env.getRequiredProperty("motoros.events.account"),
                env.getProperty("motoros.events.prefix", "motoros"))
            .telemetry(telemetry.getIfAvailable(io.opentelemetry.api.OpenTelemetry::noop));
    if (env.getProperty("motoros.events.bootstrap", Boolean.class, false)) {
      if (endpoint.isBlank()) throw new IllegalStateException("Bootstrap is local-only");
      try {
        broker.bootstrap();
      } catch (Exception e) {
        org.slf4j.LoggerFactory.getLogger(EventConfiguration.class)
            .warn("local_topology_start_deferred category=TRANSPORT");
      }
    }
    return broker;
  }

  @Bean
  EventWorker eventWorker(
      EventStore store,
      EventBroker broker,
      EventGateway gateway,
      List<EventHandler> handlers,
      ObjectProvider<MeterRegistry> metrics,
      ObjectProvider<ObservationRegistry> observations,
      Environment env) {
    return new EventWorker(
        store,
        broker,
        gateway,
        handlers,
        metrics.getIfAvailable(SimpleMeterRegistry::new),
        observations.getIfAvailable(ObservationRegistry::create),
        env.getProperty("motoros.events.publish-enabled", Boolean.class, true),
        env.getProperty("motoros.events.consume-enabled", Boolean.class, true));
  }

  @Bean
  ThreadPoolTaskScheduler eventTaskScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(4);
    scheduler.setThreadNamePrefix("motoros-worker-");
    scheduler.setWaitForTasksToCompleteOnShutdown(true);
    scheduler.setAwaitTerminationSeconds(20);
    return scheduler;
  }
}
