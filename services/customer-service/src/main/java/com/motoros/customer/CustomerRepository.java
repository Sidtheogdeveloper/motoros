package com.motoros.customer;

import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface CustomerRepository extends JpaRepository<Customer, UUID> {
  Optional<Customer> findByIdAndTenantId(UUID id, UUID tenant);

  Page<Customer> findByTenantIdAndNameContainingIgnoreCase(UUID tenant, String q, Pageable page);
}
