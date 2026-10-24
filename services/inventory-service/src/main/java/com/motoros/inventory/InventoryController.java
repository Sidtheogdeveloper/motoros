package com.motoros.inventory;

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
@RequestMapping("/api")
@Transactional
public class InventoryController {
  private final Records r;
  private final ServiceGateway gateway;
  private final String tenantUrl, workorderUrl;

  @Value("${motoros.billing-url:http://127.0.0.1:8086}")
  private String billingUrl;

  public InventoryController(
      JdbcTemplate db,
      ServiceTokens tokens,
      @Value("${motoros.tenant-url}") String tenantUrl,
      @Value("${motoros.workorder-url}") String workorderUrl) {
    r = new Records(db);
    gateway = new ServiceGateway(tokens);
    this.tenantUrl = tenantUrl;
    this.workorderUrl = workorderUrl;
  }

  public record Part(
      @NotBlank @Size(max = 80) String sku,
      @NotBlank @Size(max = 200) String name,
      @Size(max = 100) String oemNumber,
      @Size(max = 160) String manufacturer,
      @NotBlank @Size(max = 100) String category,
      @Size(max = 2000) String description,
      @Size(max = 2000) String compatibilityNotes,
      boolean compatibilityVerified,
      UUID supplierId,
      @NotBlank @Pattern(regexp = "[A-Z]{3}") String currency,
      @NotNull @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal purchasePrice,
      @NotNull @DecimalMin("0") @Digits(integer = 12, fraction = 2) BigDecimal sellingPrice,
      boolean active,
      Long version) {}

  public record StockCommand(
      @NotNull UUID branchId,
      @NotNull UUID partId,
      @NotNull @Digits(integer = 10, fraction = 3) BigDecimal quantity,
      @NotBlank @Size(max = 1000) String reason,
      @Pattern(regexp = "CORRECTION|DAMAGE|LOSS|SUPPLIER_RETURN|CUSTOMER_RETURN")
          String adjustmentType) {
    public StockCommand {
      adjustmentType = adjustmentType == null ? "CORRECTION" : adjustmentType;
    }
  }

  public record Reservation(
      @NotNull UUID branchId,
      @NotNull UUID partId,
      @NotNull UUID workOrderId,
      @NotNull @DecimalMin("0.001") @Digits(integer = 10, fraction = 3) BigDecimal quantity) {}

  public record Change(@NotNull @Min(0) Long version, @NotBlank @Size(max = 1000) String note) {}

  public record TransferLine(
      @NotNull UUID partId,
      @NotNull @DecimalMin("0.001") @Digits(integer = 10, fraction = 3) BigDecimal quantity) {}

  public record Transfer(
      @NotNull UUID sourceBranchId,
      @NotNull UUID destinationBranchId,
      @NotEmpty @Size(max = 100) List<@Valid TransferLine> items,
      @NotBlank @Size(max = 1000) String note) {}

  public record ReceiptLine(
      @NotNull UUID partId,
      @NotNull @DecimalMin("0") @Digits(integer = 10, fraction = 3) BigDecimal quantity,
      @NotNull @DecimalMin("0") @Digits(integer = 10, fraction = 3) BigDecimal damagedQuantity,
      @DecimalMin("0") @Digits(integer = 10, fraction = 3) BigDecimal missingQuantity) {
    public ReceiptLine {
      missingQuantity = missingQuantity == null ? BigDecimal.ZERO : missingQuantity;
    }
  }

  public record TransferReceipt(
      @NotNull @Min(0) Long version,
      @NotEmpty @Size(max = 100) List<@Valid ReceiptLine> items,
      @NotBlank @Size(max = 1000) String note) {}

  boolean allowed(Jwt j, Permission p) {
    return j.getClaimAsStringList("permissions").contains(p.name());
  }

  void branch(Jwt j, UUID b, Permission p) {
    Access.require(j, p);
    Access.branch(j, b);
    var x = gateway.get(j, tenantUrl, "/api/branches/" + b + "/operations");
    if (!"ACTIVE".equals(x.get("status")))
      throw new ResponseStatusException(CONFLICT, "Branch is inactive");
  }

  UUID replay(Jwt j, String key, String op, Object in) {
    return r.replay("inventory", Access.tenant(j), Access.user(j), key, op, in);
  }

  void remember(Jwt j, String key, String op, Object in, UUID id) {
    r.remember("inventory", Access.tenant(j), Access.user(j), key, op, in, id);
  }

  Map<String, Object> part(Jwt j, UUID id) {
    return r.one("select * from inventory.parts where tenant_id=? and id=?", Access.tenant(j), id);
  }

  Map<String, Object> publicPart(Jwt j, Map<String, Object> p) {
    var x = Records.dto(p);
    if (!allowed(j, Permission.INVENTORY_COST_READ)) {
      x.remove("purchasePrice");
      x.remove("supplierId");
    }
    return x;
  }

  @GetMapping("/parts/{id}")
  public Map<String, Object> getPart(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVENTORY_READ);
    return publicPart(j, part(j, id));
  }

  @GetMapping("/parts")
  public Map<String, Object> parts(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "") String category,
      @RequestParam(defaultValue = "false") boolean includeArchived,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVENTORY_READ);
    Records.page(page, size);
    if (q.length() > 200 || category.length() > 100) throw new ResponseStatusException(BAD_REQUEST);
    String filter =
        " from inventory.parts where tenant_id=? and (? or active) and (?='' or category=?) and"
            + " (name ilike ? or sku ilike ? or coalesce(oem_number,'') ilike ?)";
    Object[] a = {
      Access.tenant(j),
      includeArchived,
      category,
      category,
      "%" + q + "%",
      "%" + q + "%",
      "%" + q + "%"
    };
    var args = new ArrayList<Object>(Arrays.asList(a));
    args.add(size);
    args.add(page * size);
    var rows =
        r.db.queryForList(
            "select *" + filter + " order by name,id limit ? offset ?", args.toArray());
    long n = r.db.queryForObject("select count(*)" + filter, Long.class, a);
    return Map.of(
        "content",
        rows.stream().map(x -> publicPart(j, x)).toList(),
        "totalElements",
        n,
        "totalPages",
        (n + size - 1) / size);
  }

  @PostMapping("/parts")
  public Map<String, Object> createPart(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Part in) {
    return savePart(j, null, key, in);
  }

  @PatchMapping("/parts/{id}")
  public Map<String, Object> updatePart(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Part in) {
    return savePart(j, id, key, in);
  }

  Map<String, Object> savePart(Jwt j, UUID id, String key, Part in) {
    Access.require(j, Permission.INVENTORY_WRITE);
    Access.require(j, Permission.INVENTORY_COST_READ);
    String op = "part:" + id;
    var old = replay(j, key, op, in);
    if (old != null) return getPart(j, old);
    UUID t = Access.tenant(j);
    if (in.supplierId() != null)
      r.one(
          "select id from inventory.suppliers where tenant_id=? and id=? and active",
          t,
          in.supplierId());
    if (id == null) {
      id = UUID.randomUUID();
      r.db.update(
          "insert into"
              + " inventory.parts(id,tenant_id,sku,name,oem_number,manufacturer,category,description,compatibility_notes,compatibility_verified,supplier_id,currency,purchase_price,selling_price,active)"
              + " values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          t,
          in.sku().strip().toUpperCase(Locale.ROOT),
          in.name().strip(),
          in.oemNumber(),
          in.manufacturer(),
          in.category(),
          in.description(),
          in.compatibilityNotes(),
          in.compatibilityVerified(),
          in.supplierId(),
          in.currency(),
          in.purchasePrice(),
          in.sellingPrice(),
          in.active());
    } else {
      var row = r.one("select * from inventory.parts where tenant_id=? and id=? for update", t, id);
      Records.version(row, in.version());
      r.db.update(
          "update inventory.parts set"
              + " sku=?,name=?,oem_number=?,manufacturer=?,category=?,description=?,compatibility_notes=?,compatibility_verified=?,supplier_id=?,currency=?,purchase_price=?,selling_price=?,active=?,version=version+1,updated_at=now()"
              + " where tenant_id=? and id=?",
          in.sku().strip().toUpperCase(Locale.ROOT),
          in.name().strip(),
          in.oemNumber(),
          in.manufacturer(),
          in.category(),
          in.description(),
          in.compatibilityNotes(),
          in.compatibilityVerified(),
          in.supplierId(),
          in.currency(),
          in.purchasePrice(),
          in.sellingPrice(),
          in.active(),
          t,
          id);
    }
    Outbox.append(r, "inventory", j, null, id, "PartCatalogUpdated", Map.of("partId", id));
    remember(j, key, op, in, id);
    return getPart(j, id);
  }

  public record Supplier(@NotBlank @Size(max = 200) String name, @Size(max = 300) String contact) {}

  @GetMapping("/suppliers")
  public Map<String, Object> suppliers(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVENTORY_COST_READ);
    Records.page(page, size);
    if (q.length() > 200) throw new ResponseStatusException(BAD_REQUEST);
    return Records.page(
        r.db.queryForList(
            "select * from inventory.suppliers where tenant_id=? and name ilike ? order by name,id"
                + " limit ? offset ?",
            Access.tenant(j),
            "%" + q + "%",
            size,
            page * size),
        r.db.queryForObject(
            "select count(*) from inventory.suppliers where tenant_id=? and name ilike ?",
            Long.class,
            Access.tenant(j),
            "%" + q + "%"),
        size);
  }

  @PostMapping("/suppliers")
  public Map<String, Object> supplier(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Supplier in) {
    Access.require(j, Permission.INVENTORY_WRITE);
    Access.require(j, Permission.INVENTORY_COST_READ);
    var id = replay(j, key, "supplier", in);
    if (id == null) {
      id = UUID.randomUUID();
      r.db.update(
          "insert into inventory.suppliers(id,tenant_id,name,contact) values(?,?,?,?)",
          id,
          Access.tenant(j),
          in.name(),
          in.contact());
      remember(j, key, "supplier", in, id);
    }
    return Records.dto(
        r.one(
            "select * from inventory.suppliers where tenant_id=? and id=?", Access.tenant(j), id));
  }

  Map<String, Object> stock(Jwt j, UUID b, UUID p) {
    r.db.update(
        "insert into inventory.branch_stock(tenant_id,branch_id,part_id) values(?,?,?) on conflict"
            + " do nothing",
        Access.tenant(j),
        b,
        p);
    return r.one(
        "select * from inventory.branch_stock where tenant_id=? and branch_id=? and part_id=? for"
            + " update",
        Access.tenant(j),
        b,
        p);
  }

  BigDecimal decimal(Map<String, Object> row, String name) {
    return (BigDecimal) row.get(name);
  }

  void movement(
      Jwt j,
      UUID b,
      UUID p,
      BigDecimal on,
      BigDecimal reserved,
      String type,
      UUID ref,
      String reason) {
    var s = stock(j, b, p);
    BigDecimal next = decimal(s, "on_hand").add(on), held = decimal(s, "reserved").add(reserved);
    if (next.signum() < 0 || held.signum() < 0 || held.compareTo(next) > 0)
      throw new ResponseStatusException(CONFLICT, "Insufficient available stock");
    r.db.update(
        "update inventory.branch_stock set on_hand=?,reserved=?,version=version+1,updated_at=now()"
            + " where tenant_id=? and branch_id=? and part_id=?",
        next,
        held,
        Access.tenant(j),
        b,
        p);
    r.db.update(
        "insert into"
            + " inventory.stock_movements(id,tenant_id,branch_id,part_id,movement_type,on_hand_delta,reserved_delta,reference_id,reason,actor_id)"
            + " values(?,?,?,?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        b,
        p,
        type,
        on,
        reserved,
        ref,
        reason,
        Access.user(j));
  }

  @GetMapping("/inventory/stock")
  public Map<String, Object> stocks(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "false") boolean lowStock,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVENTORY_READ);
    Access.branch(j, branchId);
    Records.page(page, size);
    if (q.length() > 200) throw new ResponseStatusException(BAD_REQUEST);
    String filter =
        " from inventory.branch_stock s join inventory.parts p on p.tenant_id=s.tenant_id and"
            + " p.id=s.part_id where s.tenant_id=? and s.branch_id=? and (?=false or"
            + " s.on_hand-s.reserved<=s.reorder_level) and (p.name ilike ? or p.sku ilike ?)";
    Object[] args = {Access.tenant(j), branchId, lowStock, "%" + q + "%", "%" + q + "%"};
    var a = new ArrayList<Object>(Arrays.asList(args));
    a.add(size);
    a.add(page * size);
    return Records.page(
        r.db.queryForList(
            "select s.*,p.name,p.sku,s.on_hand-s.reserved as available"
                + filter
                + " order by p.name,p.id limit ? offset ?",
            a.toArray()),
        r.db.queryForObject("select count(*)" + filter, Long.class, args),
        size);
  }

  @PostMapping("/inventory/{action:receipts|adjustments}")
  public Map<String, Object> adjust(
      @AuthenticationPrincipal Jwt j,
      @PathVariable String action,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody StockCommand in) {
    branch(
        j,
        in.branchId(),
        action.equals("adjustments") ? Permission.INVENTORY_ADJUST : Permission.INVENTORY_WRITE);
    var previous = replay(j, key, action, in);
    if (previous != null)
      return Records.dto(
          r.one(
              "select * from inventory.stock_movements where tenant_id=? and id=?",
              Access.tenant(j),
              previous));
    var p = part(j, in.partId());
    if (action.equals("receipts") && !Boolean.TRUE.equals(p.get("active")))
      throw new ResponseStatusException(CONFLICT, "Part is archived");
    if (in.quantity().signum() == 0 || action.equals("receipts") && in.quantity().signum() < 0)
      throw new ResponseStatusException(BAD_REQUEST, "Invalid quantity");
    if (action.equals("adjustments")
        && ((Set.of("DAMAGE", "LOSS", "SUPPLIER_RETURN").contains(in.adjustmentType())
                && in.quantity().signum() > 0)
            || (in.adjustmentType().equals("CUSTOMER_RETURN") && in.quantity().signum() < 0)))
      throw new ResponseStatusException(
          BAD_REQUEST, "Quantity direction does not match adjustment type");
    UUID id = UUID.randomUUID();
    movement(
        j,
        in.branchId(),
        in.partId(),
        in.quantity(),
        BigDecimal.ZERO,
        action.equals("receipts") ? "RECEIPT" : in.adjustmentType(),
        id,
        in.reason());
    var row =
        r.one(
            "select * from inventory.stock_movements where tenant_id=? and reference_id=?",
            Access.tenant(j),
            id);
    id = (UUID) row.get("id");
    remember(j, key, action, in, id);
    Outbox.append(
        r,
        "inventory",
        j,
        in.branchId(),
        id,
        "StockAdjusted",
        Map.of("partId", in.partId(), "quantity", in.quantity(), "reason", in.reason()));
    return Records.dto(row);
  }

  public record Threshold(
      @NotNull UUID branchId,
      @NotNull UUID partId,
      @NotNull @DecimalMin("0") @Digits(integer = 10, fraction = 3) BigDecimal reorderLevel,
      @NotNull Long version) {}

  @PatchMapping("/inventory/stock")
  public Map<String, Object> threshold(
      @AuthenticationPrincipal Jwt j, @Valid @RequestBody Threshold in) {
    branch(j, in.branchId(), Permission.INVENTORY_WRITE);
    part(j, in.partId());
    var s = stock(j, in.branchId(), in.partId());
    Records.version(s, in.version());
    r.db.update(
        "update inventory.branch_stock set reorder_level=?,version=version+1,updated_at=now() where"
            + " tenant_id=? and branch_id=? and part_id=?",
        in.reorderLevel(),
        Access.tenant(j),
        in.branchId(),
        in.partId());
    return Records.dto(stock(j, in.branchId(), in.partId()));
  }

  @GetMapping("/inventory/movements")
  public Map<String, Object> movements(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(required = false) UUID partId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVENTORY_READ);
    Access.branch(j, branchId);
    Records.page(page, size);
    String f = " from inventory.stock_movements where tenant_id=? and branch_id=?";
    var a = new ArrayList<Object>(List.of(Access.tenant(j), branchId));
    if (partId != null) {
      f += " and part_id=?";
      a.add(partId);
    }
    long n = r.db.queryForObject("select count(*)" + f, Long.class, a.toArray());
    a.add(size);
    a.add(page * size);
    return Records.page(
        r.db.queryForList(
            "select *" + f + " order by created_at desc,id limit ? offset ?", a.toArray()),
        n,
        size);
  }

  void job(Jwt j, UUID id, UUID b) {
    var w = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + id);
    if (!b.toString().equals(w.get("branchId").toString()))
      throw new ResponseStatusException(FORBIDDEN, "Work order branch differs");
    if (Set.of("DELIVERED", "CLOSED", "CANCELLED").contains(w.get("status")))
      throw new ResponseStatusException(CONFLICT, "Work order is closed");
  }

  Map<String, Object> reservation(Jwt j, UUID id) {
    var x =
        r.one(
            "select * from inventory.stock_reservations where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    Access.branch(j, (UUID) x.get("branch_id"));
    return x;
  }

  public static class ReservationDenied extends ResponseStatusException {
    ReservationDenied() {
      super(
          CONFLICT, "Insufficient available stock; request a new reservation after replenishment");
    }
  }

  @PostMapping("/inventory/reservations")
  @Transactional(noRollbackFor = ReservationDenied.class)
  public Map<String, Object> reserve(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Reservation in) {
    branch(j, in.branchId(), Permission.INVENTORY_RESERVE);
    var old = replay(j, key, "reserve", in);
    if (old != null) {
      if (!r.db
          .queryForList(
              "select id from inventory.reservation_failures where tenant_id=? and id=?",
              Access.tenant(j),
              old)
          .isEmpty()) throw new ReservationDenied();
      return Records.dto(reservation(j, old));
    }
    job(j, in.workOrderId(), in.branchId());
    if (!Boolean.TRUE.equals(part(j, in.partId()).get("active")))
      throw new ResponseStatusException(CONFLICT, "Part is archived");
    UUID id = UUID.randomUUID();
    var available = stock(j, in.branchId(), in.partId());
    if (decimal(available, "on_hand")
            .subtract(decimal(available, "reserved"))
            .compareTo(in.quantity())
        < 0) {
      r.db.update(
          "insert into"
              + " inventory.reservation_failures(id,tenant_id,branch_id,part_id,work_order_id,quantity,actor_id,reason)"
              + " values(?,?,?,?,?,?,?,?)",
          id,
          Access.tenant(j),
          in.branchId(),
          in.partId(),
          in.workOrderId(),
          in.quantity(),
          Access.user(j),
          "Insufficient available stock");
      remember(j, key, "reserve", in, id);
      Outbox.append(r, "inventory", j, in.branchId(), id, "PartReservationFailed", in);
      throw new ReservationDenied();
    }
    movement(
        j,
        in.branchId(),
        in.partId(),
        BigDecimal.ZERO,
        in.quantity(),
        "RESERVE",
        id,
        "Work order reservation");
    r.db.update(
        "insert into"
            + " inventory.stock_reservations(id,tenant_id,branch_id,part_id,work_order_id,quantity,status,created_by)"
            + " values(?,?,?,?,?,?,'RESERVED',?)",
        id,
        Access.tenant(j),
        in.branchId(),
        in.partId(),
        in.workOrderId(),
        in.quantity(),
        Access.user(j));
    remember(j, key, "reserve", in, id);
    Outbox.append(r, "inventory", j, in.branchId(), id, "PartReserved", in);
    return Records.dto(reservation(j, id));
  }

  @GetMapping("/inventory/reservations")
  public Map<String, Object> reservations(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(required = false) UUID workOrderId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVENTORY_READ);
    Access.branch(j, branchId);
    Records.page(page, size);
    String f =
        " from inventory.stock_reservations s join inventory.parts p on p.tenant_id=s.tenant_id and"
            + " p.id=s.part_id where s.tenant_id=? and s.branch_id=?";
    var a = new ArrayList<Object>(List.of(Access.tenant(j), branchId));
    if (workOrderId != null) {
      f += " and s.work_order_id=?";
      a.add(workOrderId);
    }
    long count = r.db.queryForObject("select count(*)" + f, Long.class, a.toArray());
    a.add(size);
    a.add(page * size);
    return Records.page(
        r.db.queryForList(
            "select s.*,p.name as part_name,p.sku"
                + f
                + " order by s.created_at desc,s.id limit ? offset ?",
            a.toArray()),
        count,
        size);
  }

  @PostMapping("/inventory/reservations/{id}/{action:release|consume}")
  public Map<String, Object> reservationChange(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable String action,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.INVENTORY_RESERVE);
    String op = action + id;
    var old = replay(j, key, op, in);
    var x = reservation(j, id);
    branch(j, (UUID) x.get("branch_id"), Permission.INVENTORY_RESERVE);
    if (old != null) return Records.dto(x);
    Records.version(x, in.version());
    if (!"RESERVED".equals(x.get("status")))
      throw new ResponseStatusException(CONFLICT, "Reservation already resolved");
    UUID b = (UUID) x.get("branch_id");
    if (action.equals("consume")) job(j, (UUID) x.get("work_order_id"), b);
    BigDecimal q = decimal(x, "quantity");
    if (action.equals("consume")) {
      r.lock("consume" + Access.tenant(j) + x.get("work_order_id") + x.get("part_id"));
      var w = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + x.get("work_order_id"));
      if (!"IN_PROGRESS".equals(w.get("status")))
        throw new ResponseStatusException(
            CONFLICT, "Parts may be consumed only during approved repair work");
      var a =
          gateway.get(
              j, billingUrl, "/api/internal/commercial/work-orders/" + x.get("work_order_id"));
      if (!Boolean.TRUE.equals(a.get("approvalValid")))
        throw new ResponseStatusException(
            CONFLICT, "Current customer estimate approval is required");
      r.db.update(
          "update inventory.stock_reservations set approved_estimate_id=?,approved_revision=? where"
              + " tenant_id=? and id=?",
          Records.uuid(a.get("estimateId")),
          a.get("revision"),
          Access.tenant(j),
          id);
      var approved = (List<Map<String, Object>>) a.get("parts");
      BigDecimal permitted =
          approved.stream()
              .filter(y -> x.get("part_id").toString().equals(y.get("partId").toString()))
              .map(y -> new BigDecimal(y.get("quantity").toString()))
              .reduce(BigDecimal.ZERO, BigDecimal::add);
      BigDecimal consumed =
          r.db.queryForObject(
              "select coalesce(sum(quantity),0) from inventory.stock_reservations where tenant_id=?"
                  + " and work_order_id=? and part_id=? and status='CONSUMED'",
              BigDecimal.class,
              Access.tenant(j),
              x.get("work_order_id"),
              x.get("part_id"));
      if (consumed.add(q).compareTo(permitted) > 0)
        throw new ResponseStatusException(
            CONFLICT, "Part quantity exceeds customer-approved scope");
    }
    movement(
        j,
        b,
        (UUID) x.get("part_id"),
        action.equals("consume") ? q.negate() : BigDecimal.ZERO,
        q.negate(),
        action.toUpperCase(Locale.ROOT),
        id,
        in.note());
    r.db.update(
        "update inventory.stock_reservations set status=?,version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        action.equals("consume") ? "CONSUMED" : "RELEASED",
        Access.tenant(j),
        id);
    remember(j, key, op, in, id);
    Outbox.append(
        r,
        "inventory",
        j,
        b,
        id,
        action.equals("consume") ? "PartConsumed" : "PartReservationReleased",
        Map.of(
            "reservationId",
            id,
            "workOrderId",
            x.get("work_order_id"),
            "partId",
            x.get("part_id"),
            "quantity",
            q));
    return Records.dto(reservation(j, id));
  }

  Map<String, Object> transfer(Jwt j, UUID id) {
    var x =
        r.one(
            "select * from inventory.stock_transfers where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    if (!j.getClaimAsStringList("branches").contains(x.get("source_branch_id").toString())
        && !j.getClaimAsStringList("branches").contains(x.get("destination_branch_id").toString()))
      throw new ResponseStatusException(FORBIDDEN, "Transfer branch access required");
    return x;
  }

  List<Map<String, Object>> lines(Jwt j, UUID id) {
    return r.db.queryForList(
        "select * from inventory.stock_transfer_items where tenant_id=? and transfer_id=? order by"
            + " part_id for update",
        Access.tenant(j),
        id);
  }

  Map<String, Object> transferDetail(Jwt j, UUID id) {
    var x = Records.dto(transfer(j, id));
    x.put("items", lines(j, id).stream().map(Records::dto).toList());
    x.put(
        "history",
        r
            .db
            .queryForList(
                "select * from inventory.transfer_history where tenant_id=? and transfer_id=? order"
                    + " by created_at,id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    return x;
  }

  void history(Jwt j, UUID id, String action, String note, Object payload) {
    r.db.update(
        "insert into"
            + " inventory.transfer_history(id,tenant_id,transfer_id,action,note,actor_id,payload)"
            + " values(?,?,?,?,?,?,?::jsonb)",
        UUID.randomUUID(),
        Access.tenant(j),
        id,
        action,
        note,
        Access.user(j),
        Records.json(payload));
  }

  void transferStatus(Jwt j, UUID id, String status, String note, Object payload) {
    r.db.update(
        "update inventory.stock_transfers set status=?,version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        status,
        Access.tenant(j),
        id);
    history(j, id, status, note, payload);
  }

  @GetMapping("/inventory/transfers/{id}")
  public Map<String, Object> getTransfer(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVENTORY_READ);
    return transferDetail(j, id);
  }

  @GetMapping("/inventory/transfers")
  public Map<String, Object> transfers(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVENTORY_READ);
    Access.branch(j, branchId);
    Records.page(page, size);
    String f =
        " from inventory.stock_transfers where tenant_id=? and (source_branch_id=? or"
            + " destination_branch_id=?)";
    return Records.page(
        r.db.queryForList(
            "select *" + f + " order by created_at desc,id limit ? offset ?",
            Access.tenant(j),
            branchId,
            branchId,
            size,
            page * size),
        r.db.queryForObject(
            "select count(*)" + f, Long.class, Access.tenant(j), branchId, branchId),
        size);
  }

  @PostMapping("/inventory/transfers")
  public Map<String, Object> createTransfer(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Transfer in) {
    Access.require(j, Permission.INVENTORY_TRANSFER);
    if (!j.getClaimAsStringList("branches").contains(in.sourceBranchId().toString())
        && !j.getClaimAsStringList("branches").contains(in.destinationBranchId().toString()))
      throw new ResponseStatusException(
          FORBIDDEN, "An assigned endpoint branch is required to request a transfer");
    gateway.get(j, tenantUrl, "/api/stock-transfer/branches/" + in.sourceBranchId());
    gateway.get(j, tenantUrl, "/api/stock-transfer/branches/" + in.destinationBranchId());
    if (in.sourceBranchId().equals(in.destinationBranchId()))
      throw new ResponseStatusException(BAD_REQUEST, "Select different branches");
    if (in.items().stream().map(TransferLine::partId).distinct().count() != in.items().size())
      throw new ResponseStatusException(BAD_REQUEST, "Duplicate transfer part");
    var old = replay(j, key, "transfer", in);
    if (old != null) return transferDetail(j, old);
    UUID id = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " inventory.stock_transfers(id,tenant_id,source_branch_id,destination_branch_id,status,note,created_by)"
            + " values(?,?,?,?,'REQUESTED',?,?)",
        id,
        Access.tenant(j),
        in.sourceBranchId(),
        in.destinationBranchId(),
        in.note(),
        Access.user(j));
    for (var line : in.items()) {
      if (!Boolean.TRUE.equals(part(j, line.partId()).get("active")))
        throw new ResponseStatusException(CONFLICT, "Part is archived");
      r.db.update(
          "insert into inventory.stock_transfer_items(id,tenant_id,transfer_id,part_id,quantity)"
              + " values(?,?,?,?,?)",
          UUID.randomUUID(),
          Access.tenant(j),
          id,
          line.partId(),
          line.quantity());
    }
    history(j, id, "REQUESTED", in.note(), in);
    remember(j, key, "transfer", in, id);
    Outbox.append(r, "inventory", j, in.sourceBranchId(), id, "StockTransferRequested", in);
    return transferDetail(j, id);
  }

  @PostMapping("/inventory/transfers/{id}/{action:approve|reject|cancel|dispatch|in-transit}")
  public Map<String, Object> changeTransfer(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable String action,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.INVENTORY_TRANSFER);
    String op = action + id;
    var old = replay(j, key, op, in);
    var x = transfer(j, id);
    if (old != null) return transferDetail(j, id);
    UUID b = (UUID) x.get("source_branch_id");
    boolean withdraw =
        action.equals("cancel")
            && "REQUESTED".equals(x.get("status"))
            && Access.user(j).equals(x.get("created_by"))
            && j.getClaimAsStringList("branches")
                .contains(x.get("destination_branch_id").toString());
    branch(j, withdraw ? (UUID) x.get("destination_branch_id") : b, Permission.INVENTORY_TRANSFER);

    Records.version(x, in.version());
    String state = (String) x.get("status"), next;
    if (action.equals("approve") && state.equals("REQUESTED")) next = "APPROVED";
    else if (action.equals("reject") && state.equals("REQUESTED")) next = "REJECTED";
    else if (action.equals("cancel") && Set.of("REQUESTED", "APPROVED").contains(state))
      next = "CANCELLED";
    else if (action.equals("dispatch") && state.equals("APPROVED")) next = "DISPATCHED";
    else if (action.equals("in-transit") && state.equals("DISPATCHED")) next = "IN_TRANSIT";
    else throw new ResponseStatusException(CONFLICT, "Invalid transfer transition");
    if (next.equals("DISPATCHED"))
      gateway.get(j, tenantUrl, "/api/stock-transfer/branches/" + x.get("destination_branch_id"));
    for (var line : lines(j, id)) {
      BigDecimal q = decimal(line, "quantity");
      if (next.equals("APPROVED"))
        movement(
            j,
            b,
            (UUID) line.get("part_id"),
            BigDecimal.ZERO,
            q,
            "TRANSFER_RESERVE",
            id,
            in.note());
      if (next.equals("CANCELLED") && state.equals("APPROVED"))
        movement(
            j,
            b,
            (UUID) line.get("part_id"),
            BigDecimal.ZERO,
            q.negate(),
            "TRANSFER_RELEASE",
            id,
            in.note());
      if (next.equals("DISPATCHED"))
        movement(
            j,
            b,
            (UUID) line.get("part_id"),
            q.negate(),
            q.negate(),
            "TRANSFER_DISPATCH",
            id,
            in.note());
    }
    transferStatus(j, id, next, in.note(), in);
    remember(j, key, op, in, id);
    Outbox.append(
        r,
        "inventory",
        j,
        b,
        id,
        "StockTransfer"
            + switch (next) {
              case "APPROVED" -> "Approved";
              case "DISPATCHED" -> "Dispatched";
              default -> "StatusChanged";
            },
        Map.of("status", next));
    return transferDetail(j, id);
  }

  @PostMapping("/inventory/transfers/{id}/receive")
  public Map<String, Object> receiveTransfer(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody TransferReceipt in) {
    Access.require(j, Permission.INVENTORY_TRANSFER);
    String op = "receive" + id;
    var old = replay(j, key, op, in);
    var x = transfer(j, id);
    UUID b = (UUID) x.get("destination_branch_id");
    branch(j, b, Permission.INVENTORY_TRANSFER);
    if (old != null) return transferDetail(j, id);
    Records.version(x, in.version());
    if (!Set.of("DISPATCHED", "IN_TRANSIT", "PARTIALLY_RECEIVED").contains(x.get("status")))
      throw new ResponseStatusException(CONFLICT, "Transfer has not been dispatched");
    if (in.items().stream().map(ReceiptLine::partId).distinct().count() != in.items().size())
      throw new ResponseStatusException(BAD_REQUEST, "Duplicate receipt line");
    var all = lines(j, id);
    for (var item :
        in.items().stream()
            .sorted(Comparator.comparing(item -> item.partId().toString()))
            .toList()) {
      var line =
          all.stream()
              .filter(y -> item.partId().equals(y.get("part_id")))
              .findFirst()
              .orElseThrow(
                  () -> new ResponseStatusException(BAD_REQUEST, "Part is not in transfer"));
      if (item.quantity().add(item.damagedQuantity()).add(item.missingQuantity()).signum() <= 0)
        throw new ResponseStatusException(BAD_REQUEST, "Receipt quantity required");
      if (item.damagedQuantity().signum() > 0 || item.missingQuantity().signum() > 0)
        Access.require(j, Permission.INVENTORY_ADJUST);
      BigDecimal got = decimal(line, "received_quantity").add(item.quantity()),
          damaged = decimal(line, "damaged_quantity").add(item.damagedQuantity());
      BigDecimal missing = decimal(line, "missing_quantity").add(item.missingQuantity());
      if (got.add(damaged).add(missing).compareTo(decimal(line, "quantity")) > 0)
        throw new ResponseStatusException(CONFLICT, "Receipt exceeds dispatched quantity");
      if (item.quantity().signum() > 0)
        movement(
            j,
            b,
            item.partId(),
            item.quantity(),
            BigDecimal.ZERO,
            "TRANSFER_RECEIPT",
            id,
            in.note());
      r.db.update(
          "update inventory.stock_transfer_items set"
              + " received_quantity=?,damaged_quantity=?,missing_quantity=?,version=version+1,updated_at=now()"
              + " where tenant_id=? and id=?",
          got,
          damaged,
          missing,
          Access.tenant(j),
          line.get("id"));
    }
    boolean complete =
        lines(j, id).stream()
            .allMatch(
                y ->
                    decimal(y, "received_quantity")
                            .add(decimal(y, "damaged_quantity"))
                            .add(decimal(y, "missing_quantity"))
                            .compareTo(decimal(y, "quantity"))
                        == 0);
    transferStatus(j, id, complete ? "COMPLETED" : "PARTIALLY_RECEIVED", in.note(), in);
    remember(j, key, op, in, id);
    Outbox.append(r, "inventory", j, b, id, "StockTransferReceived", in);
    return transferDetail(j, id);
  }

  @GetMapping("/internal/history/work-orders/{id}/parts")
  public List<Map<String, Object>> historyParts(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.VEHICLE_HISTORY_READ);
    gateway.get(j, workorderUrl, "/api/internal/history/work-orders/" + id);
    return r
        .db
        .queryForList(
            "select s.id,p.name as description,p.sku,s.quantity,'USED' as status,s.updated_at as"
                + " consumed_at from inventory.stock_reservations s join inventory.parts p on"
                + " p.tenant_id=s.tenant_id and p.id=s.part_id where s.tenant_id=? and"
                + " s.work_order_id=? and s.status='CONSUMED' order by s.updated_at,s.id",
            Access.tenant(j),
            id)
        .stream()
        .map(
            row -> {
              var out = Records.dto(row);
              out.put("source", Map.of("service", "inventory", "resourceId", row.get("id")));
              return out;
            })
        .toList();
  }

  @GetMapping("/internal/work-orders/{id}/consumption")
  public Map<String, Object> consumption(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVOICE_WRITE);
    var w = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + id);
    Access.branch(j, Records.uuid(w.get("branchId")));
    return Map.of(
        "parts",
        r
            .db
            .queryForList(
                "select part_id,sum(quantity) as quantity from inventory.stock_reservations where"
                    + " tenant_id=? and work_order_id=? and status='CONSUMED' group by part_id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
  }

  @GetMapping("/inventory/reservations/{id}")
  public Map<String, Object> getReservation(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVENTORY_READ);
    return Records.dto(reservation(j, id));
  }
}
