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
public class InvitationController {
  private final InvitationService invites;

  InvitationController(InvitationService invites) {
    this.invites = invites;
  }

  public record InviteInput(
      @NotBlank @Email @Size(max = 254) String email,
      @NotBlank String role,
      List<UUID> branchIds) {}

  public record Version(@NotNull @Min(0) Long version) {}

  public record Accept(@NotBlank @Size(min = 32, max = 128) String token) {}

  @PostMapping("/tenants/{tenantId}/invitations")
  @ResponseStatus(CREATED)
  public Map<String, Object> create(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @Valid @RequestBody InviteInput in) {
    return invites.create(jwt, tenantId, in);
  }

  @GetMapping("/tenants/{tenantId}/invitations")
  public List<Map<String, Object>> list(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID tenantId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    return invites.list(jwt, tenantId, page, size);
  }

  @PostMapping("/invitations/{id}/revoke")
  public Map<String, Object> revoke(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody Version in) {
    return invites.revise(jwt, Access.tenant(jwt), id, in.version(), false);
  }

  @PostMapping("/invitations/{id}/resend")
  public Map<String, Object> resend(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody Version in) {
    return invites.revise(jwt, Access.tenant(jwt), id, in.version(), true);
  }

  @PostMapping("/invitations/accept")
  public Map<String, Object> accept(
      @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Accept in) {
    return invites.accept(jwt, in.token());
  }
}
