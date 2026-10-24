package com.motoros.customer;

import jakarta.persistence.*;
import java.time.*;
import java.util.*;

@Entity
@Table(name = "vehicles")
public class Vehicle {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false)
  public UUID tenantId;

  @Column(nullable = false)
  public UUID customerId;

  @Column(nullable = false)
  public String registration;

  @Column(nullable = false)
  public String make;

  @Column(nullable = false)
  public String model;

  @Column(nullable = false)
  public Instant createdAt = Instant.now();

  protected Vehicle() {}

  public Vehicle(UUID tenant, UUID customer, String reg, String make, String model) {
    this.tenantId = tenant;
    this.customerId = customer;
    this.registration = reg;
    this.make = make;
    this.model = model;
  }
}
