package com.motoros.tenant;

import jakarta.persistence.*;
import java.time.*;
import java.util.*;

@Entity
@Table(name = "tenants")
public class Tenant {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false)
  public String name;

  @Column(nullable = false)
  public Instant createdAt = Instant.now();

  protected Tenant() {}

  public Tenant(String name) {
    this.name = name;
  }
}
