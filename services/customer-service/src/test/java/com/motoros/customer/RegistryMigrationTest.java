package com.motoros.customer;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
class RegistryMigrationTest {
  @Container static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:17.6-alpine");

  @Test
  void preservesAmbiguousLegacyRegistrationsWithoutMerging() {
    var initial =
        Flyway.configure()
            .dataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword())
            .defaultSchema("customer")
            .schemas("customer")
            .target("1")
            .load();
    initial.migrate();
    var db =
        new JdbcTemplate(
            new DriverManagerDataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()));
    UUID tenant = UUID.randomUUID(), owner = UUID.randomUUID();
    db.update(
        "insert into customer.customers(id,tenant_id,name,created_at) values(?,?,?,now())",
        owner,
        tenant,
        "Preserved legacy customer");
    for (String reg : List.of("TN-01-AB-1234", "TN 01 AB 1234"))
      db.update(
          "insert into"
              + " customer.vehicles(id,tenant_id,customer_id,registration,make,model,created_at)"
              + " values(?,?,?,?,?,?,now())",
          UUID.randomUUID(),
          tenant,
          owner,
          reg,
          "Honda",
          "City");
    Flyway.configure()
        .dataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword())
        .defaultSchema("customer")
        .schemas("customer")
        .load()
        .migrate();
    assertEquals(
        2,
        db.queryForObject(
            "select count(*) from customer.vehicles where identifier_conflict", Integer.class));
    assertEquals(
        2,
        db.queryForObject(
            "select count(*) from customer.vehicle_ownerships where ended_at is null",
            Integer.class));
    assertEquals(
        "Preserved legacy customer",
        db.queryForObject("select name from customer.customers where id=?", String.class, owner));
  }
}
