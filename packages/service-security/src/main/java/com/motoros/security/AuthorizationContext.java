package com.motoros.security;

import java.util.*;

public record AuthorizationContext(
    UUID userId,
    UUID tenantId,
    String role,
    boolean tenantWide,
    List<String> permissions,
    List<UUID> branches,
    List<UUID> assignedBranches) {}
