package com.motoros.billing;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.*;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.*;
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
public class BillingController {
  private final Records r;
  private final ServiceGateway gateway;
  private final ApprovalCipher cipher;
  private final String tenantUrl, customerUrl, workorderUrl, inventoryUrl, appUrl;

  public BillingController(
      JdbcTemplate db,
      ServiceTokens tokens,
      ApprovalCipher cipher,
      @Value("${motoros.tenant-url}") String tenantUrl,
      @Value("${motoros.customer-url}") String customerUrl,
      @Value("${motoros.workorder-url}") String workorderUrl,
      @Value("${motoros.inventory-url}") String inventoryUrl,
      @Value("${motoros.app-url}") String appUrl) {
    r = new Records(db);
    gateway = new ServiceGateway(tokens);
    this.cipher = cipher;
    this.tenantUrl = tenantUrl;
    this.customerUrl = customerUrl;
    this.workorderUrl = workorderUrl;
    this.inventoryUrl = inventoryUrl;
    this.appUrl = appUrl;
  }

  public record Settings(
      @NotNull UUID branchId,
      @NotBlank @Pattern(regexp = "INR|USD|EUR|GBP") String currency,
      @NotNull @DecimalMin("0") @Digits(integer = 10, fraction = 2) BigDecimal laborHourlyRate,
      @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer = 3, fraction = 4)
          BigDecimal taxRate,
      @NotBlank @Size(max = 200) String legalName,
      @NotBlank @Size(max = 1000) String address,
      @NotBlank @Size(max = 100) String taxLabel,
      @Size(max = 100) String registrationReference,
      boolean paymentRequiredBeforeDelivery,
      @NotNull @Min(0) Long version) {}

  public record Item(
      @NotBlank @Pattern(regexp = "PART|LABOR|INSPECTION|SERVICE|MISC") String itemType,
      UUID partId,
      @NotBlank @Size(max = 500) String description,
      @NotNull @DecimalMin("0.001") @Digits(integer = 8, fraction = 3) BigDecimal quantity,
      @NotNull @DecimalMin("0") @Digits(integer = 10, fraction = 2) BigDecimal unitPrice,
      @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer = 3, fraction = 4)
          BigDecimal discountPercent) {}

  public record EstimateInput(
      @NotNull UUID branchId,
      @NotNull UUID workOrderId,
      @NotEmpty @Size(max = 100) List<@Valid Item> items,
      @NotNull Instant expiresAt,
      @NotNull @Size(max = 2000) String note,
      Long version) {}

  public record Change(@NotNull @Min(0) Long version, @NotBlank @Size(max = 1000) String note) {}

  public record ApprovalRequest(
      @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token,
      @NotBlank @Pattern(regexp = "APPROVED|REJECTED") String decision,
      @NotNull @Size(max = 1000) String note) {}

  public record ApprovalPreview(@NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token) {}

  public record InvoiceInput(@NotNull UUID estimateId) {}

  public record PaymentInput(
      @NotNull UUID invoiceId,
      @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @NotBlank @Pattern(regexp = "CASH|UPI|CARD|BANK|OTHER") String method,
      @NotBlank @Size(min = 8, max = 100) @Pattern(regexp = "[A-Za-z0-9_-]+")
          String externalReference,
      @NotBlank @Size(max = 1000) String note) {}

  public record RefundInput(
      @NotNull UUID paymentId,
      @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @NotBlank @Size(min = 8, max = 100) @Pattern(regexp = "[A-Za-z0-9_-]+")
          String externalReference,
      @NotBlank @Size(max = 1000) String reason) {}

  void branch(Jwt j, UUID b, Permission p) {
    Access.require(j, p);
    Access.branch(j, b);
    var x = gateway.get(j, tenantUrl, "/api/branches/" + b + "/operations");
    if (!"ACTIVE".equals(x.get("status")))
      throw new ResponseStatusException(CONFLICT, "Branch is inactive");
  }

  UUID replay(Jwt j, String key, String op, Object in) {
    return r.replay("billing", Access.tenant(j), Access.user(j), key, op, in);
  }

  void remember(Jwt j, String key, String op, Object in, UUID id) {
    r.remember("billing", Access.tenant(j), Access.user(j), key, op, in, id);
  }

  BigDecimal d(Map<String, Object> row, String field) {
    return new BigDecimal(row.get(field).toString());
  }

  void event(Jwt j, UUID b, UUID id, String action, Object payload) {
    r.db.update(
        "insert into"
            + " billing.billing_audit_events(id,tenant_id,branch_id,aggregate_id,action,actor_id,correlation_id,payload)"
            + " values(?,?,?,?,?,?,?,?::jsonb)",
        UUID.randomUUID(),
        Access.tenant(j),
        b,
        id,
        action,
        Access.user(j),
        Correlation.current(),
        Records.json(payload));
    Outbox.append(r, "billing", j, b, id, action, payload);
  }

  Map<String, Object> settings(Jwt j, UUID b) {
    return r.one(
        "select * from billing.branch_commercial_settings where tenant_id=? and branch_id=?",
        Access.tenant(j),
        b);
  }

  @GetMapping("/billing/settings")
  public Map<String, Object> getSettings(
      @AuthenticationPrincipal Jwt j, @RequestParam UUID branchId) {
    branch(j, branchId, Permission.ESTIMATE_READ);
    return Records.dto(settings(j, branchId));
  }

  @PutMapping("/billing/settings")
  public Map<String, Object> saveSettings(
      @AuthenticationPrincipal Jwt j, @Valid @RequestBody Settings in) {
    branch(j, in.branchId(), Permission.BRANCH_UPDATE);
    Access.require(j, Permission.INVOICE_WRITE);
    r.lock("billing-settings" + Access.tenant(j) + in.branchId());
    var rows =
        r.db.queryForList(
            "select * from billing.branch_commercial_settings where tenant_id=? and branch_id=? for"
                + " update",
            Access.tenant(j),
            in.branchId());
    if (!rows.isEmpty()) Records.version(rows.getFirst(), in.version());
    else if (in.version() != 0)
      throw new ResponseStatusException(CONFLICT, "Refresh branch settings");
    r.db.update(
        "insert into"
            + " billing.branch_commercial_settings(tenant_id,branch_id,currency,labor_hourly_rate,tax_rate,legal_name,address,tax_label,registration_reference,payment_required_before_delivery)"
            + " values(?,?,?,?,?,?,?,?,?,?) on conflict(tenant_id,branch_id) do update set"
            + " currency=excluded.currency,labor_hourly_rate=excluded.labor_hourly_rate,tax_rate=excluded.tax_rate,legal_name=excluded.legal_name,address=excluded.address,tax_label=excluded.tax_label,registration_reference=excluded.registration_reference,payment_required_before_delivery=excluded.payment_required_before_delivery,version=branch_commercial_settings.version+1,updated_at=now()",
        Access.tenant(j),
        in.branchId(),
        in.currency(),
        in.laborHourlyRate(),
        in.taxRate(),
        in.legalName(),
        in.address(),
        in.taxLabel(),
        in.registrationReference(),
        in.paymentRequiredBeforeDelivery());
    event(
        j,
        in.branchId(),
        in.branchId(),
        "CommercialSettingsUpdated",
        Map.of("branchId", in.branchId()));
    return Records.dto(settings(j, in.branchId()));
  }

  Map<String, Object> estimate(Jwt j, UUID id) {
    var x =
        r.one(
            "select * from billing.estimates where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    Access.branch(j, (UUID) x.get("branch_id"));
    return x;
  }

  List<Map<String, Object>> items(Jwt j, UUID id) {
    return r.db.queryForList(
        "select * from billing.estimate_items where tenant_id=? and estimate_id=? order by"
            + " line_number",
        Access.tenant(j),
        id);
  }

  Map<String, Object> detail(Jwt j, UUID id) {
    var x = Records.dto(estimate(j, id));
    x.put("items", items(j, id).stream().map(Records::dto).toList());
    x.put(
        "versions",
        r
            .db
            .queryForList(
                "select id,revision,status,created_at,submitted_at,decided_at from"
                    + " billing.estimates where tenant_id=? and series_id=? order by revision",
                Access.tenant(j),
                x.get("seriesId"))
            .stream()
            .map(Records::dto)
            .toList());
    return x;
  }

  @GetMapping("/estimates/{id}")
  public Map<String, Object> getEstimate(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.ESTIMATE_READ);
    return detail(j, id);
  }

  @GetMapping("/estimates")
  public Map<String, Object> estimates(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(required = false) UUID workOrderId,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.ESTIMATE_READ);
    return list(j, "estimates", branchId, workOrderId, status, page, size);
  }

  Map<String, Object> list(
      Jwt j, String table, UUID branch, UUID job, String status, int page, int size) {
    Access.branch(j, branch);
    Records.page(page, size);
    if (status.length() > 40) throw new ResponseStatusException(BAD_REQUEST);
    String f = " from billing." + table + " where tenant_id=? and branch_id=?";
    var a = new ArrayList<Object>(List.of(Access.tenant(j), branch));
    if (job != null) {
      f += " and work_order_id=?";
      a.add(job);
    }
    if (!status.isEmpty()) {
      f += " and status=?";
      a.add(status);
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

  @PostMapping("/estimates")
  public Map<String, Object> createEstimate(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody EstimateInput in) {
    return saveEstimate(j, null, key, in);
  }

  @PatchMapping("/estimates/{id}")
  public Map<String, Object> updateEstimate(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody EstimateInput in) {
    return saveEstimate(j, id, key, in);
  }

  Map<String, Object> saveEstimate(Jwt j, UUID id, String key, EstimateInput in) {
    branch(j, in.branchId(), Permission.ESTIMATE_CREATE);
    String op = "estimate:" + id;
    var old = replay(j, key, op, in);
    if (old != null) return detail(j, old);
    if (in.expiresAt().isBefore(Instant.now().plusSeconds(300))
        || in.expiresAt().isAfter(Instant.now().plus(Duration.ofDays(30))))
      throw new ResponseStatusException(BAD_REQUEST, "Expiry must be 5 minutes to 30 days ahead");
    var job = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + in.workOrderId());
    if (!in.branchId().toString().equals(job.get("branchId").toString())
        || job.get("customerId") == null)
      throw new ResponseStatusException(
          FORBIDDEN, "Work order customer and branch authorization required");
    if (Set.of("DELIVERED", "CLOSED", "CANCELLED").contains(job.get("status")))
      throw new ResponseStatusException(CONFLICT, "Work order is closed");
    var conf = settings(j, in.branchId());
    UUID t = Access.tenant(j);
    boolean create = id == null;
    if (create) {
      id = UUID.randomUUID();
      r.db.update(
          "insert into"
              + " billing.estimates(id,tenant_id,branch_id,customer_id,vehicle_id,work_order_id,series_id,revision,status,currency,subtotal,discount_total,tax_total,total,tax_rate,expires_at,note,created_by)"
              + " values(?,?,?,?,?,?,?,1,'DRAFT',?,0,0,0,0,?,?,?,?)",
          id,
          t,
          in.branchId(),
          Records.uuid(job.get("customerId")),
          Records.uuid(job.get("vehicleId")),
          in.workOrderId(),
          id,
          conf.get("currency"),
          conf.get("tax_rate"),
          Timestamp.from(in.expiresAt()),
          in.note(),
          Access.user(j));
    } else {
      var x = estimate(j, id);
      Records.version(x, in.version());
      if (!"DRAFT".equals(x.get("status")))
        throw new ResponseStatusException(CONFLICT, "Submitted estimates require a new revision");
      if (!in.workOrderId().equals(x.get("work_order_id"))
          || !in.branchId().equals(x.get("branch_id")))
        throw new ResponseStatusException(CONFLICT, "Estimate references are immutable");
      r.db.update("delete from billing.estimate_items where tenant_id=? and estimate_id=?", t, id);
    }
    calculateItems(j, id, in, conf);
    remember(j, key, op, in, id);
    event(
        j,
        in.branchId(),
        id,
        create ? "EstimateCreated" : "EstimateDraftUpdated",
        Map.of("workOrderId", in.workOrderId()));
    return detail(j, id);
  }

  void calculateItems(Jwt j, UUID id, EstimateInput in, Map<String, Object> conf) {
    BigDecimal subtotal = BigDecimal.ZERO,
        discount = BigDecimal.ZERO,
        tax = BigDecimal.ZERO,
        total = BigDecimal.ZERO;
    int index = 0;
    for (var item : in.items()) {
      BigDecimal price = item.unitPrice();
      Map<String, Object> source = new LinkedHashMap<>();
      if (item.itemType().equals("PART")) {
        if (item.partId() == null)
          throw new ResponseStatusException(BAD_REQUEST, "Part reference required");
        var part = gateway.get(j, inventoryUrl, "/api/parts/" + item.partId());
        if (!Boolean.TRUE.equals(part.get("active"))
            || !conf.get("currency").equals(part.get("currency")))
          throw new ResponseStatusException(CONFLICT, "Part is archived or currency differs");
        price = new BigDecimal(part.get("sellingPrice").toString());
        source.put("service", "inventory");
        source.put("partId", item.partId());
        source.put("catalogVersion", part.get("version"));
        source.put("sku", part.get("sku"));
      } else {
        if (item.partId() != null)
          throw new ResponseStatusException(BAD_REQUEST, "Only PART lines may reference parts");
        source.put("service", "billing");
        source.put("settingsVersion", conf.get("version"));
        if (item.itemType().equals("LABOR")) price = d(conf, "labor_hourly_rate");
      }
      var line = Money.line(item.quantity(), price, item.discountPercent(), d(conf, "tax_rate"));
      subtotal = subtotal.add(line.gross());
      discount = discount.add(line.discount());
      tax = tax.add(line.tax());
      total = total.add(line.total());
      r.db.update(
          "insert into"
              + " billing.estimate_items(id,tenant_id,estimate_id,line_number,item_type,part_id,description,quantity,unit_price,discount_percent,net_amount,discount_amount,tax_amount,total,source_reference)"
              + " values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb)",
          UUID.randomUUID(),
          Access.tenant(j),
          id,
          ++index,
          item.itemType(),
          item.partId(),
          item.description(),
          item.quantity(),
          price,
          item.discountPercent(),
          line.net(),
          line.discount(),
          line.tax(),
          line.total(),
          Records.json(source));
    }
    if (subtotal.precision() > 19
        || discount.precision() > 19
        || tax.precision() > 19
        || total.precision() > 19)
      throw new ResponseStatusException(
          BAD_REQUEST, "Estimate exceeds the supported document amount");
    r.db.update(
        "update billing.estimates set"
            + " subtotal=?,discount_total=?,tax_total=?,total=?,currency=?,tax_rate=?,expires_at=?,note=?,version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        subtotal,
        discount,
        tax,
        total,
        conf.get("currency"),
        conf.get("tax_rate"),
        Timestamp.from(in.expiresAt()),
        in.note(),
        Access.tenant(j),
        id);
  }

  @PostMapping("/estimates/{id}/revise")
  public Map<String, Object> revise(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.ESTIMATE_CREATE);
    String op = "revise" + id;
    var old = replay(j, key, op, in);
    if (old != null) return detail(j, old);
    var x = estimate(j, id);
    Records.version(x, in.version());
    if (!Set.of("APPROVED", "REJECTED", "EXPIRED", "PENDING_CUSTOMER_APPROVAL")
        .contains(x.get("status")))
      throw new ResponseStatusException(CONFLICT, "This version cannot be revised");
    r.lock("estimate-series" + Access.tenant(j) + x.get("series_id"));
    if (!r.db
        .queryForList(
            "select id from billing.invoices where tenant_id=? and work_order_id=?",
            Access.tenant(j),
            x.get("work_order_id"))
        .isEmpty())
      throw new ResponseStatusException(
          CONFLICT, "Invoice exists; use documented invoice adjustments");
    UUID next = UUID.randomUUID();
    r.db.update(
        "update billing.estimates set status='SUPERSEDED',version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        Access.tenant(j),
        id);
    r.db.update(
        "update billing.estimate_approvals set status='REVOKED' where tenant_id=? and estimate_id=?"
            + " and status='PENDING'",
        Access.tenant(j),
        id);
    r.db.update(
        "insert into"
            + " billing.estimates(id,tenant_id,branch_id,customer_id,vehicle_id,work_order_id,series_id,revision,status,currency,subtotal,discount_total,tax_total,total,tax_rate,expires_at,note,created_by)"
            + " select"
            + " ?,tenant_id,branch_id,customer_id,vehicle_id,work_order_id,series_id,revision+1,'DRAFT',currency,subtotal,discount_total,tax_total,total,tax_rate,now()+interval"
            + " '7 days',?,? from billing.estimates where tenant_id=? and id=?",
        next,
        in.note(),
        Access.user(j),
        Access.tenant(j),
        id);
    r.db.update(
        "insert into"
            + " billing.estimate_items(id,tenant_id,estimate_id,line_number,item_type,part_id,description,quantity,unit_price,discount_percent,net_amount,discount_amount,tax_amount,total,source_reference)"
            + " select"
            + " gen_random_uuid(),tenant_id,?,line_number,item_type,part_id,description,quantity,unit_price,discount_percent,net_amount,discount_amount,tax_amount,total,source_reference"
            + " from billing.estimate_items where tenant_id=? and estimate_id=?",
        next,
        Access.tenant(j),
        id);
    remember(j, key, op, in, next);
    event(
        j,
        (UUID) x.get("branch_id"),
        next,
        "EstimateCreated",
        Map.of("previousVersion", id, "revision", ((Number) x.get("revision")).intValue() + 1));
    return detail(j, next);
  }

  @PostMapping("/estimates/{id}/submit")
  public Map<String, Object> submit(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.ESTIMATE_CREATE);
    String op = "submit" + id;
    var old = replay(j, key, op, in);
    if (old != null) return detail(j, id);
    var x = estimate(j, id);
    Records.version(x, in.version());
    if (!"DRAFT".equals(x.get("status"))
        || Records.instant(x.get("expires_at")).isBefore(Instant.now()))
      throw new ResponseStatusException(CONFLICT, "Estimate is not a valid draft");
    var scope = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + x.get("work_order_id"));
    var customer = gateway.get(j, customerUrl, "/api/customers/" + x.get("customer_id"));
    String email = Objects.toString(customer.get("email"), "").strip().toLowerCase(Locale.ROOT);
    if (email.isEmpty() || !"ACTIVE".equals(customer.get("status")))
      throw new ResponseStatusException(CONFLICT, "An active customer with an email is required");
    var vehicle = gateway.get(j, customerUrl, "/api/vehicles/" + x.get("vehicle_id"));
    if (!x.get("customer_id").toString().equals(Objects.toString(vehicle.get("customerId"), "")))
      throw new ResponseStatusException(CONFLICT, "Customer no longer owns this vehicle");
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    UUID approval = UUID.randomUUID();
    Instant expiry = Records.instant(x.get("expires_at"));
    if (expiry.isAfter(Instant.now().plus(Duration.ofHours(24))))
      expiry = Instant.now().plus(Duration.ofHours(24));
    r.db.update(
        "insert into"
            + " billing.estimate_approvals(id,tenant_id,estimate_id,customer_id,recipient,token_hash,expires_at)"
            + " values(?,?,?,?,?,?,?)",
        approval,
        Access.tenant(j),
        id,
        x.get("customer_id"),
        email,
        hash(token),
        Timestamp.from(expiry));
    String url =
        appUrl + "/approval#token=" + token + "&tenant=" + Access.tenant(j) + "&estimate=" + id;
    String body =
        "Review estimate revision "
            + x.get("revision")
            + " for your MotorOS vehicle. Sign in with the verified customer account for this"
            + " email. This link expires at "
            + expiry
            + ".\n\n"
            + url
            + "\n\n"
            + "Approval applies only to this version and its listed scope. No card details are"
            + " requested.";
    r.db.update(
        "insert into"
            + " billing.approval_mail_outbox(id,tenant_id,estimate_id,recipient,encrypted_body)"
            + " values(?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        id,
        email,
        cipher.encrypt(body));
    r.db.update(
        "update billing.estimates set"
            + " status='PENDING_CUSTOMER_APPROVAL',submitted_at=now(),work_order_scope=?::jsonb,version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        Records.json(scope.get("tasks")),
        Access.tenant(j),
        id);
    remember(j, key, op, in, id);
    event(
        j,
        (UUID) x.get("branch_id"),
        id,
        "EstimateSubmitted",
        Map.of("revision", x.get("revision"), "approvalId", approval));
    return detail(j, id);
  }

  static String hash(String token) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  Map<String, Object> customerApproval(Jwt j, UUID id, String token) {
    if (!"CUSTOMER".equals(j.getClaimAsString("role"))
        || !Boolean.TRUE.equals(j.getClaim("email_verified")))
      throw new ResponseStatusException(FORBIDDEN, "A verified customer account is required");
    var x =
        r.one(
            "select * from billing.estimate_approvals where tenant_id=? and estimate_id=? and"
                + " token_hash=? for update",
            Access.tenant(j),
            id,
            hash(token));
    String email =
        Objects.toString(j.getClaimAsString("email"), "").strip().toLowerCase(Locale.ROOT);
    if (!email.equals(x.get("recipient"))
        || Records.instant(x.get("expires_at")).isBefore(Instant.now()))
      throw new ResponseStatusException(
          FORBIDDEN, "Approval link is expired or belongs to another customer");
    return x;
  }

  @PostMapping("/estimates/{id}/approval-preview")
  public Map<String, Object> preview(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @Valid @RequestBody ApprovalPreview in) {
    var x =
        r.one(
            "select * from billing.estimates where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    customerApproval(j, id, in.token());
    if (!"PENDING_CUSTOMER_APPROVAL".equals(x.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "This estimate version is no longer awaiting approval");
    var out = Records.dto(x);
    out.remove("createdBy");
    out.put("items", items(j, id).stream().map(Records::dto).toList());
    return out;
  }

  @PostMapping("/estimates/{id}/{action:approve|reject}")
  public Map<String, Object> decide(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable String action,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody ApprovalRequest in) {
    String op = "decide" + id;
    var old = replay(j, key, op, in);
    var x =
        r.one(
            "select * from billing.estimates where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    var approval = customerApproval(j, id, in.token());
    if (old != null) return Map.of("id", id, "status", x.get("status"));
    if (!in.decision().equals(action.equals("approve") ? "APPROVED" : "REJECTED"))
      throw new ResponseStatusException(BAD_REQUEST, "Decision mismatch");
    if (!"PENDING_CUSTOMER_APPROVAL".equals(x.get("status"))
        || !"PENDING".equals(approval.get("status"))
        || Records.instant(x.get("expires_at")).isBefore(Instant.now()))
      throw new ResponseStatusException(CONFLICT, "This version cannot be decided");
    r.db.update(
        "update billing.estimates set status=?,decided_at=now(),version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        in.decision(),
        Access.tenant(j),
        id);
    r.db.update(
        "update billing.estimate_approvals set"
            + " status=?,actor_id=?,identity_issuer=?,identity_subject=?,decision_note=?,decided_at=now()"
            + " where tenant_id=? and id=?",
        in.decision(),
        Access.user(j),
        j.getIssuer().toString(),
        j.getSubject(),
        in.note(),
        Access.tenant(j),
        approval.get("id"));
    remember(j, key, op, in, id);
    event(
        j,
        (UUID) x.get("branch_id"),
        id,
        action.equals("approve") ? "EstimateApproved" : "EstimateRejected",
        Map.of(
            "revision",
            x.get("revision"),
            "customerId",
            x.get("customer_id"),
            "workOrderId",
            x.get("work_order_id")));
    return Map.of("id", id, "status", in.decision());
  }

  @GetMapping("/internal/commercial/work-orders/{id}")
  public Map<String, Object> authority(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.WORKORDER_READ);
    var job = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + id);
    UUID branchId = Records.uuid(job.get("branchId"));
    Access.branch(j, branchId);
    var es =
        r.db.queryForList(
            "select id,customer_id,vehicle_id,revision,status,work_order_scope from"
                + " billing.estimates where tenant_id=? and work_order_id=? order by revision desc"
                + " limit 1",
            Access.tenant(j),
            id);
    var result = new LinkedHashMap<String, Object>();
    result.put("workOrderId", id);
    result.put("branchId", branchId);
    result.put("approvalValid", false);
    result.put("deliveryReady", false);
    if (es.isEmpty()) return result;
    var e = es.getFirst();
    result.put("estimateId", e.get("id"));
    result.put("customerId", e.get("customer_id"));
    result.put("vehicleId", e.get("vehicle_id"));
    result.put("revision", e.get("revision"));
    result.put("approvalValid", "APPROVED".equals(e.get("status")));
    result.put("scope", Records.dto(e).get("workOrderScope"));
    result.put(
        "parts",
        r
            .db
            .queryForList(
                "select part_id,sum(quantity) as quantity from billing.estimate_items where"
                    + " tenant_id=? and estimate_id=? and item_type='PART' group by part_id",
                Access.tenant(j),
                e.get("id"))
            .stream()
            .map(Records::dto)
            .toList());
    var inv =
        r.db.queryForList(
            "select * from billing.invoices where tenant_id=? and work_order_id=? and"
                + " status='ISSUED'",
            Access.tenant(j),
            id);
    if (!inv.isEmpty()) {
      var invoice = inv.getFirst();
      var policy = settings(j, branchId);
      boolean paid = balance(j, invoice).signum() == 0;
      result.put("invoiceId", invoice.get("id"));
      result.put(
          "deliveryReady",
          !Boolean.TRUE.equals(policy.get("payment_required_before_delivery")) || paid);
    }
    return result;
  }

  Map<String, Object> invoice(Jwt j, UUID id) {
    var x =
        r.one(
            "select * from billing.invoices where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    Access.branch(j, (UUID) x.get("branch_id"));
    return x;
  }

  BigDecimal paid(Jwt j, UUID id) {
    return r.db.queryForObject(
        "select coalesce(sum(case when record_type='PAYMENT' then amount else -amount end),0) from"
            + " billing.payments where tenant_id=? and invoice_id=?",
        BigDecimal.class,
        Access.tenant(j),
        id);
  }

  BigDecimal credits(Jwt j, UUID id) {
    return r.db.queryForObject(
        "select coalesce(sum(amount),0) from billing.invoice_adjustments where tenant_id=? and"
            + " invoice_id=?",
        BigDecimal.class,
        Access.tenant(j),
        id);
  }

  BigDecimal balance(Jwt j, Map<String, Object> x) {
    return d(x, "total")
        .subtract(credits(j, (UUID) x.get("id")))
        .subtract(paid(j, (UUID) x.get("id")))
        .max(BigDecimal.ZERO);
  }

  Map<String, Object> invoiceDetail(Jwt j, UUID id) {
    var row = invoice(j, id);
    var out = Records.dto(row);
    out.put(
        "payments",
        r
            .db
            .queryForList(
                "select * from billing.payments where tenant_id=? and invoice_id=? order by"
                    + " created_at,id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    out.put(
        "adjustments",
        r
            .db
            .queryForList(
                "select * from billing.invoice_adjustments where tenant_id=? and invoice_id=? order"
                    + " by created_at,id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    out.put("paid", paid(j, id));
    out.put("outstanding", balance(j, row));
    out.put(
        "refundDue",
        paid(j, id).add(credits(j, id)).subtract(d(row, "total")).max(BigDecimal.ZERO));
    out.put(
        "paymentStatus",
        balance(j, row).signum() == 0
            ? "PAID"
            : paid(j, id).signum() > 0 ? "PARTIALLY_PAID" : "UNPAID");
    return out;
  }

  @GetMapping("/invoices/{id}")
  public Map<String, Object> getInvoice(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVOICE_READ);
    return invoiceDetail(j, id);
  }

  @GetMapping("/invoices")
  public Map<String, Object> invoices(
      @AuthenticationPrincipal Jwt j,
      @RequestParam UUID branchId,
      @RequestParam(required = false) UUID workOrderId,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(defaultValue = "false") boolean outstandingOnly,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.INVOICE_READ);
    Access.branch(j, branchId);
    Records.page(page, size);
    if (status.length() > 30) throw new ResponseStatusException(BAD_REQUEST);
    String balance = "greatest(0,i.total-coalesce(c.amount,0)-coalesce(p.amount,0))";
    String f =
        " from billing.invoices i left join lateral(select sum(amount) as amount from"
            + " billing.invoice_adjustments where tenant_id=i.tenant_id and invoice_id=i.id) c on"
            + " true left join lateral(select sum(case when record_type='PAYMENT' then amount else"
            + " -amount end) as amount from billing.payments where tenant_id=i.tenant_id and"
            + " invoice_id=i.id) p on true where i.tenant_id=? and i.branch_id=?";
    var args = new ArrayList<Object>(List.of(Access.tenant(j), branchId));
    if (workOrderId != null) {
      f += " and i.work_order_id=?";
      args.add(workOrderId);
    }
    if (!status.isEmpty()) {
      f += " and i.status=?";
      args.add(status);
    }
    if (outstandingOnly) f += " and i.status='ISSUED' and " + balance + ">0";
    long count = r.db.queryForObject("select count(*)" + f, Long.class, args.toArray());
    args.add(size);
    args.add(page * size);
    return Records.page(
        r.db.queryForList(
            "select i.*,coalesce(p.amount,0) as paid,"
                + balance
                + " as outstanding"
                + f
                + " order by i.created_at desc,i.id limit ? offset ?",
            args.toArray()),
        count,
        size);
  }

  @PostMapping("/invoices")
  public Map<String, Object> createInvoice(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody InvoiceInput in) {
    Access.require(j, Permission.INVOICE_WRITE);
    var old = replay(j, key, "invoice", in);
    if (old != null) return invoiceDetail(j, old);
    var e = estimate(j, in.estimateId());
    branch(j, (UUID) e.get("branch_id"), Permission.INVOICE_WRITE);
    if (!"APPROVED".equals(e.get("status")))
      throw new ResponseStatusException(CONFLICT, "Invoice requires customer-approved estimate");
    var job = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + e.get("work_order_id"));
    if (!Set.of("QUALITY_CHECK", "READY_FOR_DELIVERY").contains(job.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "Complete repairs and submit for quality review before invoicing");
    var customer = gateway.get(j, customerUrl, "/api/customers/" + e.get("customer_id"));
    var vehicle = gateway.get(j, customerUrl, "/api/vehicles/" + e.get("vehicle_id"));
    var snapshot = new LinkedHashMap<String, Object>();
    snapshot.put("workshop", Records.dto(settings(j, (UUID) e.get("branch_id"))));
    snapshot.put("customer", customer);
    snapshot.put("vehicle", vehicle);
    snapshot.put("jobCardNumber", job.get("jobCardNumber"));
    snapshot.put("estimateId", in.estimateId());
    snapshot.put("estimateRevision", e.get("revision"));
    snapshot.put("items", items(j, in.estimateId()).stream().map(Records::dto).toList());
    snapshot.put(
        "taxComplianceStatement",
        "Configured workshop tax; this document does not certify regulatory compliance.");
    UUID id = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " billing.invoices(id,tenant_id,branch_id,customer_id,vehicle_id,work_order_id,estimate_id,status,currency,subtotal,discount_total,tax_total,total,snapshot,created_by)"
            + " values(?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?::jsonb,?)",
        id,
        Access.tenant(j),
        e.get("branch_id"),
        e.get("customer_id"),
        e.get("vehicle_id"),
        e.get("work_order_id"),
        in.estimateId(),
        e.get("currency"),
        e.get("subtotal"),
        e.get("discount_total"),
        e.get("tax_total"),
        e.get("total"),
        Records.json(snapshot),
        Access.user(j));
    for (var item : items(j, in.estimateId()))
      r.db.update(
          "insert into billing.invoice_items(id,tenant_id,invoice_id,line_number,snapshot)"
              + " values(?,?,?,?,?::jsonb)",
          UUID.randomUUID(),
          Access.tenant(j),
          id,
          item.get("line_number"),
          Records.json(Records.dto(item)));
    remember(j, key, "invoice", in, id);
    event(
        j,
        (UUID) e.get("branch_id"),
        id,
        "InvoiceDraftCreated",
        Map.of("estimateId", in.estimateId()));
    return invoiceDetail(j, id);
  }

  @PostMapping("/invoices/{id}/issue")
  public Map<String, Object> issue(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.INVOICE_WRITE);
    String op = "issue" + id;
    var old = replay(j, key, op, in);
    var x = invoice(j, id);
    branch(j, (UUID) x.get("branch_id"), Permission.INVOICE_WRITE);
    if (old != null) return invoiceDetail(j, id);
    Records.version(x, in.version());
    if (!"DRAFT".equals(x.get("status")))
      throw new ResponseStatusException(CONFLICT, "Invoice is already issued");
    var qc = gateway.get(j, workorderUrl, "/api/internal/work-orders/" + x.get("work_order_id"));
    if (!x.get("estimate_id")
            .toString()
            .equals(Objects.toString(qc.get("commercialEstimateId"), ""))
        || qc.get("qualityPassedAt") == null
        || !Set.of("QUALITY_CHECK", "READY_FOR_DELIVERY").contains(qc.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "Quality sign-off is required before issuing a commercial invoice");
    var e = estimate(j, (UUID) x.get("estimate_id"));
    if (!"APPROVED".equals(e.get("status")))
      throw new ResponseStatusException(CONFLICT, "Approval was superseded");
    var required =
        items(j, (UUID) x.get("estimate_id")).stream()
            .filter(v -> "PART".equals(v.get("item_type")))
            .toList();
    if (!required.isEmpty()) {
      var proof =
          gateway.get(
              j,
              inventoryUrl,
              "/api/internal/work-orders/" + x.get("work_order_id") + "/consumption");
      var consumed = (List<Map<String, Object>>) proof.get("parts");
      var quantities = new HashMap<UUID, BigDecimal>();
      for (var part : required)
        quantities.merge((UUID) part.get("part_id"), d(part, "quantity"), BigDecimal::add);
      for (var part : quantities.entrySet()) {
        BigDecimal actual =
            consumed.stream()
                .filter(v -> part.getKey().toString().equals(v.get("partId").toString()))
                .map(v -> new BigDecimal(v.get("quantity").toString()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (actual.compareTo(part.getValue()) < 0)
          throw new ResponseStatusException(
              CONFLICT, "Record approved part installation before issuing this invoice");
      }
    }
    UUID b = (UUID) x.get("branch_id");
    int year = Year.now(ZoneOffset.UTC).getValue();
    r.db.update(
        "insert into billing.invoice_counters(tenant_id,branch_id,year) values(?,?,?) on conflict"
            + " do nothing",
        Access.tenant(j),
        b,
        year);
    long number =
        r.db.queryForObject(
            "update billing.invoice_counters set last_value=last_value+1 where tenant_id=? and"
                + " branch_id=? and year=? returning last_value",
            Long.class,
            Access.tenant(j),
            b,
            year);
    String human = "INV-" + b + "-" + year + "-" + String.format(Locale.ROOT, "%06d", number);
    r.db.update(
        "update billing.invoices set"
            + " status='ISSUED',invoice_number=?,issued_at=now(),version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        human,
        Access.tenant(j),
        id);
    remember(j, key, op, in, id);
    event(
        j,
        b,
        id,
        "InvoiceIssued",
        Map.of("invoiceNumber", human, "workOrderId", x.get("work_order_id")));
    return invoiceDetail(j, id);
  }

  @PostMapping("/payments")
  public Map<String, Object> recordPayment(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody PaymentInput in) {
    Access.require(j, Permission.PAYMENT_RECORD);
    var old = replay(j, key, "payment", in);
    var x = invoice(j, in.invoiceId());
    branch(j, (UUID) x.get("branch_id"), Permission.PAYMENT_RECORD);
    if (old != null) return payment(j, old);
    if (!"ISSUED".equals(x.get("status")) || in.amount().compareTo(balance(j, x)) > 0)
      throw new ResponseStatusException(
          CONFLICT, "Payment exceeds outstanding amount or invoice is unissued");
    UUID id = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " billing.payments(id,tenant_id,branch_id,invoice_id,amount,currency,method,external_reference,record_type,recorded_by,note)"
            + " values(?,?,?,?,?,?,?,?,'PAYMENT',?,?)",
        id,
        Access.tenant(j),
        x.get("branch_id"),
        in.invoiceId(),
        in.amount(),
        x.get("currency"),
        in.method(),
        in.externalReference(),
        Access.user(j),
        in.note());
    remember(j, key, "payment", in, id);
    event(
        j,
        (UUID) x.get("branch_id"),
        id,
        "PaymentRecorded",
        Map.of("invoiceId", in.invoiceId(), "amount", in.amount(), "providerVerified", false));
    return payment(j, id);
  }

  Map<String, Object> payment(Jwt j, UUID id) {
    var p =
        r.one("select * from billing.payments where tenant_id=? and id=?", Access.tenant(j), id);
    Access.branch(j, (UUID) p.get("branch_id"));
    var out = Records.dto(p);
    out.put("providerVerified", false);
    return out;
  }

  @GetMapping("/invoices/{id}/payments")
  public List<Map<String, Object>> payments(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVOICE_READ);
    invoice(j, id);
    return r
        .db
        .queryForList(
            "select * from billing.payments where tenant_id=? and invoice_id=? order by"
                + " created_at,id",
            Access.tenant(j),
            id)
        .stream()
        .map(Records::dto)
        .toList();
  }

  @PostMapping("/payments/{id}/reconcile")
  public Map<String, Object> reconcile(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.PAYMENT_RECONCILE);
    String op = "reconcile" + id;
    var old = replay(j, key, op, in);
    var p =
        r.one(
            "select * from billing.payments where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    branch(j, (UUID) p.get("branch_id"), Permission.PAYMENT_RECONCILE);
    if (old != null) return payment(j, id);
    Records.version(p, in.version());
    if (!"UNRECONCILED".equals(p.get("reconciliation_status")))
      throw new ResponseStatusException(CONFLICT, "Payment already reconciled");
    if (Access.user(j).equals(p.get("recorded_by")))
      throw new ResponseStatusException(
          FORBIDDEN, "A separate reviewer must reconcile this payment");
    r.db.update(
        "update billing.payments set"
            + " reconciliation_status='RECONCILED',reconciled_by=?,reconciled_at=now(),version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        Access.user(j),
        Access.tenant(j),
        id);
    remember(j, key, op, in, id);
    event(
        j,
        (UUID) p.get("branch_id"),
        id,
        "PaymentReconciled",
        Map.of("note", in.note(), "providerVerified", false));
    return payment(j, id);
  }

  @PostMapping("/payments/refunds")
  public Map<String, Object> refund(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody RefundInput in) {
    Access.require(j, Permission.PAYMENT_REFUND);
    var old = replay(j, key, "refund", in);
    var original =
        r.one(
            "select * from billing.payments where tenant_id=? and id=?",
            Access.tenant(j),
            in.paymentId());
    var x = invoice(j, (UUID) original.get("invoice_id"));
    branch(j, (UUID) x.get("branch_id"), Permission.PAYMENT_REFUND);
    if (old != null) return payment(j, old);
    if (!"PAYMENT".equals(original.get("record_type")))
      throw new ResponseStatusException(CONFLICT, "Only original payments may be refunded");
    BigDecimal refunded =
        r.db.queryForObject(
            "select coalesce(sum(amount),0) from billing.payments where tenant_id=? and"
                + " original_payment_id=?",
            BigDecimal.class,
            Access.tenant(j),
            in.paymentId());
    if (in.amount().add(refunded).compareTo(d(original, "amount")) > 0)
      throw new ResponseStatusException(CONFLICT, "Refund exceeds original payment");
    UUID id = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " billing.payments(id,tenant_id,branch_id,invoice_id,amount,currency,method,external_reference,record_type,original_payment_id,recorded_by,note)"
            + " values(?,?,?,?,?,?,?,?,'REFUND',?,?,?)",
        id,
        Access.tenant(j),
        x.get("branch_id"),
        x.get("id"),
        in.amount(),
        x.get("currency"),
        original.get("method"),
        in.externalReference(),
        in.paymentId(),
        Access.user(j),
        in.reason());
    remember(j, key, "refund", in, id);
    event(
        j,
        (UUID) x.get("branch_id"),
        id,
        "PaymentRefunded",
        Map.of("originalPaymentId", in.paymentId(), "amount", in.amount()));
    return payment(j, id);
  }

  public record Credit(
      @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
      @NotBlank @Size(min = 10, max = 1000) String reason) {}

  @PostMapping("/invoices/{id}/adjustments")
  public Map<String, Object> credit(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Credit in) {
    Access.require(j, Permission.PAYMENT_REFUND);
    String op = "credit" + id;
    var old = replay(j, key, op, in);
    var x = invoice(j, id);
    branch(j, (UUID) x.get("branch_id"), Permission.PAYMENT_REFUND);
    if (old != null) return invoiceDetail(j, id);
    if (!"ISSUED".equals(x.get("status"))
        || credits(j, id).add(in.amount()).compareTo(d(x, "total")) > 0)
      throw new ResponseStatusException(CONFLICT, "Invalid invoice credit");
    UUID credit = UUID.randomUUID();
    r.db.update(
        "insert into billing.invoice_adjustments(id,tenant_id,invoice_id,amount,reason,created_by)"
            + " values(?,?,?,?,?,?)",
        credit,
        Access.tenant(j),
        id,
        in.amount(),
        in.reason(),
        Access.user(j));
    remember(j, key, op, in, id);
    event(
        j,
        (UUID) x.get("branch_id"),
        credit,
        "InvoiceCreditRecorded",
        Map.of("invoiceId", id, "amount", in.amount(), "reason", in.reason()));
    return invoiceDetail(j, id);
  }

  @PostMapping("/estimates/{id}/cancel")
  public Map<String, Object> cancelEstimate(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Change in) {
    Access.require(j, Permission.ESTIMATE_CREATE);
    String op = "cancel" + id;
    var old = replay(j, key, op, in);
    var e = estimate(j, id);
    if (old != null) return detail(j, id);
    Records.version(e, in.version());
    if (!Set.of("DRAFT", "PENDING_CUSTOMER_APPROVAL").contains(e.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "Only draft or pending estimates may be cancelled");
    r.db.update(
        "update billing.estimates set status='CANCELLED',version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        Access.tenant(j),
        id);
    r.db.update(
        "update billing.estimate_approvals set status='REVOKED' where tenant_id=? and estimate_id=?"
            + " and status='PENDING'",
        Access.tenant(j),
        id);
    remember(j, key, op, in, id);
    event(j, (UUID) e.get("branch_id"), id, "EstimateCancelled", Map.of("note", in.note()));
    return detail(j, id);
  }
}
