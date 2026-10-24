package com.motoros.workorder;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.foundation.ServiceGateway;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
@Transactional
public class WorkshopController {
  private final Records r;
  private final ServiceGateway gateway;
  private final String tenant, customer, booking;
  private final boolean development;
  private final Environment environment;

  @Value("${motoros.billing-url:http://127.0.0.1:8086}")
  private String billingUrl;

  WorkshopController(
      JdbcTemplate db,
      ServiceTokens tokens,
      Environment environment,
      @Value("${motoros.tenant-url}") String tenant,
      @Value("${motoros.customer-url}") String customer,
      @Value("${motoros.booking-url}") String booking,
      @Value("${motoros.development-approval:false}") boolean development) {
    r = new Records(db);
    gateway = new ServiceGateway(tokens);
    this.tenant = tenant;
    this.customer = customer;
    this.booking = booking;
    this.development = development;
    this.environment = environment;
  }

  public record Create(
      @NotNull UUID branchId,
      @NotNull UUID vehicleId,
      UUID customerId,
      @NotBlank @Size(max = 2000) String complaint) {}

  public record Intake(
      @NotNull UUID branchId,
      @NotNull UUID customerId,
      @NotNull UUID vehicleId,
      UUID appointmentId,
      @NotNull @Min(0) @Max(9999999) Long odometerKilometers,
      @NotBlank @Size(max = 2000) String complaints,
      @NotBlank @Size(max = 1000) String serviceRequested,
      @Size(max = 2000) String damageObservations,
      @Min(0) @Max(100) Integer fuelLevel,
      @Size(max = 30) List<@NotBlank @Size(max = 100) String> accessories,
      UUID serviceAdvisorId) {}

  public record Change(
      @NotNull Status status,
      @NotNull @Min(0) Long version,
      @NotBlank @Size(max = 1000) String note) {}

  public record Assign(
      @NotNull UUID technicianId,
      @NotNull @Min(0) Long version,
      @NotBlank @Size(max = 1000) String reason) {}

  public record Edit(
      @NotNull @Min(0) Long version,
      @NotBlank @Size(max = 2000) String complaint,
      @Pattern(regexp = "LOW|NORMAL|HIGH|URGENT") String priority,
      Instant estimatedCompletionAt) {}

  public record Task(
      @NotBlank @Size(max = 1000) String taskDescription,
      @NotBlank @Size(max = 80) String taskCategory,
      @NotBlank @Pattern(regexp = "LOW|NORMAL|HIGH|URGENT") String priority,
      @Min(1) @Max(1440) int estimatedDurationMinutes,
      UUID assignedTechnicianId) {}

  public record TaskChange(
      @NotNull @Min(0) Long version,
      @NotBlank @Pattern(regexp = "TODO|IN_PROGRESS|BLOCKED|COMPLETED|CANCELLED") String status,
      @NotBlank @Size(max = 1000) String note,
      @Pattern(regexp = "LOW|NORMAL|HIGH|URGENT") String priority,
      UUID assignedTechnicianId) {}

  public record Note(
      @NotBlank @Pattern(regexp = "TECHNICIAN|INSPECTION|ADDITIONAL_WORK") String kind,
      @NotBlank @Size(max = 2000) String note) {}

  public record Part(
      @NotBlank @Size(max = 300) String description,
      @NotNull
          @DecimalMin("0.001")
          @DecimalMax("10000")
          @Digits(integer = 5, fraction = 3)
          @io.swagger.v3.oas.annotations.media.Schema(
              type = "string",
              description = "Exact decimal quantity, up to three fractional places")
          java.math.BigDecimal quantity) {}

  public record Decision(
      @NotNull @Min(0) Long version,
      @NotBlank @Pattern(regexp = "APPROVE|REJECT|REVISE") String decision,
      @NotBlank @Size(min = 10, max = 1000) String reason) {}

  boolean permitted(Jwt j, Permission p) {
    return j.getClaimAsStringList("permissions").contains(p.name());
  }

  Map<String, Object> row(Jwt j, UUID id) {
    Access.require(j, Permission.WORKORDER_READ);
    var o =
        r.one(
            "select * from workorder.work_orders where tenant_id=? and id=? for update",
            Access.tenant(j),
            id);
    Access.branch(j, (UUID) o.get("branch_id"));
    return o;
  }

  void editable(Jwt j, Map<String, Object> o) {
    Access.require(j, Permission.WORKORDER_UPDATE);
    if (!permitted(j, Permission.WORKORDER_ASSIGN)
        && !Access.user(j).equals(o.get("assigned_technician_id"))
        && r.db.queryForObject(
                "select count(*) from workorder.work_order_tasks where tenant_id=? and"
                    + " work_order_id=? and assigned_technician_id=? and status not in"
                    + " ('COMPLETED','CANCELLED')",
                Integer.class,
                Access.tenant(j),
                o.get("id"),
                Access.user(j))
            == 0)
      throw new ResponseStatusException(
          FORBIDDEN, "Only the assigned technician may update this job");
    if (Set.of("CLOSED", "DELIVERED", "CANCELLED").contains(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Job is no longer editable");
  }

  Map<String, Object> branch(Jwt j, UUID id) {
    Access.branch(j, id);
    var b = gateway.get(j, tenant, "/api/branches/" + id + "/operations");
    if (!"ACTIVE".equals(b.get("status")))
      throw new ResponseStatusException(CONFLICT, "Branch is inactive");
    return b;
  }

  void eligibility(Jwt j, UUID user, UUID branch, String kind) {
    gateway.get(
        j, tenant, "/api/staff/" + user + "/eligibility?branchId=" + branch + "&kind=" + kind);
  }

  Map<String, Object> vehicle(Jwt j, UUID vehicle, UUID owner) {
    var v = gateway.get(j, customer, "/api/vehicles/" + vehicle);
    if (!"ACTIVE".equals(v.get("status")))
      throw new ResponseStatusException(CONFLICT, "Vehicle is inactive");
    if (owner != null) {
      if (!owner.toString().equals(Objects.toString(v.get("customerId"))))
        throw new ResponseStatusException(CONFLICT, "Current vehicle ownership required");
      var c = gateway.get(j, customer, "/api/customers/" + owner);
      if (!"ACTIVE".equals(c.get("status")))
        throw new ResponseStatusException(CONFLICT, "Customer is inactive");
    }
    return v;
  }

  void audit(Jwt j, Map<String, Object> o, String action, UUID target, String note) {
    r.db.update(
        "insert into"
            + " workorder.work_order_audit_events(id,tenant_id,branch_id,work_order_id,action,target_id,actor_id,note,correlation_id)"
            + " values(?,?,?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        o.get("branch_id"),
        o.get("id"),
        action,
        target,
        Access.user(j),
        note,
        Correlation.current());
  }

  void status(Jwt j, Map<String, Object> o, String next, String note) {
    note = note.substring(0, Math.min(1000, note.length()));
    r.db.update(
        "update workorder.work_orders set"
            + " status=?,version=version+1,updated_at=now(),check_in_at=case when ?='CHECKED_IN'"
            + " then coalesce(check_in_at,now()) else check_in_at end,work_started_at=case when"
            + " ?='IN_PROGRESS' then coalesce(work_started_at,now()) else work_started_at"
            + " end,work_completed_at=case when ?='QUALITY_CHECK' then now() else work_completed_at"
            + " end,quality_checked_at=case when ?='READY_FOR_DELIVERY' then now() else"
            + " quality_checked_at end,delivered_at=case when ?='DELIVERED' then now() else"
            + " delivered_at end where tenant_id=? and id=?",
        next,
        next,
        next,
        next,
        next,
        next,
        Access.tenant(j),
        o.get("id"));
    r.db.update(
        "insert into"
            + " workorder.work_order_status_history(id,tenant_id,branch_id,work_order_id,from_status,to_status,note,actor_id,correlation_id)"
            + " values(?,?,?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        o.get("branch_id"),
        o.get("id"),
        o.get("status"),
        next,
        note,
        Access.user(j),
        Correlation.current());
    audit(j, o, "STATUS_" + next, (UUID) o.get("id"), note);
  }

  UUID newOrder(
      Jwt j,
      UUID branch,
      UUID vehicle,
      UUID owner,
      String complaint,
      UUID appointment,
      UUID advisor,
      Map<String, Object> v) {
    long sequence =
        r.db.queryForObject(
            "insert into workorder.job_card_counters(tenant_id,branch_id,next_value) values(?,?,1)"
                + " on conflict(tenant_id,branch_id) do update set"
                + " next_value=workorder.job_card_counters.next_value+1 returning next_value",
            Long.class,
            Access.tenant(j),
            branch);
    UUID id = UUID.randomUUID();
    String number =
        "JC-"
            + branch.toString().replace("-", "").toUpperCase(Locale.ROOT)
            + "-"
            + String.format("%06d", sequence);
    r.db.update(
        "insert into"
            + " workorder.work_orders(id,tenant_id,branch_id,vehicle_id,customer_id,appointment_id,complaint,status,created_at,updated_at,job_card_number,service_advisor_id,registration,vehicle_model)"
            + " values(?,?,?,?,?,?,?,'CREATED',now(),now(),?,?,?,?)",
        id,
        Access.tenant(j),
        branch,
        vehicle,
        owner,
        appointment,
        complaint,
        number,
        advisor,
        v.get("registration"),
        v.get("make") + " " + v.get("model"));
    var o = row(j, id);
    audit(j, o, "CREATED", id, "Job card created");
    return id;
  }

  @PostMapping("/work-orders")
  @ResponseStatus(CREATED)
  public Map<String, Object> create(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Create in) {
    Access.require(j, Permission.WORKORDER_CREATE);
    Access.branch(j, in.branchId());
    UUID replay = r.replay("workorder", Access.tenant(j), Access.user(j), key, "CREATE_JOB", in);
    if (replay != null) return detail(j, replay);
    branch(j, in.branchId());
    var v = vehicle(j, in.vehicleId(), in.customerId());
    UUID owner =
        in.customerId() == null && v.get("customerId") != null
            ? Records.uuid(v.get("customerId"))
            : in.customerId();
    UUID id =
        newOrder(j, in.branchId(), in.vehicleId(), owner, in.complaint(), null, Access.user(j), v);
    r.remember("workorder", Access.tenant(j), Access.user(j), key, "CREATE_JOB", in, id);
    return detail(j, id);
  }

  @PostMapping("/check-ins")
  @ResponseStatus(CREATED)
  public Map<String, Object> intake(
      @AuthenticationPrincipal Jwt j,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Intake in) {
    Access.require(j, Permission.WORKORDER_CREATE);
    Access.require(j, Permission.VEHICLE_WRITE);
    Access.branch(j, in.branchId());
    UUID t = Access.tenant(j);
    UUID replay = r.replay("workorder", t, Access.user(j), key, "CHECK_IN", in);
    if (replay != null) return checkIn(j, replay);
    UUID intakeId =
        UUID.nameUUIDFromBytes(
            (t
                    + ":"
                    + (in.appointmentId() == null
                        ? Access.user(j) + ":" + key
                        : in.appointmentId()))
                .getBytes(StandardCharsets.UTF_8));
    r.lock("intake" + intakeId);
    var existing =
        r.db.queryForList(
            "select id,request_hash from workorder.vehicle_check_ins where tenant_id=? and id=?",
            t,
            intakeId);
    String hash =
        org.springframework.util.DigestUtils.md5DigestAsHex(
            Records.json(in).getBytes(StandardCharsets.UTF_8));
    if (!existing.isEmpty()) {
      if (!hash.equals(existing.getFirst().get("request_hash")))
        throw new ResponseStatusException(CONFLICT, "Intake retry contains different details");
      return checkIn(j, intakeId);
    }
    branch(j, in.branchId());
    var v = vehicle(j, in.vehicleId(), in.customerId());
    UUID advisor = in.serviceAdvisorId() == null ? Access.user(j) : in.serviceAdvisorId();
    eligibility(j, advisor, in.branchId(), "ADVISOR");
    if (in.appointmentId() != null) {
      var a = gateway.get(j, booking, "/api/appointments/" + in.appointmentId());
      for (String f : List.of("branchId", "vehicleId", "customerId")) {
        Object expected =
            f.equals("branchId")
                ? in.branchId()
                : f.equals("vehicleId") ? in.vehicleId() : in.customerId();
        if (!expected.toString().equals(Objects.toString(a.get(f))))
          throw new ResponseStatusException(CONFLICT, "Appointment identity mismatch");
      }
      if (!"CONFIRMED".equals(a.get("appointmentStatus")))
        throw new ResponseStatusException(CONFLICT, "Appointment must be confirmed");
    }
    gateway.post(
        j,
        customer,
        "/api/vehicles/" + in.vehicleId() + "/odometer",
        Map.of(
            "kilometers",
            in.odometerKilometers(),
            "branchId",
            in.branchId(),
            "note",
            "Workshop check-in",
            "externalReference",
            intakeId),
        key);
    UUID id =
        newOrder(
            j,
            in.branchId(),
            in.vehicleId(),
            in.customerId(),
            in.complaints(),
            in.appointmentId(),
            advisor,
            v);
    r.db.update(
        "insert into"
            + " workorder.vehicle_check_ins(id,tenant_id,branch_id,work_order_id,customer_id,vehicle_id,appointment_id,odometer_kilometers,complaints,service_requested,damage_observations,fuel_level,accessories,check_in_at,service_advisor_id,created_by,request_hash)"
            + " values(?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,now(),?,?,?)",
        intakeId,
        t,
        in.branchId(),
        id,
        in.customerId(),
        in.vehicleId(),
        in.appointmentId(),
        in.odometerKilometers(),
        in.complaints(),
        in.serviceRequested(),
        in.damageObservations(),
        in.fuelLevel(),
        Records.json(in.accessories() == null ? List.of() : in.accessories()),
        advisor,
        Access.user(j),
        hash);
    status(j, row(j, id), "CHECKED_IN", "Vehicle intake recorded");
    r.remember("workorder", t, Access.user(j), key, "CHECK_IN", in, intakeId);
    return checkIn(j, intakeId);
  }

  @GetMapping("/check-ins/{id}")
  public Map<String, Object> checkIn(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.WORKORDER_READ);
    var c =
        r.one(
            "select * from workorder.vehicle_check_ins where tenant_id=? and id=?",
            Access.tenant(j),
            id);
    row(j, (UUID) c.get("work_order_id"));
    c.remove("request_hash");
    if (!permitted(j, Permission.CUSTOMER_READ)) c.remove("customer_id");
    return Records.dto(c);
  }

  @GetMapping("/work-orders/{id}")
  public Map<String, Object> detail(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    var o = row(j, id);
    var out = Records.dto(o);
    out.put("tasks", children(j, id, "work_order_tasks"));
    out.put("notes", children(j, id, "job_notes"));
    out.put("parts", children(j, id, "required_parts"));
    out.put("statusHistory", children(j, id, "work_order_status_history"));
    out.put("assignments", children(j, id, "technician_assignments"));
    out.put("qualityChecks", children(j, id, "quality_checks"));
    out.put("inspections", children(j, id, "inspections"));
    out.put(
        "photos",
        r
            .db
            .queryForList(
                "select id,label,file_name,content_type,byte_size,status,version from"
                    + " workorder.workshop_photos where tenant_id=? and work_order_id=? order by"
                    + " created_at,id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    if (!permitted(j, Permission.CUSTOMER_READ)) out.remove("customerId");
    out.put("developmentApprovalAvailable", developmentAllowed(j));
    return out;
  }

  List<Map<String, Object>> children(Jwt j, UUID id, String table) {
    if (!Set.of(
            "work_order_tasks",
            "job_notes",
            "required_parts",
            "work_order_status_history",
            "technician_assignments",
            "quality_checks",
            "inspections",
            "work_order_audit_events")
        .contains(table)) throw new IllegalArgumentException();
    return r
        .db
        .queryForList(
            "select * from workorder."
                + table
                + " where tenant_id=? and work_order_id=? order by created_at,id",
            Access.tenant(j),
            id)
        .stream()
        .map(Records::dto)
        .toList();
  }

  @GetMapping("/work-orders/{id}/audit")
  public List<Map<String, Object>> audits(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    row(j, id);
    return children(j, id, "work_order_audit_events");
  }

  @GetMapping({"/work-orders", "/work-orders/board"})
  public Map<String, Object> list(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(required = false) UUID branchId,
      @RequestParam(defaultValue = "false") boolean allBranches,
      @RequestParam(defaultValue = "") String status,
      @RequestParam(defaultValue = "") String priority,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(required = false) UUID technicianId,
      @RequestParam(defaultValue = "false") boolean mine,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    Access.require(j, Permission.WORKORDER_READ);
    Records.page(page, size);
    List<String> branches;
    if (allBranches) {
      Access.require(j, Permission.ANALYTICS_BRAND_READ);
      branches = j.getClaimAsStringList("branches");
    } else {
      if (branchId == null) throw new ResponseStatusException(BAD_REQUEST, "Select a branch");
      Access.branch(j, branchId);
      branches = List.of(branchId.toString());
    }
    if (branches.isEmpty()) return Records.page(List.of(), 0, size);
    String scope =
        "branch_id in (" + String.join(",", Collections.nCopies(branches.size(), "?::uuid")) + ")";
    String where =
        " from workorder.work_orders where tenant_id=? and "
            + scope
            + " and (?='' or status=?) and (?='' or priority=?) and"
            + " lower(coalesce(registration,'')||' '||complaint||' '||job_card_number) like ? and"
            + " (?::uuid is null or assigned_technician_id=?::uuid or exists(select 1 from"
            + " workorder.work_order_tasks assigned where assigned.tenant_id=work_orders.tenant_id"
            + " and assigned.work_order_id=work_orders.id and"
            + " assigned.assigned_technician_id=?::uuid))";
    var args = new ArrayList<Object>();
    args.add(Access.tenant(j));
    args.addAll(branches);
    UUID tech = mine ? Access.user(j) : technicianId;
    args.addAll(
        Arrays.asList(
            status,
            status,
            priority,
            priority,
            "%" + q.toLowerCase(Locale.ROOT) + "%",
            tech,
            tech,
            tech));
    long count = r.db.queryForObject("select count(*)" + where, Long.class, args.toArray());
    var countArgs = new ArrayList<Object>(args);
    args.add(size);
    args.add((long) page * size);
    var values =
        r.db.queryForList(
            "select *" + where + " order by created_at desc,id limit ? offset ?", args.toArray());
    if (!permitted(j, Permission.CUSTOMER_READ)) values.forEach(m -> m.remove("customer_id"));
    var out = new LinkedHashMap<>(Records.page(values, count, size));
    out.put(
        "statusCounts",
        r.db.queryForList(
            "select status,count(*) as count" + where + " group by status", countArgs.toArray()));
    return out;
  }

  @PatchMapping("/work-orders/{id}")
  public Map<String, Object> edit(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Edit in) {
    var o = row(j, id);
    editable(j, o);
    Records.version(o, in.version());
    if (!permitted(j, Permission.WORKORDER_ASSIGN))
      throw new ResponseStatusException(
          FORBIDDEN, "Advisor permission required to edit intake details");
    r.db.update(
        "update workorder.work_orders set"
            + " complaint=?,priority=coalesce(?,priority),estimated_completion_at=?,version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        in.complaint(),
        in.priority(),
        in.estimatedCompletionAt() == null ? null : Timestamp.from(in.estimatedCompletionAt()),
        Access.tenant(j),
        id);
    audit(j, o, "DETAILS_UPDATED", id, "Job details updated");
    return detail(j, id);
  }

  @RequestMapping(
      value = {"/work-orders/{id}/transition", "/work-orders/{id}/status"},
      method = {RequestMethod.POST, RequestMethod.PATCH})
  public Map<String, Object> transition(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Change in) {
    var o = row(j, id);
    if ("DELIVERED".equals(o.get("status")) && in.status() == Status.CLOSED) {
      Access.require(j, Permission.WORKORDER_UPDATE);
      Access.require(j, Permission.WORKORDER_ASSIGN);
    } else editable(j, o);
    Records.version(o, in.version());
    Status from = Status.valueOf(o.get("status").toString());
    if (!from.canMoveTo(in.status()))
      throw new ResponseStatusException(CONFLICT, "Invalid work-order transition");
    if (Set.of(Status.APPROVED, Status.QUALITY_CHECK, Status.READY_FOR_DELIVERY)
            .contains(in.status())
        || from == Status.QUALITY_CHECK)
      throw new ResponseStatusException(CONFLICT, "Use the approval or quality-review workflow");
    if (in.status() == Status.ESTIMATE_PENDING) requireInspection(j, id);
    if (in.status() == Status.IN_PROGRESS) {
      if (o.get("commercial_estimate_id") != null) requireCommercial(j, o, null);
      else if (o.get("development_approval_id") == null || !developmentAllowed(j))
        throw new ResponseStatusException(
            CONFLICT, "A verified customer approval contract is required");
    }
    if (in.status() == Status.DELIVERED && o.get("commercial_estimate_id") != null) {
      var authority = gateway.get(j, billingUrl, "/api/internal/commercial/work-orders/" + id);
      if (!Boolean.TRUE.equals(authority.get("deliveryReady")))
        throw new ResponseStatusException(
            CONFLICT, "Financial readiness changed; refresh invoice and payment status");
    }
    if (Set.of(Status.DELIVERED, Status.CLOSED, Status.CANCELLED).contains(in.status()))
      Access.require(j, Permission.WORKORDER_ASSIGN);
    if (in.status() == Status.ESTIMATE_PENDING)
      r.db.update(
          "update workorder.work_orders set development_approval_id=null where tenant_id=? and"
              + " id=?",
          Access.tenant(j),
          id);
    if (in.status() == Status.CANCELLED) {
      var open =
          r.db.queryForList(
              "select id from workorder.work_order_tasks where tenant_id=? and work_order_id=? and"
                  + " status not in ('COMPLETED','CANCELLED')",
              Access.tenant(j),
              id);
      for (var task : open) {
        r.db.update(
            "update workorder.work_order_tasks set"
                + " status='CANCELLED',updated_at=now(),version=version+1 where tenant_id=? and"
                + " id=?",
            Access.tenant(j),
            task.get("id"));
        r.db.update(
            "insert into"
                + " workorder.task_history(id,tenant_id,task_id,action,note,actor_id,correlation_id)"
                + " values(?,?,?,'CANCELLED',?,?,?)",
            UUID.randomUUID(),
            Access.tenant(j),
            task.get("id"),
            in.note(),
            Access.user(j),
            Correlation.current());
      }
    }
    status(j, o, in.status().name(), in.note());
    return detail(j, id);
  }

  void requireInspection(Jwt j, UUID id) {
    if (r.db.queryForObject(
            "select count(*) from workorder.inspections where tenant_id=? and work_order_id=? and"
                + " status='COMPLETED'",
            Integer.class,
            Access.tenant(j),
            id)
        == 0)
      throw new ResponseStatusException(CONFLICT, "Complete and review the inspection first");
  }

  boolean developmentAllowed(Jwt j) {
    return development
        && Arrays.asList(environment.getActiveProfiles()).contains("local")
        && j.getIssuer() != null
        && "http://127.0.0.1:8180/realms/motoros".equals(j.getIssuer().toString());
  }

  @PostMapping("/work-orders/{id}/development-approval")
  public Map<String, Object> approveDevelopment(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Decision in) {
    Access.require(j, Permission.WORKORDER_DEV_APPROVAL);
    if (!developmentAllowed(j))
      throw new ResponseStatusException(
          FORBIDDEN, "Development approval is disabled for this identity or environment");
    var o = row(j, id);
    Records.version(o, in.version());
    if (!"AWAITING_APPROVAL".equals(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Job is not awaiting estimate approval");
    UUID decision = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " workorder.development_approvals(id,tenant_id,work_order_id,decision,reason,approved_by)"
            + " values(?,?,?,?,?,?)",
        decision,
        Access.tenant(j),
        id,
        in.decision(),
        in.reason(),
        Access.user(j));
    boolean approved = "APPROVE".equals(in.decision());
    r.db.update(
        "update workorder.work_orders set development_approval_id=? where tenant_id=? and id=?",
        approved ? decision : null,
        Access.tenant(j),
        id);
    status(
        j,
        o,
        approved ? "APPROVED" : "ESTIMATE_PENDING",
        "DEVELOPMENT_SIMULATION: " + in.decision() + " — " + in.reason());
    return detail(j, id);
  }

  @PostMapping("/work-orders/{id}/assign")
  public Map<String, Object> assign(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Assign in) {
    Access.require(j, Permission.WORKORDER_ASSIGN);
    var o = row(j, id);
    editable(j, o);
    Records.version(o, in.version());
    eligibility(j, in.technicianId(), (UUID) o.get("branch_id"), "TECHNICIAN");
    r.db.update(
        "update workorder.work_orders set"
            + " assigned_technician_id=?,version=version+1,updated_at=now() where tenant_id=? and"
            + " id=?",
        in.technicianId(),
        Access.tenant(j),
        id);
    assignment(j, o, null, (UUID) o.get("assigned_technician_id"), in.technicianId(), in.reason());
    return detail(j, id);
  }

  void assignment(Jwt j, Map<String, Object> o, UUID task, UUID old, UUID tech, String note) {
    r.db.update(
        "insert into"
            + " workorder.technician_assignments(id,tenant_id,branch_id,work_order_id,task_id,previous_technician_id,technician_id,assigned_by,reason)"
            + " values(?,?,?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        o.get("branch_id"),
        o.get("id"),
        task,
        old,
        tech,
        Access.user(j),
        note);
    audit(j, o, "TECHNICIAN_ASSIGNED", task == null ? (UUID) o.get("id") : task, note);
  }

  @PostMapping("/work-orders/{id}/tasks")
  public Map<String, Object> addTask(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Task in) {
    var o = row(j, id);
    editable(j, o);
    Access.require(j, Permission.WORKORDER_ASSIGN);
    if (Set.of("QUALITY_CHECK", "READY_FOR_DELIVERY").contains(o.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "Return the job for rework before adding repair tasks");
    UUID replay = r.replay("workorder", Access.tenant(j), Access.user(j), key, "TASK_" + id, in);
    if (replay != null)
      return Records.dto(
          r.one(
              "select * from workorder.work_order_tasks where tenant_id=? and id=?",
              Access.tenant(j),
              replay));
    UUID tech =
        in.assignedTechnicianId() == null
            ? (UUID) o.get("assigned_technician_id")
            : in.assignedTechnicianId();
    if (tech != null) eligibility(j, tech, (UUID) o.get("branch_id"), "TECHNICIAN");
    UUID task = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " workorder.work_order_tasks(id,tenant_id,branch_id,work_order_id,task_description,task_category,priority,status,assigned_technician_id,estimated_duration_minutes)"
            + " values(?,?,?,?,?,?,?,'TODO',?,?)",
        task,
        Access.tenant(j),
        o.get("branch_id"),
        id,
        in.taskDescription(),
        in.taskCategory(),
        in.priority(),
        tech,
        in.estimatedDurationMinutes());
    audit(j, o, "TASK_CREATED", task, in.taskDescription());
    r.remember("workorder", Access.tenant(j), Access.user(j), key, "TASK_" + id, in, task);
    return Records.dto(
        r.one(
            "select * from workorder.work_order_tasks where tenant_id=? and id=?",
            Access.tenant(j),
            task));
  }

  @RequestMapping(
      value = {
        "/work-orders/{id}/tasks/{taskId}",
        "/work-orders/{id}/tasks/{taskId}/{action:start|complete}"
      },
      method = {RequestMethod.PATCH, RequestMethod.POST})
  public Map<String, Object> task(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable UUID taskId,
      @PathVariable(required = false) String action,
      @Valid @RequestBody TaskChange in) {
    var o = row(j, id);
    editable(j, o);
    var task =
        r.one(
            "select * from workorder.work_order_tasks where tenant_id=? and work_order_id=? and"
                + " id=? for update",
            Access.tenant(j),
            id,
            taskId);
    Records.version(task, in.version());
    if (!permitted(j, Permission.WORKORDER_ASSIGN)
        && !Access.user(j).equals(task.get("assigned_technician_id")))
      throw new ResponseStatusException(
          FORBIDDEN, "Only the assigned technician may update this task");
    String next =
        action == null ? in.status() : action.equals("start") ? "IN_PROGRESS" : "COMPLETED";
    String previous = task.get("status").toString();
    if (!previous.equals(next)
        && !switch (previous) {
          case "TODO" -> Set.of("IN_PROGRESS", "BLOCKED", "CANCELLED").contains(next);
          case "IN_PROGRESS" -> Set.of("BLOCKED", "COMPLETED", "CANCELLED").contains(next);
          case "BLOCKED" -> Set.of("TODO", "IN_PROGRESS", "CANCELLED").contains(next);
          default -> false;
        }) throw new ResponseStatusException(CONFLICT, "Invalid task transition");
    if (Set.of("IN_PROGRESS", "COMPLETED").contains(next)
        && o.get("commercial_estimate_id") != null) requireCommercial(j, o, taskId);
    if (Set.of("IN_PROGRESS", "COMPLETED").contains(next) && !"IN_PROGRESS".equals(o.get("status")))
      throw new ResponseStatusException(
          CONFLICT, "Repair tasks require an approved in-progress job");
    if ((in.priority() != null && !in.priority().equals(task.get("priority")))
        || (in.assignedTechnicianId() != null
            && !in.assignedTechnicianId().equals(task.get("assigned_technician_id"))))
      Access.require(j, Permission.WORKORDER_ASSIGN);
    UUID tech =
        in.assignedTechnicianId() == null
            ? (UUID) task.get("assigned_technician_id")
            : in.assignedTechnicianId();
    if (tech != null) eligibility(j, tech, (UUID) o.get("branch_id"), "TECHNICIAN");
    if (!Objects.equals(tech, task.get("assigned_technician_id")))
      assignment(j, o, taskId, (UUID) task.get("assigned_technician_id"), tech, in.note());
    if (o.get("commercial_estimate_id") != null
        && Set.of("IN_PROGRESS", "COMPLETED").contains(next))
      r.db.update(
          "update workorder.work_order_tasks set approved_estimate_id=? where tenant_id=? and id=?",
          o.get("commercial_estimate_id"),
          Access.tenant(j),
          taskId);
    r.db.update(
        "update workorder.work_order_tasks set"
            + " status=?,priority=coalesce(?,priority),assigned_technician_id=?,started_at=case"
            + " when ?='IN_PROGRESS' then coalesce(started_at,now()) else started_at"
            + " end,completed_at=case when ?='COMPLETED' then now() else completed_at"
            + " end,actual_duration_minutes=case when ?='COMPLETED' then greatest(0,extract(epoch"
            + " from (now()-started_at))/60)::integer else actual_duration_minutes"
            + " end,version=version+1,updated_at=now() where tenant_id=? and id=?",
        next,
        in.priority(),
        tech,
        next,
        next,
        next,
        Access.tenant(j),
        taskId);
    r.db.update(
        "insert into"
            + " workorder.task_history(id,tenant_id,task_id,action,note,actor_id,correlation_id)"
            + " values(?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        taskId,
        next,
        in.note(),
        Access.user(j),
        Correlation.current());
    audit(j, o, "TASK_" + next, taskId, in.note());
    return detail(j, id);
  }

  @PostMapping("/work-orders/{id}/notes")
  public Map<String, Object> note(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Note in) {
    var o = row(j, id);
    editable(j, o);
    UUID note = UUID.randomUUID();
    r.db.update(
        "insert into workorder.job_notes(id,tenant_id,work_order_id,actor_id,kind,note)"
            + " values(?,?,?,?,?,?)",
        note,
        Access.tenant(j),
        id,
        Access.user(j),
        in.kind(),
        in.note());
    audit(j, o, "NOTE_ADDED", note, in.kind());
    return detail(j, id);
  }

  @PostMapping("/work-orders/{id}/parts")
  public Map<String, Object> part(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Part in) {
    var o = row(j, id);
    Access.require(j, Permission.WORKORDER_UPDATE);
    var previous =
        r.replay("workorder", Access.tenant(j), Access.user(j), key, "PART_REQUEST" + id, in);
    if (previous != null) return detail(j, id);
    editable(j, o);
    UUID part = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " workorder.required_parts(id,tenant_id,work_order_id,description,quantity,status,requested_by)"
            + " values(?,?,?,?,?,'REQUESTED',?)",
        part,
        Access.tenant(j),
        id,
        in.description(),
        in.quantity(),
        Access.user(j));
    audit(j, o, "PART_REQUESTED", part, in.description());
    r.remember("workorder", Access.tenant(j), Access.user(j), key, "PART_REQUEST" + id, in, part);
    return detail(j, id);
  }

  @GetMapping("/technicians/workload")
  public List<Map<String, Object>> workload(
      @AuthenticationPrincipal Jwt j, @RequestParam UUID branchId) {
    Access.require(j, Permission.WORKORDER_READ);
    Access.branch(j, branchId);
    var staff = gateway.list(j, tenant, "/api/branches/" + branchId + "/technicians");
    return staff.stream()
        .filter(m -> Boolean.TRUE.equals(m.get("technician")))
        .map(
            m -> {
              UUID tech = Records.uuid(m.get("userId"));
              var out = new LinkedHashMap<>(m);
              out.put(
                  "tasks",
                  r
                      .db
                      .queryForList(
                          "select t.*,o.job_card_number,o.registration from"
                              + " workorder.work_order_tasks t join workorder.work_orders o on"
                              + " o.tenant_id=t.tenant_id and o.id=t.work_order_id where"
                              + " t.tenant_id=? and t.branch_id=? and t.assigned_technician_id=?"
                              + " order by (t.status in ('COMPLETED','CANCELLED')),t.updated_at"
                              + " desc,t.id limit 200",
                          Access.tenant(j),
                          branchId,
                          tech)
                      .stream()
                      .map(Records::dto)
                      .toList());
              out.put(
                  "taskStatusCounts",
                  r.db.queryForList(
                      "select status,count(*) as count from workorder.work_order_tasks where"
                          + " tenant_id=? and branch_id=? and assigned_technician_id=? group by"
                          + " status",
                      Access.tenant(j),
                      branchId,
                      tech));
              out.put(
                  "activeJobs",
                  r.db.queryForObject(
                      "select count(*) from workorder.work_orders where tenant_id=? and branch_id=?"
                          + " and assigned_technician_id=? and status not in"
                          + " ('DELIVERED','CLOSED','CANCELLED')",
                      Long.class,
                      Access.tenant(j),
                      branchId,
                      tech));
              out.put(
                  "estimatedRemainingMinutes",
                  r.db.queryForObject(
                      "select"
                          + " coalesce(sum(greatest(estimated_duration_minutes-coalesce(actual_duration_minutes,0),0)),0)"
                          + " from workorder.work_order_tasks where tenant_id=? and branch_id=? and"
                          + " assigned_technician_id=? and status not in ('COMPLETED','CANCELLED')",
                      Long.class,
                      Access.tenant(j),
                      branchId,
                      tech));
              return (Map<String, Object>) out;
            })
        .toList();
  }

  public record PartChange(
      @NotNull @Min(0) Long version,
      @NotBlank @Pattern(regexp = "RECEIVED|USED|CANCELLED") String status,
      @NotBlank @Size(max = 1000) String note) {}

  @PatchMapping("/work-orders/{id}/parts/{partId}")
  public Map<String, Object> partStatus(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable UUID partId,
      @Valid @RequestBody PartChange in) {
    var o = row(j, id);
    editable(j, o);
    if (o.get("commercial_estimate_id") != null && !in.status().equals("CANCELLED"))
      throw new ResponseStatusException(
          CONFLICT, "Use verified installed-stock fulfillment for a commercial job");
    var part =
        r.one(
            "select * from workorder.required_parts where tenant_id=? and work_order_id=? and id=?"
                + " for update",
            Access.tenant(j),
            id,
            partId);
    Records.version(part, in.version());
    String previous = part.get("status").toString();
    if (!switch (previous) {
      case "REQUESTED" -> Set.of("RECEIVED", "CANCELLED").contains(in.status());
      case "RECEIVED" -> Set.of("USED", "CANCELLED").contains(in.status());
      default -> false;
    }) throw new ResponseStatusException(CONFLICT, "Invalid part request transition");
    if (in.status().equals("USED")) {
      if (!"IN_PROGRESS".equals(o.get("status")))
        throw new ResponseStatusException(
            CONFLICT, "Parts can be recorded used only during approved repairs");
    } else Access.require(j, Permission.WORKORDER_ASSIGN);
    r.db.update(
        "update workorder.required_parts set status=?,version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        in.status(),
        Access.tenant(j),
        partId);
    audit(j, o, "PART_" + in.status(), partId, in.note());
    return detail(j, id);
  }

  void requireCommercial(Jwt j, Map<String, Object> o, UUID task) {
    var authority =
        gateway.get(j, billingUrl, "/api/internal/commercial/work-orders/" + o.get("id"));
    if (!Boolean.TRUE.equals(authority.get("approvalValid"))
        || !o.get("commercial_estimate_id")
            .toString()
            .equals(Objects.toString(authority.get("estimateId"), "")))
      throw new ResponseStatusException(
          CONFLICT, "Current customer approval must be verified before repair work");
    if (task != null) {
      var scope = (List<Map<String, Object>>) authority.get("scope");
      if ((scope == null
              || scope.stream().noneMatch(x -> task.toString().equals(x.get("id").toString())))
          && r.db.queryForObject(
                  "select count(*) from workorder.work_order_tasks t join workorder.quality_checks"
                      + " q on q.tenant_id=t.tenant_id and q.id=t.origin_quality_check_id where"
                      + " t.tenant_id=? and t.work_order_id=? and t.id=? and q.status='FAILED'",
                  Integer.class,
                  Access.tenant(j),
                  o.get("id"),
                  task)
              == 0)
        throw new ResponseStatusException(
            CONFLICT, "Additional repair task requires a revised customer approval");
    }
  }
}
