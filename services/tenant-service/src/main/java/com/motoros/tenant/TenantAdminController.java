package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class TenantAdminController {
  private final Administration admin;
  private final AuthorizationService auth;

  TenantAdminController(Administration admin, AuthorizationService auth) {
    this.admin = admin;
    this.auth = auth;
  }

  public record BranchInput(
      @NotBlank @Size(max = 100) String name,
      @NotBlank @Size(max = 20) String branchCode,
      @NotBlank @Size(max = 100) String city,
      @Size(max = 1000) String address,
      @Size(max = 100) String state,
      @Size(max = 20) String postalCode,
      @Size(max = 32) String phone,
      @Email @Size(max = 254) String email,
      @Size(max = 80) String timezone,
      Map<String, Map<String, Object>> operatingHours,
      Map<String, Object> settings,
      String status,
      Long version) {}

  public record WorkshopInput(
      @NotBlank @Size(max = 120) String name,
      @NotBlank @Email @Size(max = 254) String businessEmail,
      @Size(max = 32) String businessPhone,
      @Size(max = 1000) String businessAddress,
      @Size(max = 80) String country,
      @Size(max = 80) String timezone,
      @Size(max = 3) String currency,
      @Valid @NotNull BranchInput primaryBranch) {}

  public record BrandInput(
      @NotBlank @Size(max = 120) String name,
      @Email @Size(max = 254) String businessEmail,
      @Size(max = 32) String businessPhone,
      @Size(max = 1000) String businessAddress,
      @Size(max = 80) String country,
      @Size(max = 80) String timezone,
      @Size(max = 3) String currency,
      @NotNull @Min(0) Long version) {}

  public record StaffInput(
      String role, List<UUID> branchIds, String status, @NotNull @Min(0) Long version) {}

  public record StatusInput(@NotBlank String status, @NotNull @Min(0) Long version) {}

  @PostMapping("/tenants")
  @ResponseStatus(CREATED)
  public Map<String, Object> create(
      @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody WorkshopInput in) {
    return admin.onboard(jwt, in);
  }

  @GetMapping("/tenants")
  public List<Map<String, Object>> tenants(@AuthenticationPrincipal Jwt jwt) {
    return auth.memberships(jwt);
  }

  @GetMapping("/tenants/current")
  public Map<String, Object> current(@AuthenticationPrincipal Jwt jwt) {
    return admin.tenant(jwt, Access.tenant(jwt));
  }

  @GetMapping("/tenants/{id}")
  public Map<String, Object> get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
    return admin.tenant(jwt, id);
  }

  @PatchMapping("/tenants/{id}")
  public Map<String, Object> update(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody BrandInput in) {
    return admin.updateTenant(jwt, id, in);
  }

  /** Only location labels for permitted cross-branch history, never contacts or staffing. */
  @GetMapping("/history-branches")
  public List<Map<String, Object>> historyBranches(@AuthenticationPrincipal Jwt jwt) {
    UUID tenant = Access.tenant(jwt);
    auth.resolve(jwt, tenant, Permission.VEHICLE_HISTORY_READ);
    return admin.historyBranches(tenant);
  }

  @GetMapping("/branches")
  public List<Map<String, Object>> branches(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "100") int size) {
    return admin.branches(jwt, Access.tenant(jwt), page, size);
  }

  @GetMapping("/tenants/{tenantId}/branches")
  public List<Map<String, Object>> tenantBranches(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    return admin.branches(jwt, tenantId, page, size);
  }

  @PostMapping("/branches")
  @ResponseStatus(CREATED)
  public Map<String, Object> createBranch(
      @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BranchInput in) {
    return admin.createBranch(jwt, Access.tenant(jwt), in);
  }

  @PostMapping("/tenants/{tenantId}/branches")
  @ResponseStatus(CREATED)
  public Map<String, Object> createTenantBranch(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @Valid @RequestBody BranchInput in) {
    return admin.createBranch(jwt, tenantId, in);
  }

  @GetMapping("/branches/{id}")
  public Map<String, Object> branch(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
    return admin.branch(jwt, Access.tenant(jwt), id);
  }

  @PatchMapping("/branches/{id}")
  public Map<String, Object> updateBranch(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody BranchInput in) {
    return admin.updateBranch(jwt, Access.tenant(jwt), id, in);
  }

  @GetMapping("/tenants/{tenantId}/staff")
  public List<Map<String, Object>> staff(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(required = false) String role,
      @RequestParam(required = false) UUID branchId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    return admin.staff(jwt, tenantId, q, role, branchId, page, size);
  }

  @GetMapping("/tenants/{tenantId}/staff/{id}")
  public Map<String, Object> staffDetail(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID tenantId, @PathVariable UUID id) {
    return admin.staffDetail(jwt, tenantId, id);
  }

  @PatchMapping({
    "/tenants/{tenantId}/staff/{id}/roles",
    "/tenants/{tenantId}/staff/{id}/branches",
    "/tenants/{tenantId}/staff/{id}"
  })
  public Map<String, Object> staffUpdate(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @PathVariable UUID id,
      @Valid @RequestBody StaffInput in) {
    return admin.updateStaff(jwt, tenantId, id, in);
  }

  @PostMapping("/tenants/{tenantId}/staff/{id}/deactivate")
  public Map<String, Object> deactivate(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @PathVariable UUID id,
      @Valid @RequestBody StaffInput in) {
    return admin.updateStaff(
        jwt, tenantId, id, new StaffInput(in.role(), in.branchIds(), "INACTIVE", in.version()));
  }

  @PostMapping("/platform/tenants/{tenantId}/status")
  public Map<String, Object> status(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @Valid @RequestBody StatusInput in) {
    return admin.platformStatus(jwt, tenantId, in);
  }

  @GetMapping("/tenants/{tenantId}/audit")
  public List<Map<String, Object>> audit(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    auth.resolve(jwt, tenantId, Permission.TENANT_UPDATE);
    Administration.paging(page, size);
    return admin.auditEvents(tenantId, page, size);
  }
}
