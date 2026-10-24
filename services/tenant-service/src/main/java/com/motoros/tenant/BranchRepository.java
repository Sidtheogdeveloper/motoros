package com.motoros.tenant;

import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface BranchRepository extends JpaRepository<Branch, UUID> {
  List<Branch> findByTenantIdOrderByCreatedAtAsc(UUID tenantId);
}
