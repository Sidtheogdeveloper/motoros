package com.motoros.workorder;

import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface WorkOrderRepository extends JpaRepository<WorkOrder, UUID> {
  Page<WorkOrder> findByTenantIdAndVehicleIdAndStatusIn(
      UUID tenant, UUID vehicle, List<Status> statuses, Pageable page);

  Page<WorkOrder> findByTenantIdAndBranchIdIn(UUID tenant, List<UUID> branches, Pageable page);

  Optional<WorkOrder> findByIdAndTenantId(UUID id, UUID tenant);

  Page<WorkOrder> findByTenantIdAndBranchId(UUID tenant, UUID branch, Pageable page);

  List<WorkOrder> findByTenantIdAndVehicleIdAndStatusInOrderByCreatedAtDesc(
      UUID tenant, UUID vehicle, List<Status> statuses);
}
