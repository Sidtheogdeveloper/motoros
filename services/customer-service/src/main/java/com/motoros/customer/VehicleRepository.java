package com.motoros.customer;

import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface VehicleRepository extends JpaRepository<Vehicle, UUID> {
  Optional<Vehicle> findByIdAndTenantId(UUID id, UUID tenant);

  Page<Vehicle> findByTenantId(UUID tenant, Pageable page);
}
