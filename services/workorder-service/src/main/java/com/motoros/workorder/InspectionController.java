package com.motoros.workorder;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import jakarta.validation.*;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
@Transactional
public class InspectionController {
  private final Records r;
  private final WorkshopController jobs;

  InspectionController(JdbcTemplate db, WorkshopController jobs) {
    r = new Records(db);
    this.jobs = jobs;
  }

  public record Start(@NotNull UUID templateId) {}

  public record Finding(
      @NotNull UUID itemId,
      @NotBlank @Pattern(regexp = "GOOD|ATTENTION_REQUIRED|NOT_INSPECTED|NOT_APPLICABLE")
          String condition,
      @Size(max = 2000) String technicianNotes,
      @NotBlank @Pattern(regexp = "LOW|MEDIUM|HIGH") String severity,
      @Size(max = 12) List<UUID> photoReferences) {}

  public record Save(
      @NotNull @Min(0) Long version, @NotEmpty @Size(max = 100) List<@Valid Finding> findings) {}

  public record Complete(@NotNull @Min(0) Long version, @Size(max = 1000) String reviewNotes) {}

  public record Quality(@NotNull UUID reviewerId, @NotNull @Min(0) Long version) {}

  public record QualityDecision(
      @NotNull @Min(0) Long version,
      @NotEmpty @Size(max = 20) Map<@Size(max = 80) String, Boolean> checklist,
      @NotBlank @Size(min = 10, max = 2000) String notes) {}

  public record Template(
      @NotBlank @Size(max = 120) String name,
      @NotEmpty @Size(max = 100) List<@Valid TemplateItem> items) {}

  public record TemplateItem(
      @NotBlank @Size(max = 80) String category,
      @NotBlank @Size(max = 300) String item,
      boolean safetyRelated) {}

  @GetMapping("/inspection-templates")
  public List<Map<String, Object>> templates(@AuthenticationPrincipal Jwt j) {
    Access.require(j, Permission.WORKORDER_READ);
    return r
        .db
        .queryForList(
            "select * from workorder.inspection_templates where tenant_id is null or tenant_id=?"
                + " order by name,id",
            Access.tenant(j))
        .stream()
        .map(
            m -> {
              var out = Records.dto(m);
              out.put(
                  "items",
                  r
                      .db
                      .queryForList(
                          "select * from workorder.inspection_items where template_id=? order by"
                              + " sort_order,id",
                          m.get("id"))
                      .stream()
                      .map(Records::dto)
                      .toList());
              return out;
            })
        .toList();
  }

  @PostMapping("/inspection-templates")
  public Map<String, Object> template(
      @AuthenticationPrincipal Jwt j, @Valid @RequestBody Template in) {
    Access.require(j, Permission.WORKORDER_ASSIGN);
    UUID id = UUID.randomUUID();
    r.db.update(
        "insert into workorder.inspection_templates(id,tenant_id,name) values(?,?,?)",
        id,
        Access.tenant(j),
        in.name());
    int n = 0;
    for (var item : in.items())
      r.db.update(
          "insert into"
              + " workorder.inspection_items(id,template_id,category,item,safety_related,sort_order)"
              + " values(?,?,?,?,?,?)",
          UUID.randomUUID(),
          id,
          item.category(),
          item.item(),
          item.safetyRelated(),
          n++);
    return Map.of("id", id);
  }

  @PostMapping("/work-orders/{id}/inspections")
  public Map<String, Object> start(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Start in) {
    Access.require(j, Permission.WORKORDER_INSPECT);
    var o = jobs.row(j, id);
    jobs.editable(j, o);
    if (!"INSPECTION".equals(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Job must be in inspection");
    UUID replay =
        r.replay("workorder", Access.tenant(j), Access.user(j), key, "INSPECTION_" + id, in);
    if (replay != null) return inspection(j, replay);
    r.one(
        "select id from workorder.inspection_templates where id=? and (tenant_id is null or"
            + " tenant_id=?)",
        in.templateId(),
        Access.tenant(j));
    if (r.db.queryForObject(
            "select count(*) from workorder.inspections where tenant_id=? and work_order_id=? and"
                + " status!='COMPLETED'",
            Integer.class,
            Access.tenant(j),
            id)
        > 0) throw new ResponseStatusException(CONFLICT, "Finish the existing inspection first");
    UUID inspection = UUID.randomUUID();
    var items =
        r.db.queryForList(
            "select * from workorder.inspection_items where template_id=? order by sort_order,id",
            in.templateId());
    r.db.update(
        "insert into"
            + " workorder.inspections(id,tenant_id,branch_id,work_order_id,template_id,template_snapshot,status,inspected_by)"
            + " values(?,?,?,?,?,?::jsonb,'DRAFT',?)",
        inspection,
        Access.tenant(j),
        o.get("branch_id"),
        id,
        in.templateId(),
        Records.json(items.stream().map(Records::dto).toList()),
        Access.user(j));
    for (var item : items)
      r.db.update(
          "insert into"
              + " workorder.inspection_findings(id,tenant_id,inspection_id,work_order_id,item_id,category,inspection_item,condition,severity,safety_related)"
              + " values(?,?,?,?,?,?,?,'NOT_INSPECTED','LOW',?)",
          UUID.randomUUID(),
          Access.tenant(j),
          inspection,
          id,
          item.get("id"),
          item.get("category"),
          item.get("item"),
          item.get("safety_related"));
    jobs.audit(j, o, "INSPECTION_STARTED", inspection, "Checklist snapshot created");
    r.remember(
        "workorder", Access.tenant(j), Access.user(j), key, "INSPECTION_" + id, in, inspection);
    return inspection(j, inspection);
  }

  @GetMapping("/work-orders/{id}/inspections")
  public List<Map<String, Object>> list(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    jobs.row(j, id);
    return r
        .db
        .queryForList(
            "select id from workorder.inspections where tenant_id=? and work_order_id=? order by"
                + " created_at,id",
            Access.tenant(j),
            id)
        .stream()
        .map(m -> inspection(j, (UUID) m.get("id")))
        .toList();
  }

  @GetMapping("/inspections/{id}")
  public Map<String, Object> inspection(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    var i =
        r.one(
            "select * from workorder.inspections where tenant_id=? and id=?", Access.tenant(j), id);
    jobs.row(j, (UUID) i.get("work_order_id"));
    var out = Records.dto(i);
    out.put(
        "findings",
        r
            .db
            .queryForList(
                "select * from workorder.inspection_findings where tenant_id=? and inspection_id=?"
                    + " order by category,item_id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    return out;
  }

  @PatchMapping("/inspections/{id}")
  public Map<String, Object> save(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Save in) {
    Access.require(j, Permission.WORKORDER_INSPECT);
    var i =
        r.one(
            "select * from workorder.inspections where tenant_id=? and id=?", Access.tenant(j), id);
    var o = jobs.row(j, (UUID) i.get("work_order_id"));
    jobs.editable(j, o);
    Records.version(i, in.version());
    if (!"DRAFT".equals(i.get("status")) || !"INSPECTION".equals(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Inspection is locked for review");
    Set<UUID> seen = new HashSet<>();
    for (var f : in.findings()) {
      if (!seen.add(f.itemId()))
        throw new ResponseStatusException(BAD_REQUEST, "Duplicate inspection item");
      var item =
          r.one(
              "select id from workorder.inspection_findings where tenant_id=? and inspection_id=?"
                  + " and item_id=?",
              Access.tenant(j),
              id,
              f.itemId());
      var photos = f.photoReferences() == null ? List.<UUID>of() : f.photoReferences();
      for (UUID photo : photos)
        r.one(
            "select id from workorder.workshop_photos where tenant_id=? and work_order_id=? and"
                + " id=? and status='AVAILABLE'",
            Access.tenant(j),
            o.get("id"),
            photo);
      String notes = f.technicianNotes() == null ? "" : f.technicianNotes();
      if (Set.of("ATTENTION_REQUIRED", "NOT_APPLICABLE").contains(f.condition()) && notes.isBlank())
        throw new ResponseStatusException(BAD_REQUEST, "Findings and excluded items require notes");
      r.db.update(
          "update workorder.inspection_findings set"
              + " condition=?,technician_notes=?,severity=?,requires_attention=?,photo_references=?::jsonb,inspected_by=?,inspected_at=now()"
              + " where tenant_id=? and id=?",
          f.condition(),
          notes,
          f.severity(),
          f.condition().equals("ATTENTION_REQUIRED"),
          Records.json(photos),
          Access.user(j),
          Access.tenant(j),
          item.get("id"));
    }
    r.db.update(
        "update workorder.inspections set version=version+1,updated_at=now() where tenant_id=? and"
            + " id=?",
        Access.tenant(j),
        id);
    jobs.audit(j, o, "INSPECTION_FINDINGS_SAVED", id, "Inspection observations updated");
    return inspection(j, id);
  }

  @PostMapping("/inspections/{id}/complete")
  public Map<String, Object> complete(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Complete in) {
    Access.require(j, Permission.WORKORDER_INSPECT);
    var i =
        r.one(
            "select * from workorder.inspections where tenant_id=? and id=?", Access.tenant(j), id);
    var o = jobs.row(j, (UUID) i.get("work_order_id"));
    Records.version(i, in.version());
    if (!"INSPECTION".equals(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Job is not in inspection");
    if ("COMPLETED".equals(i.get("status")))
      throw new ResponseStatusException(CONFLICT, "Inspection already completed");
    if (r.db.queryForObject(
            "select count(*) from workorder.inspection_findings where tenant_id=? and"
                + " inspection_id=? and condition='NOT_INSPECTED'",
            Integer.class,
            Access.tenant(j),
            id)
        > 0)
      throw new ResponseStatusException(CONFLICT, "Address every checklist item before completion");
    boolean safety =
        r.db.queryForObject(
                "select count(*) from workorder.inspection_findings where tenant_id=? and"
                    + " inspection_id=? and (severity='HIGH' or (safety_related and"
                    + " requires_attention))",
                Integer.class,
                Access.tenant(j),
                id)
            > 0;
    String next = "COMPLETED";
    UUID reviewer = null;
    if (safety) {
      if ("DRAFT".equals(i.get("status"))) {
        jobs.editable(j, o);
        next = "REVIEW_REQUIRED";
      } else {
        Access.require(j, Permission.WORKORDER_INSPECTION_REVIEW);
        if (Access.user(j).equals(i.get("inspected_by"))
            || r.db.queryForObject(
                    "select count(*) from workorder.inspection_findings where tenant_id=? and"
                        + " inspection_id=? and inspected_by=? and (severity='HIGH' or"
                        + " (safety_related and requires_attention))",
                    Integer.class,
                    Access.tenant(j),
                    id,
                    Access.user(j))
                > 0)
          throw new ResponseStatusException(FORBIDDEN, "A separate qualified reviewer is required");
        jobs.eligibility(j, Access.user(j), (UUID) o.get("branch_id"), "SAFETY_REVIEWER");
        if (in.reviewNotes() == null || in.reviewNotes().trim().length() < 10)
          throw new ResponseStatusException(BAD_REQUEST, "Review notes required");
        reviewer = Access.user(j);
      }
    } else jobs.editable(j, o);
    r.db.update(
        "update workorder.inspections set status=?,reviewed_by=?,review_notes=?,completed_at=case"
            + " when ?='COMPLETED' then now() else null end,updated_at=now(),version=version+1"
            + " where tenant_id=? and id=?",
        next,
        reviewer,
        in.reviewNotes(),
        next,
        Access.tenant(j),
        id);
    jobs.audit(
        j,
        o,
        "INSPECTION_" + next,
        id,
        safety
            ? "Qualified human review of observations; not a certified safety inspection"
            : "Checklist observations completed");
    return inspection(j, id);
  }

  void ready(Jwt j, UUID id) {
    jobs.requireInspection(j, id);
    if (r.db.queryForObject(
            "select count(*) from workorder.work_order_tasks where tenant_id=? and work_order_id=?"
                + " and status not in ('COMPLETED','CANCELLED')",
            Integer.class,
            Access.tenant(j),
            id)
        > 0)
      throw new ResponseStatusException(
          CONFLICT, "Complete or explicitly cancel all repair tasks first");
    if (r.db.queryForObject(
            "select count(*) from workorder.work_order_tasks where tenant_id=? and work_order_id=?"
                + " and status='COMPLETED'",
            Integer.class,
            Access.tenant(j),
            id)
        == 0)
      throw new ResponseStatusException(CONFLICT, "At least one completed repair task is required");
  }

  @PostMapping("/work-orders/{id}/quality-check")
  public Map<String, Object> requestQuality(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @Valid @RequestBody Quality in) {
    var o = jobs.row(j, id);
    jobs.editable(j, o);
    Records.version(o, in.version());
    if (!"IN_PROGRESS".equals(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Only in-progress jobs can enter quality check");
    if (o.get("commercial_estimate_id") != null) jobs.requireCommercial(j, o, null);
    if (o.get("commercial_estimate_id") != null
        && r.db.queryForObject(
                "select count(*) from workorder.required_parts where tenant_id=? and"
                    + " work_order_id=? and status not in ('FULFILLED','CANCELLED')",
                Integer.class,
                Access.tenant(j),
                id)
            > 0)
      throw new ResponseStatusException(
          CONFLICT,
          "Verify installed stock or cancel unresolved parts requests before quality review");
    ready(j, id);
    jobs.eligibility(j, in.reviewerId(), (UUID) o.get("branch_id"), "QUALITY_REVIEWER");
    separate(j, o, in.reviewerId());
    UUID qc = UUID.randomUUID();
    r.db.update(
        "insert into"
            + " workorder.quality_checks(id,tenant_id,branch_id,work_order_id,reviewer_id,requested_by,status)"
            + " values(?,?,?,?,?,?,'PENDING')",
        qc,
        Access.tenant(j),
        o.get("branch_id"),
        id,
        in.reviewerId(),
        Access.user(j));
    jobs.status(j, o, "QUALITY_CHECK", "Submitted for quality review");
    return jobs.detail(j, id);
  }

  void separate(Jwt j, Map<String, Object> o, UUID reviewer) {
    var branch = jobs.branch(j, (UUID) o.get("branch_id"));
    var settings = Records.object(branch.get("settings"));
    if (!Boolean.FALSE.equals(settings.get("separateQualityReviewer"))
        && (reviewer.equals(o.get("assigned_technician_id"))
            || r.db.queryForObject(
                    "select count(*) from workorder.work_order_tasks where tenant_id=? and"
                        + " work_order_id=? and assigned_technician_id=? and status='COMPLETED'",
                    Integer.class,
                    Access.tenant(j),
                    o.get("id"),
                    reviewer)
                > 0))
      throw new ResponseStatusException(
          FORBIDDEN, "Workshop policy requires a reviewer separate from repair technicians");
  }

  @PostMapping("/work-orders/{id}/quality-check/{decision:approve|reject}")
  public Map<String, Object> decideQuality(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable String decision,
      @Valid @RequestBody QualityDecision in) {
    Access.require(j, Permission.WORKORDER_QUALITY_CHECK);
    var o = jobs.row(j, id);
    if (!"QUALITY_CHECK".equals(o.get("status")))
      throw new ResponseStatusException(CONFLICT, "Job is not awaiting quality review");
    var qc =
        r.one(
            "select * from workorder.quality_checks where tenant_id=? and work_order_id=? and"
                + " status='PENDING' for update",
            Access.tenant(j),
            id);
    Records.version(qc, in.version());
    if (!Access.user(j).equals(qc.get("reviewer_id")))
      throw new ResponseStatusException(FORBIDDEN, "Only the assigned reviewer may sign off");
    jobs.eligibility(j, Access.user(j), (UUID) o.get("branch_id"), "QUALITY_REVIEWER");
    separate(j, o, Access.user(j));
    boolean pass = decision.equals("approve");
    if (pass) {
      ready(j, id);
      for (String field : List.of("repairsVerified", "findingsReviewed", "belongingsVerified"))
        if (!Boolean.TRUE.equals(in.checklist().get(field)))
          throw new ResponseStatusException(BAD_REQUEST, "Complete the quality review checklist");
    }
    r.db.update(
        "update workorder.quality_checks set"
            + " status=?,checklist=?::jsonb,reviewer_notes=?,reviewed_at=now(),updated_at=now(),version=version+1"
            + " where tenant_id=? and id=?",
        pass ? "PASSED" : "FAILED",
        Records.json(in.checklist()),
        in.notes(),
        Access.tenant(j),
        qc.get("id"));
    if (pass && o.get("commercial_estimate_id") != null) {
      r.db.update(
          "update workorder.work_orders set"
              + " quality_passed_at=now(),version=version+1,updated_at=now() where tenant_id=? and"
              + " id=?",
          Access.tenant(j),
          id);
      jobs.audit(
          j, o, "QUALITY_PASSED_AWAITING_FINANCIAL_READINESS", (UUID) qc.get("id"), in.notes());
    } else jobs.status(j, o, pass ? "READY_FOR_DELIVERY" : "IN_PROGRESS", in.notes());
    if (!pass) {
      UUID task = UUID.randomUUID();
      r.db.update(
          "insert into"
              + " workorder.work_order_tasks(id,tenant_id,branch_id,work_order_id,task_description,task_category,priority,status,assigned_technician_id,estimated_duration_minutes,origin_quality_check_id)"
              + " values(?,?,?,? ,?,'REWORK','HIGH','TODO',?,30,?)",
          task,
          Access.tenant(j),
          o.get("branch_id"),
          id,
          "QC rework: " + in.notes().substring(0, Math.min(980, in.notes().length())),
          o.get("assigned_technician_id"),
          qc.get("id"));
      jobs.audit(
          j,
          o,
          "QUALITY_REWORK_REQUESTED",
          task,
          in.notes().substring(0, Math.min(1000, in.notes().length())));
    }
    return jobs.detail(j, id);
  }
}
