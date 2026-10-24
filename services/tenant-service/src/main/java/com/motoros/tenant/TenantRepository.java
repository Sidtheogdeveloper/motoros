package com.motoros.tenant;

import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface TenantRepository extends JpaRepository<Tenant, UUID> {}
