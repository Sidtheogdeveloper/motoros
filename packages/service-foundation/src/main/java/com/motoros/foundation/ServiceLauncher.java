package com.motoros.foundation;

import java.util.*;
import org.flywaydb.core.Flyway;
import org.springframework.boot.SpringApplication;

/**
 * Migration mode deliberately never creates a Spring context, HTTP listener or scheduled worker.
 */
public final class ServiceLauncher {
  private ServiceLauncher() {}

  public static void run(Class<?> application, String[] args) {
    boolean migrationOnly = "true".equals(System.getenv("MOTOROS_MIGRATE_ONLY"));
    boolean validationOnly = "true".equals(System.getenv("MOTOROS_VALIDATE_ONLY"));
    if (migrationOnly && validationOnly)
      throw new IllegalArgumentException("Choose migration or validation mode");
    if (migrationOnly || validationOnly) {
      String schema =
          application.getPackageName().substring(application.getPackageName().lastIndexOf('.') + 1);
      if (!Set.of(
              "tenant",
              "customer",
              "booking",
              "workorder",
              "inventory",
              "billing",
              "notification",
              "analytics")
          .contains(schema)) throw new IllegalArgumentException("Unknown schema");
      var flyway =
          Flyway.configure()
              .dataSource(
                  required("DATABASE_URL"),
                  required("DATABASE_USER"),
                  required("DATABASE_PASSWORD"))
              .schemas(schema)
              .defaultSchema(schema)
              .createSchemas(false)
              .locations("classpath:db/migration")
              .cleanDisabled(true)
              .load();
      if (validationOnly) {
        flyway.validate();
        return;
      }
      flyway.migrate();
      try (var connection = flyway.getConfiguration().getDataSource().getConnection();
          var statement = connection.createStatement()) {
        statement.execute(
            "revoke all on table " + schema + ".flyway_schema_history from " + schema + "_app");
        statement.execute(
            "grant select on table " + schema + ".flyway_schema_history to " + schema + "_app");
      } catch (java.sql.SQLException e) {
        throw new IllegalStateException("Migration privilege finalization failed", e);
      }
      return;
    }
    if (Arrays.asList(System.getenv().getOrDefault("SPRING_PROFILES_ACTIVE", "").split(","))
        .contains("cloud")) {
      for (String key :
          List.of(
              "DATABASE_URL",
              "DATABASE_PASSWORD",
              "OIDC_ISSUER",
              "OIDC_JWKS_URI",
              "OIDC_ACCEPTED_CLIENTS",
              "OIDC_MACHINE_CLIENTS",
              "MESSAGING_ACCOUNT")) required(key);
      if (!required("DATABASE_URL").contains("sslmode=verify-full")
          || !required("OIDC_ISSUER").startsWith("https://")
          || !System.getenv().getOrDefault("MESSAGING_ENDPOINT", "").isBlank()
          || "true".equals(System.getenv("MOTOROS_DEVELOPMENT_APPROVAL")))
        throw new IllegalArgumentException("Unsafe cloud configuration");
      String schema =
          application.getPackageName().substring(application.getPackageName().lastIndexOf('.') + 1);
      Flyway.configure()
          .dataSource(
              required("DATABASE_URL"), required("DATABASE_USER"), required("DATABASE_PASSWORD"))
          .schemas(schema)
          .defaultSchema(schema)
          .createSchemas(false)
          .locations("classpath:db/migration")
          .cleanDisabled(true)
          .load()
          .validate();
    }
    SpringApplication.run(application, args);
  }

  private static String required(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank())
      throw new IllegalArgumentException("Missing configuration: " + key);
    return value;
  }
}
