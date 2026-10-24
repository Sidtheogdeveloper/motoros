package com.motoros.customer;

import jakarta.persistence.*;
import java.time.*;
import java.util.*;

@Entity
@Table(name = "customers")
public class Customer {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false)
  public UUID tenantId;

  @Column(nullable = false)
  public String name;

  public String email;
  public String phone;

  @Column(nullable = false)
  public Instant createdAt = Instant.now();

  protected Customer() {}

  public Customer(UUID tenant, String name, String email, String phone) {
    this.tenantId = tenant;
    this.name = name;
    this.email = email;
    this.phone = phone;
  }
}
