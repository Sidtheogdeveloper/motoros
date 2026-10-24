package com.motoros.tenant;

import jakarta.persistence.*;
import java.time.*;
import java.util.*;

@Entity
@Table(name = "branches")
public class Branch {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false)
  public UUID tenantId;

  @Column(nullable = false)
  public String name;

  @Column(nullable = false)
  public String city;

  @Column(nullable = false)
  public Instant createdAt = Instant.now();

  protected Branch() {}

  public Branch(UUID tenant, String name, String city) {
    this.tenantId = tenant;
    this.name = name;
    this.city = city;
  }
}
