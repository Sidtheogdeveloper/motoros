package com.motoros.customer;

import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class CustomerController {
  private final Registry registry;

  CustomerController(Registry registry) {
    this.registry = registry;
  }

  public record CustomerInput(
      @NotBlank @Size(max = 120) String name,
      @Email @Size(max = 254) String email,
      @Size(max = 32) String phone,
      @Size(max = 1000) String address,
      @Size(max = 100) String city,
      @Size(max = 80) String country,
      String status,
      Long version,
      @Size(max = 500) String duplicateReason) {
    public CustomerInput {
      name = Registry.clean(name);
      email = email == null ? null : email.trim();
      phone = phone == null ? null : phone.trim();
      country = Registry.clean(country);
      if (country.equalsIgnoreCase("india") || country.equalsIgnoreCase("in")) country = "India";
    }
  }

  public record VehicleInput(
      @NotNull UUID customerId,
      @NotBlank @Size(max = 32) String registration,
      @NotBlank @Size(max = 80) String make,
      @NotBlank @Size(max = 80) String model,
      @Size(max = 17) String vin,
      Integer year,
      @Size(max = 24) String fuelType,
      @Size(max = 60) String color,
      String status,
      UUID branchId,
      Long version) {}

  public record Transfer(
      @NotNull UUID customerId,
      @NotNull @Min(0) Long version,
      @NotBlank @Size(min = 10, max = 500) String reason,
      @NotNull UUID branchId) {}

  public record Reading(
      @NotNull @Min(0) @Max(9999999) Long kilometers,
      @NotNull UUID branchId,
      @Size(max = 500) String note,UUID externalReference) {}

  public record Contact(
      @NotBlank String kind,
      @NotBlank @Size(max = 60) String label,
      @NotBlank @Size(max = 254) String value,
      @Size(max = 500) String duplicateReason) {}

  public record Version(@NotNull @Min(0) Long version) {}

  @PostMapping("/customers")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Map<String, Object> create(@AuthenticationPrincipal Jwt j, @Valid @RequestBody CustomerInput in) {
    return registry.saveCustomer(j, null, in);
  }

  @PatchMapping("/customers/{id}")
  Map<String, Object> update(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody CustomerInput in) {
    return registry.saveCustomer(j, id, in);
  }

  @GetMapping("/customers")
  Map<String, Object> list(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    return registry.customers(j, q, status, page, size);
  }

  @GetMapping("/customers/duplicates")
  List<Map<String, Object>> duplicates(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(defaultValue = "") String email,
      @RequestParam(defaultValue = "") String phone,
      @RequestParam(defaultValue = "India") String country) {
    Access.require(j, Permission.CUSTOMER_READ);
    return registry.duplicates(Access.tenant(j), email, phone, country, null);
  }

  @GetMapping("/customers/{id}")
  Map<String, Object> get(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.CUSTOMER_READ);
    return Registry.dto(registry.customer(Access.tenant(j), id));
  }

  @PostMapping("/customers/{id}/contacts")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Map<String, Object> contact(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Contact in) {
    return registry.contact(j, id, in);
  }

  @GetMapping("/customers/{id}/contacts")
  List<Map<String, Object>> contacts(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    return registry.contacts(j, id);
  }

  @PostMapping("/customers/{id}/contacts/{contact}/deactivate")
  Map<String, Object> remove(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable UUID contact,
      @Valid @RequestBody Version in) {
    registry.removeContact(j, id, contact, in.version());
    return Map.of("ok", true);
  }

  @PostMapping("/vehicles")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Map<String, Object> createVehicle(
      @AuthenticationPrincipal Jwt j, @Valid @RequestBody VehicleInput in) {
    return registry.saveVehicle(j, null, in);
  }

  @PatchMapping("/vehicles/{id}")
  Map<String, Object> updateVehicle(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody VehicleInput in) {
    return registry.saveVehicle(j, id, in);
  }

  @GetMapping("/vehicles")
  Map<String, Object> vehicles(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(required = false) UUID customerId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    return registry.vehicles(j, q, status, customerId, page, size);
  }

  @GetMapping("/vehicles/{id}")
  Map<String, Object> vehicle(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.VEHICLE_READ);
    return registry.vehicleDto(j, registry.vehicle(Access.tenant(j), id));
  }

  @PostMapping("/vehicles/{id}/ownership")
  Map<String, Object> transfer(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Transfer in) {
    return registry.transfer(j, id, in.customerId(), in.version(), in.reason(), in.branchId());
  }

  @GetMapping("/vehicles/{id}/ownership")
  Map<String, Object> owners(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return registry.ownerships(j, id, page, size);
  }

  @PostMapping("/vehicles/{id}/odometer")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Map<String, Object> odometer(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Reading in) {
    return registry.odometer(j, id, in.kilometers(), in.branchId(), in.note(),in.externalReference());
  }

  @GetMapping("/vehicles/{id}/odometer")
  Map<String, Object> readings(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return registry.readings(j, id, page, size);
  }

  @GetMapping("/{kind:vehicles|customers}/{id}/audit")
  Map<String, Object> audit(
      @AuthenticationPrincipal Jwt j,
      @PathVariable String kind,
      @PathVariable UUID id,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return registry.auditTrail(j, kind, id, page, size);
  }
}
