package com.motoros.workorder;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.*;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
@Transactional
public class CommercialController {
  private final Records r;
  private final WorkshopController jobs;
  private final ServiceGateway gateway;
  private final String billing;

  CommercialController(
      JdbcTemplate db,
      WorkshopController jobs,
      ServiceTokens tokens,
      @Value("${motoros.billing-url:http://127.0.0.1:8086}") String billing) {
    r = new Records(db);
    this.jobs = jobs;
    gateway = new ServiceGateway(tokens);
    this.billing = billing;
  }

  public record Decision(@NotNull Long version, @NotBlank @Size(max = 1000) String note) {}

  // This nonlocking read is intentional: Billing may call back while Work Order holds its mutation
  // lock.
  @GetMapping("/internal/work-orders/{id}")
  public Map<String, Object> context(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.WORKORDER_READ);
    var o =
        r.one(
            "select"
                + " id,tenant_id,branch_id,customer_id,vehicle_id,status,job_card_number,commercial_estimate_id,commercial_revision,quality_passed_at"
                + " from workorder.work_orders where tenant_id=? and id=?",
            Access.tenant(j),
            id);
    Access.branch(j, (UUID) o.get("branch_id"));
    var out = Records.dto(o);
    out.put(
        "tasks",
        r
            .db
            .queryForList(
                "select id,task_description,task_category,status from workorder.work_order_tasks"
                    + " where tenant_id=? and work_order_id=? and status<>'CANCELLED' order by id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    return out;
  }

  @PostMapping("/work-orders/{id}/commercial-approval")
  public Map<String, Object> apply(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Decision in) {
    Access.require(j, Permission.WORKORDER_ASSIGN);
    var old = r.replay("workorder", Access.tenant(j), Access.user(j), key, "COMMERCIAL" + id, in);
    var o = jobs.row(j, id);
    if (old != null) return jobs.detail(j, id);
    Records.version(o, in.version());
    if (!Set.of("AWAITING_APPROVAL", "APPROVED", "IN_PROGRESS").contains(o.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "Job must be awaiting approval or revising an approved repair");
    var approval = gateway.get(j, billing, "/api/internal/commercial/work-orders/" + id);
    if (!Boolean.TRUE.equals(approval.get("approvalValid"))
        || !o.get("vehicle_id").toString().equals(approval.get("vehicleId").toString())
        || !o.get("customer_id").toString().equals(approval.get("customerId").toString()))
      throw new ResponseStatusException(CONFLICT, "Customer-approved current estimate is required");
    r.db.update(
        "update workorder.work_orders set"
            + " commercial_estimate_id=?,commercial_revision=?,development_approval_id=null,version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        Records.uuid(approval.get("estimateId")),
        approval.get("revision"),
        Access.tenant(j),
        id);
    if ("AWAITING_APPROVAL".equals(o.get("status"))) jobs.status(j, o, "APPROVED", in.note());
    jobs.audit(
        j, o, "COMMERCIAL_APPROVAL_VERIFIED", Records.uuid(approval.get("estimateId")), in.note());
    r.remember("workorder", Access.tenant(j), Access.user(j), key, "COMMERCIAL" + id, in, id);
    return jobs.detail(j, id);
  }

  @PostMapping("/work-orders/{id}/ready-for-delivery")
  public Map<String, Object> ready(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Decision in) {
    Access.require(j, Permission.WORKORDER_ASSIGN);
    var old = r.replay("workorder", Access.tenant(j), Access.user(j), key, "READY" + id, in);
    var o = jobs.row(j, id);
    if (old != null) return jobs.detail(j, id);
    Records.version(o, in.version());
    if (!"QUALITY_CHECK".equals(o.get("status"))
        || o.get("quality_passed_at") == null
        || o.get("commercial_estimate_id") == null)
      throw new ResponseStatusException(
          CONFLICT, "A passed commercial job quality check is required");
    var authority = gateway.get(j, billing, "/api/internal/commercial/work-orders/" + id);
    if (!Boolean.TRUE.equals(authority.get("deliveryReady")))
      throw new ResponseStatusException(
          CONFLICT, "Issued invoice and configured payment requirements must be satisfied");
    jobs.status(j, o, "READY_FOR_DELIVERY", in.note());
    r.remember("workorder", Access.tenant(j), Access.user(j), key, "READY" + id, in, id);
    return jobs.detail(j, id);
  }

  @GetMapping("/internal/history/work-orders/{id}")
  public Map<String, Object> historical(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.VEHICLE_HISTORY_READ);
    if (j.getClaimAsStringList("branches").isEmpty())
      throw new ResponseStatusException(FORBIDDEN, "Authorized workshop branch required");
    return Records.dto(
        r.one(
            "select id,vehicle_id,branch_id,status from workorder.work_orders where tenant_id=? and"
                + " id=? and status in ('DELIVERED','CLOSED')",
            Access.tenant(j),
            id));
  }
}
