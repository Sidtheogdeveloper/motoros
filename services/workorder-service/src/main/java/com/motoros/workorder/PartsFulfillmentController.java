package com.motoros.workorder;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.*;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/work-orders")
@Transactional
public class PartsFulfillmentController {
  private final Records r;
  private final WorkshopController jobs;
  private final ServiceGateway gateway;
  private final String inventory;

  PartsFulfillmentController(
      JdbcTemplate db,
      WorkshopController jobs,
      ServiceTokens tokens,
      @Value("${motoros.inventory-url:http://127.0.0.1:8085}") String inventory) {
    r = new Records(db);
    this.jobs = jobs;
    gateway = new ServiceGateway(tokens);
    this.inventory = inventory;
  }

  public record Fulfillment(
      @NotNull @Min(0) Long version,
      @NotNull UUID reservationId,
      @NotBlank @Size(max = 850) String note) {}

  @PostMapping("/{id}/parts/{partId}/fulfill")
  public Map<String, Object> fulfill(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable UUID partId,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Fulfillment in) {
    Access.require(j, Permission.WORKORDER_UPDATE);
    var job = jobs.row(j, id);
    String operation = "FULFILL_PART" + partId;
    var previous = r.replay("workorder", Access.tenant(j), Access.user(j), key, operation, in);
    if (previous != null) return jobs.detail(j, id);
    jobs.editable(j, job);
    var request =
        r.one(
            "select * from workorder.required_parts where tenant_id=? and work_order_id=? and id=?"
                + " for update",
            Access.tenant(j),
            id,
            partId);
    Records.version(request, in.version());
    if (!Set.of("REQUESTED", "RECEIVED", "USED").contains(request.get("status")))
      throw new ResponseStatusException(CONFLICT, "Parts request has already been resolved");
    var installed = gateway.get(j, inventory, "/api/inventory/reservations/" + in.reservationId());
    if (!id.toString().equals(Objects.toString(installed.get("workOrderId"), ""))
        || !job.get("branch_id").toString().equals(Objects.toString(installed.get("branchId"), "")))
      throw new ResponseStatusException(
          FORBIDDEN, "Installation belongs to another work order or branch");
    if (!"CONSUMED".equals(installed.get("status"))
        || new BigDecimal(installed.get("quantity").toString())
                .compareTo(new BigDecimal(request.get("quantity").toString()))
            != 0)
      throw new ResponseStatusException(
          CONFLICT, "A consumed reservation matching this requested quantity is required");
    r.db.update(
        "update workorder.required_parts set"
            + " status='FULFILLED',inventory_reservation_id=?,version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        in.reservationId(),
        Access.tenant(j),
        partId);
    jobs.audit(
        j,
        job,
        "PART_STOCK_FULFILLED",
        partId,
        in.note() + " [inventory reservation " + in.reservationId() + "]");
    r.remember("workorder", Access.tenant(j), Access.user(j), key, operation, in, id);
    return jobs.detail(j, id);
  }
}
