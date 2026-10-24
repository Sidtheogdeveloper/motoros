package com.motoros.workorder;

import jakarta.persistence.*;
import java.time.*;
import java.util.*;

@Entity
@Table(name = "work_orders")
public class WorkOrder {
  @Id public UUID id = UUID.randomUUID();

  @Column(nullable = false)
  public UUID tenantId;

  @Column(nullable = false)
  public UUID branchId;

  @Column(nullable = false)
  public UUID vehicleId;

  @Column(nullable = false)
  public String complaint;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public Status status = Status.CREATED;

  @Column(nullable = false)
  public String jobCardNumber;

  @PrePersist
  void number() {
    if (jobCardNumber == null)
      jobCardNumber = "LEGACY-" + id.toString().replace("-", "").toUpperCase(java.util.Locale.ROOT);
  }

  @Version public long version;

  @Column(nullable = false)
  public Instant createdAt = Instant.now();

  @Column(nullable = false)
  public Instant updatedAt = Instant.now();

  protected WorkOrder() {}

  public WorkOrder(UUID tenant, UUID branch, UUID vehicle, String complaint) {
    this.tenantId = tenant;
    this.branchId = branch;
    this.vehicleId = vehicle;
    this.complaint = complaint;
  }
}
