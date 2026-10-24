package com.motoros.workorder;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import jakarta.validation.constraints.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class WorkOrderController {
  private final WorkOrderRepository orders;
  private final JdbcTemplate db;
  private final RestClient customers;
  private final ServiceTokens serviceTokens;
  private final com.motoros.foundation.ServiceGateway inventoryGateway;

  @Value("${motoros.inventory-url:http://127.0.0.1:8085}")
  private String inventoryUrl;

  WorkOrderController(
      WorkOrderRepository orders,
      JdbcTemplate db,
      ServiceTokens serviceTokens,
      @Value("${motoros.customer-url}") String url) {
    this.orders = orders;
    this.serviceTokens = serviceTokens;
    this.inventoryGateway = new com.motoros.foundation.ServiceGateway(serviceTokens);
    this.db = db;
    var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    var factory = new org.springframework.http.client.JdkClientHttpRequestFactory(http);
    factory.setReadTimeout(Duration.ofSeconds(5));
    this.customers = RestClient.builder().baseUrl(url).requestFactory(factory).build();
  }

  record Create(
      @NotNull UUID branchId,
      @NotNull UUID vehicleId,
      @NotBlank @Size(max = 2000) String complaint) {}

  record Move(
      @NotNull Status status,
      @NotNull @Min(0) Long version,
      @NotBlank @Size(max = 1000) String note) {}

  private void verifyVehicle(Jwt jwt, UUID id) {
    verifyVehicle(jwt, id, false);
  }

  private void verifyVehicle(Jwt jwt, UUID id, boolean operational) {
    try {
      var response =
          customers
              .get()
              .uri("/api/vehicles/{id}", id)
              .headers(
                  h -> {
                    h.setBearerAuth(serviceTokens.token());
                    h.set("X-Correlation-ID", Correlation.current());
                    h.set("X-User-Token", jwt.getTokenValue());
                    h.set("X-MotorOS-Tenant", Access.tenant(jwt).toString());
                  })
              .retrieve()
              .toEntity(Map.class);
      if (operational) {
        if (response.getBody() == null)
          throw new ResponseStatusException(
              SERVICE_UNAVAILABLE, "Vehicle registry response unavailable");
        if (!"ACTIVE".equals(response.getBody().get("status")))
          throw new ResponseStatusException(
              CONFLICT, "Inactive vehicles cannot create new work orders");
      }
    } catch (org.springframework.web.client.HttpClientErrorException e) {
      throw new ResponseStatusException(
          e.getStatusCode().value() == 404 ? NOT_FOUND : FORBIDDEN, "Vehicle not accessible");
    } catch (org.springframework.web.client.RestClientException e) {
      throw new ResponseStatusException(
          SERVICE_UNAVAILABLE, "Customer service unavailable. Try again.");
    }
  }

  private void audit(Jwt jwt, WorkOrder order, String action, String note) {
    db.update(
        "insert into"
            + " workorder.work_order_audit(id,tenant_id,branch_id,work_order_id,actor_id,action,note,created_at,correlation_id)"
            + " values (?,?,?,?,?,?,?,now(),?)",
        UUID.randomUUID(),
        order.tenantId,
        order.branchId,
        order.id,
        Access.user(jwt),
        action,
        note,
        Correlation.current());
  }

  @GetMapping("/vehicles/{id}/timeline")
  @Transactional
  Map<String, Object> timeline(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable UUID id,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    Access.require(jwt, Permission.VEHICLE_HISTORY_READ);
    Access.branch(jwt, branchId);
    if (page < 0 || page > 100000 || size < 1 || size > 100)
      throw new ResponseStatusException(BAD_REQUEST);
    verifyVehicle(jwt, id);
    db.update(
        "insert into"
            + " workorder.access_audit(id,tenant_id,actor_id,vehicle_id,branch_id,created_at,correlation_id)"
            + " values(?,?,?,?,?,now(),?)",
        UUID.randomUUID(),
        Access.tenant(jwt),
        Access.user(jwt),
        id,
        branchId,
        Correlation.current());
    var records =
        orders.findByTenantIdAndVehicleIdAndStatusIn(
            Access.tenant(jwt),
            id,
            List.of(Status.DELIVERED, Status.CLOSED),
            PageRequest.of(page, size, Sort.by("createdAt").descending().and(Sort.by("id"))));
    var content =
        records.getContent().stream()
            .map(
                o -> {
                  var entry =
                      new LinkedHashMap<String, Object>(
                          Map.<String, Object>of(
                              "id",
                              o.id,
                              "vehicleId",
                              o.vehicleId,
                              "branchId",
                              o.branchId,
                              "createdAt",
                              o.createdAt,
                              "updatedAt",
                              o.updatedAt,
                              "status",
                              o.status,
                              "summary",
                              o.complaint,
                              "source",
                              Map.of(
                                  "service",
                                  "workorder",
                                  "resourceId",
                                  o.id,
                                  "path",
                                  "/api/work-orders/" + o.id)));
                  entry.put(
                      "completedRepairs",
                      db
                          .queryForList(
                              "select task_description,completed_at from workorder.work_order_tasks"
                                  + " where tenant_id=? and work_order_id=? and status='COMPLETED'"
                                  + " order by completed_at,id",
                              Access.tenant(jwt),
                              o.id)
                          .stream()
                          .map(com.motoros.foundation.Records::dto)
                          .toList());
                  entry.put(
                      "parts",
                      db.queryForList(
                          "select description,quantity,status from workorder.required_parts where"
                              + " tenant_id=? and work_order_id=? and status in ('USED','RECEIVED')"
                              + " order by created_at,id",
                          Access.tenant(jwt),
                          o.id));
                  entry.put(
                      "technicianNotes",
                      db
                          .queryForList(
                              "select kind,note,created_at from workorder.job_notes where"
                                  + " tenant_id=? and work_order_id=? order by created_at,id",
                              Access.tenant(jwt),
                              o.id)
                          .stream()
                          .map(com.motoros.foundation.Records::dto)
                          .toList());
                  entry.put(
                      "odometer",
                      db
                          .queryForList(
                              "select odometer_kilometers,check_in_at from"
                                  + " workorder.vehicle_check_ins where tenant_id=? and"
                                  + " work_order_id=?",
                              Access.tenant(jwt),
                              o.id)
                          .stream()
                          .map(com.motoros.foundation.Records::dto)
                          .toList());
                  entry.put(
                      "recommendations",
                      db
                          .queryForList(
                              "select category,technician_notes,severity from"
                                  + " workorder.inspection_findings where tenant_id=? and"
                                  + " work_order_id=? and requires_attention order by category,id",
                              Access.tenant(jwt),
                              o.id)
                          .stream()
                          .map(com.motoros.foundation.Records::dto)
                          .toList());
                  if (!db.queryForList(
                          "select id from workorder.work_orders where tenant_id=? and id=? and"
                              + " commercial_estimate_id is not null",
                          Access.tenant(jwt),
                          o.id)
                      .isEmpty()) {
                    var combined =
                        new ArrayList<Map<String, Object>>(
                            (List<Map<String, Object>>) entry.get("parts"));
                    combined.addAll(
                        inventoryGateway.list(
                            jwt,
                            inventoryUrl,
                            "/api/internal/history/work-orders/" + o.id + "/parts"));
                    entry.put("parts", combined);
                  }
                  return entry;
                })
            .toList();
    return Map.of(
        "content",
        content,
        "totalElements",
        records.getTotalElements(),
        "totalPages",
        records.getTotalPages(),
        "scope",
        "COMPLETED_SAME_TENANT",
        "generatedAt",
        java.time.Instant.now());
  }

  @GetMapping("/vehicles/{id}/history")
  @Transactional
  List<WorkOrder> history(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestParam UUID branchId) {
    Access.require(jwt, Permission.VEHICLE_HISTORY_READ);
    Access.branch(jwt, branchId);
    verifyVehicle(jwt, id);
    db.update(
        "insert into"
            + " workorder.access_audit(id,tenant_id,actor_id,vehicle_id,branch_id,created_at,correlation_id)"
            + " values (?,?,?,?,?,now(),?)",
        UUID.randomUUID(),
        Access.tenant(jwt),
        Access.user(jwt),
        id,
        branchId,
        Correlation.current());
    return orders.findByTenantIdAndVehicleIdAndStatusInOrderByCreatedAtDesc(
        Access.tenant(jwt), id, List.of(Status.DELIVERED, Status.CLOSED));
  }
}
