package com.motoros.booking;

import jakarta.validation.*;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class BookingController {
  private final Bookings service;

  BookingController(Bookings service) {
    this.service = service;
  }

  public record Input(
      @NotNull UUID branchId,
      @NotNull UUID customerId,
      @NotNull UUID vehicleId,
      @NotNull UUID serviceCategoryId,
      @NotNull Instant requestedStartTime,
      @Min(15) @Max(480) int estimatedDurationMinutes,
      @NotBlank @Size(max = 2000) String customerComplaint,
      @NotBlank String bookingSource,
      UUID assignedTechnicianId,
      Long version) {}

  public record Change(@NotNull @Min(0) Long version, @NotBlank @Size(max = 1000) String note) {}

  @GetMapping("/service-categories")
  List<Map<String, Object>> categories(@AuthenticationPrincipal Jwt j) {
    return service.categories(j);
  }

  @PostMapping("/appointments")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Map<String, Object> create(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Input in) {
    return service.save(j, null, in, key);
  }

  @GetMapping("/appointments")
  Map<String, Object> list(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant until,
      @RequestParam(defaultValue = "false") boolean today,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(required = false) UUID serviceCategoryId,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    return service.list(j, branchId, from, until, today, status, serviceCategoryId, q, page, size);
  }

  @GetMapping("/appointments/availability")
  Map<String, Object> availability(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam Instant startsAt,
      @RequestParam(defaultValue = "60") int durationMinutes,
      @RequestParam(required = false) UUID technicianId) {
    return service.availability(j, branchId, startsAt, durationMinutes, technicianId, null);
  }

  @GetMapping("/appointments/{id}")
  Map<String, Object> get(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    return service.detail(j, id);
  }

  @PatchMapping("/appointments/{id}")
  Map<String, Object> update(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Input in) {
    return service.save(j, id, in, key);
  }

  @PostMapping("/appointments/{id}/reschedule")
  Map<String, Object> reschedule(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Input in) {
    return service.save(j, id, in, key);
  }

  @PostMapping("/appointments/{id}/{action:confirm|cancel|no-show}")
  Map<String, Object> status(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable String action,
      @Valid @RequestBody Change in) {
    return service.status(
        j,
        id,
        action.equals("confirm") ? "CONFIRMED" : action.equals("cancel") ? "CANCELLED" : "NO_SHOW",
        in);
  }

  @PostMapping("/appointments/{id}/check-in")
  Map<String, Object> checkin(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @RequestBody Map<String, Object> in) {
    return service.checkin(j, id, key, in);
  }

  @PostMapping("/appointments/{id}/reconcile")
  Map<String, Object> reconcile(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    return service.reconcile(j, id);
  }
}
