package com.motoros.notification;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.foundation.events.*;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/notifications/assistant")
public class CommunicationDraftController {
  private final EventStore store;
  private final CommunicationFacts context;
  private final DeliveryCipher cipher;
  private final Records records;

  CommunicationDraftController(EventStore store, CommunicationFacts context, DeliveryCipher cipher) {
    this.store = store;
    this.context = context;
    this.cipher = cipher;
    this.records = new Records(store.db);
  }

  public record NewDraft(
      @NotNull UUID branchId, @NotNull UUID customerId, @NotNull UUID vehicleId,
      @NotNull UUID resourceId, @NotNull CommunicationFacts.Purpose purpose,
      @NotNull CommunicationFacts.Channel channel, @NotNull CommunicationFacts.Language language,
      @NotNull CommunicationFacts.Tone tone, boolean includeDetails) {}

  public record Edit(
      @NotNull @Min(0) Long version, @NotNull CommunicationFacts.Language language,
      @NotNull CommunicationFacts.Tone tone, boolean includeDetails) {}

  public record Confirm(@NotNull @Min(0) Long version, @AssertTrue boolean confirmed) {}

  private void scope(Jwt jwt, UUID branch) {
    Access.require(jwt, Permission.AI_COMMUNICATION_DRAFT_USE);
    Access.require(jwt, Permission.NOTIFICATION_MANAGE);
    Access.require(jwt, Permission.CUSTOMER_READ);
    Access.branch(jwt, branch);
  }

  @PostMapping("/draft")
  public Map<String, Object> create(@AuthenticationPrincipal Jwt jwt,
                                    @Valid @RequestBody NewDraft input) {
    scope(jwt, input.branchId());
    Access.require(jwt, input.purpose().readPermission());
    UUID tenant = Access.tenant(jwt);
    EventEnvelope event;
    try {
      event = context.source(input.purpose(), tenant, input.branchId(), input.resourceId());
    } catch (HttpClientErrorException.NotFound missing) {
      throw new ResponseStatusException(NOT_FOUND, "No matching event for this record and branch");
    }
    var verified = context.resolve(event, input.purpose(), input.customerId(), input.vehicleId(),
        input.channel());
    UUID id = UUID.randomUUID();
    var preview = preview(input.purpose(), input.language(), input.tone(), input.includeDetails(), verified);
    return store.tx.execute(tx -> {
      store.db.update("delete from notification.communication_drafts where expires_at<=now()");
      store.db.update("""
          insert into notification.communication_drafts
            (id,tenant_id,branch_id,actor_id,customer_id,vehicle_id,purpose,channel,language,tone,
             include_details,source_envelope,encrypted_preview,facts_hash,status)
          values(?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,'DRAFT')
          """, id, tenant, input.branchId(), Access.user(jwt), input.customerId(), input.vehicleId(),
          input.purpose().name(), input.channel().name(), input.language().name(), input.tone().name(),
          input.includeDetails(), Records.json(event), cipher.encrypt(Records.json(preview)),
          verified.fingerprint());
      audit(jwt, null, "ASSISTANT_DRAFT_CREATED", id);
      return response(row(jwt, id, false));
    });
  }

  @GetMapping("/drafts")
  public Map<String, Object> list(@AuthenticationPrincipal Jwt jwt, @RequestParam UUID branchId,
                                  @RequestParam(defaultValue = "0") @Min(0) int page) {
    scope(jwt, branchId);
    Records.page(page, 20);
    String where = """
        from notification.communication_drafts d left join notification.notification_requests n
          on n.id=d.id and n.tenant_id=d.tenant_id
        where d.tenant_id=? and d.actor_id=? and d.branch_id=? and d.expires_at>now()
        """;
    // The specific source-read grant is checked again before exposing any preview.
    var rows = store.db.queryForList("select d.*,n.status as delivery_status,n.last_error as delivery_error "
        + where + " order by d.updated_at desc,d.id limit 20 offset ?",
        Access.tenant(jwt), Access.user(jwt), branchId, 20L * page);
    var granted = jwt.getClaimAsStringList("permissions");
    return Map.of("drafts", rows.stream().filter(row -> granted.contains(purpose(row).readPermission().name()))
        .map(this::response).toList(), "hasMore", rows.size() == 20);
  }

  @PatchMapping("/drafts/{id}")
  public Map<String, Object> edit(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                  @Valid @RequestBody Edit edit) {
    return store.tx.execute(tx -> {
      var row = row(jwt, id, true);
      Records.version(row, edit.version());
      if ("QUEUED".equals(row.get("status")))
        throw new ResponseStatusException(CONFLICT, "A queued message cannot be edited");
      var verified = verified(row);
      var content = preview(purpose(row), edit.language(), edit.tone(), edit.includeDetails(), verified);
      store.db.update("""
          update notification.communication_drafts set language=?,tone=?,include_details=?,
            encrypted_preview=?,facts_hash=?,status='DRAFT',approved_at=null,version=version+1,updated_at=now()
          where tenant_id=? and id=?
          """, edit.language().name(), edit.tone().name(), edit.includeDetails(),
          cipher.encrypt(Records.json(content)), verified.fingerprint(), Access.tenant(jwt), id);
      audit(jwt, null, "ASSISTANT_DRAFT_EDITED", id);
      return response(row(jwt, id, false));
    });
  }

  @PostMapping("/drafts/{id}/approve")
  public Map<String, Object> approve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                     @Valid @RequestBody Confirm confirmation) {
    return store.tx.execute(tx -> {
      var row = row(jwt, id, true);
      Records.version(row, confirmation.version());
      if (!"DRAFT".equals(row.get("status")))
        throw new ResponseStatusException(CONFLICT, "Only an unapproved draft can be approved");
      requireUnchanged(row, verified(row));
      store.db.update("""
          update notification.communication_drafts set status='APPROVED',approved_at=now(),
            version=version+1,updated_at=now() where tenant_id=? and id=?
          """, Access.tenant(jwt), id);
      audit(jwt, null, "ASSISTANT_DRAFT_APPROVED", id);
      return response(row(jwt, id, false));
    });
  }

  @PostMapping("/drafts/{id}/send")
  public Map<String, Object> send(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                  @Valid @RequestBody Confirm confirmation) {
    return store.tx.execute(tx -> {
      var row = row(jwt, id, true);
      if ("QUEUED".equals(row.get("status"))) return response(row);
      Records.version(row, confirmation.version());
      if (!"APPROVED".equals(row.get("status")) || row.get("approved_at") == null)
        throw new ResponseStatusException(CONFLICT, "Review and approve this version before sending");
      var verified = verified(row);
      requireUnchanged(row, verified);
      var event = event(row);
      var content = Records.object(cipher.decrypt(row.get("encrypted_preview").toString()));
      var queued = new LinkedHashMap<String, Object>();
      queued.put("subject", content.get("subject"));
      queued.put("body", content.get("body"));
      queued.put("factsHash", verified.fingerprint());
      queued.put("vehicleId", row.get("vehicle_id"));
      queued.put("expiresAt", Records.instant(row.get("expires_at")).toString());
      var purpose = purpose(row);
      int inserted = store.db.update("""
          insert into notification.notification_requests
            (id,tenant_id,branch_id,customer_id,channel,template_key,language,source_event_id,
             related_resource_id,source_envelope,encrypted_recipient,encrypted_content,status,assistant_purpose)
          values(?,?,?,?,?,?,?,?,?,?::jsonb,?,?,'APPROVED',?) on conflict do nothing
          """, id, Access.tenant(jwt), row.get("branch_id"), row.get("customer_id"),
          row.get("channel"), "assistant-" + purpose.template, row.get("language"), event.eventId(),
          event.aggregateId(), Records.json(event), cipher.encrypt(verified.recipient()),
          cipher.encrypt(Records.json(queued)), purpose.name());
      if (inserted != 1)
        throw new ResponseStatusException(CONFLICT, "An approved message already exists for this event and channel");
      store.db.update("""
          update notification.communication_drafts set status='QUEUED',version=version+1,updated_at=now()
            where tenant_id=? and id=?
          """, Access.tenant(jwt), id);
      audit(jwt, id, "ASSISTANT_MESSAGE_QUEUED", id);
      store.append(event, id, "NotificationRequested", Map.of(
          "id", id, "customer_id", row.get("customer_id"), "status", "APPROVED"));
      return response(row(jwt, id, false));
    });
  }

  private Map<String, Object> row(Jwt jwt, UUID id, boolean lock) {
    var row = records.one("""
        select d.*,n.status as delivery_status,n.last_error as delivery_error
        from notification.communication_drafts d left join notification.notification_requests n
          on n.id=d.id and n.tenant_id=d.tenant_id
        where d.tenant_id=? and d.actor_id=? and d.id=? and d.expires_at>now()
        """ + (lock ? " for update of d" : ""), Access.tenant(jwt), Access.user(jwt), id);
    scope(jwt, (UUID) row.get("branch_id"));
    Access.require(jwt, purpose(row).readPermission());
    return row;
  }

  private CommunicationFacts.Verified verified(Map<String, Object> row) {
    return context.resolve(event(row), purpose(row), (UUID) row.get("customer_id"),
        (UUID) row.get("vehicle_id"), CommunicationFacts.Channel.valueOf(row.get("channel").toString()));
  }

  private static CommunicationFacts.Purpose purpose(Map<String, Object> row) {
    return CommunicationFacts.Purpose.valueOf(row.get("purpose").toString());
  }

  private static EventEnvelope event(Map<String, Object> row) {
    return EventEnvelope.read(row.get("source_envelope").toString());
  }

  private Map<String, Object> preview(CommunicationFacts.Purpose purpose,
      CommunicationFacts.Language language, CommunicationFacts.Tone tone, boolean details,
      CommunicationFacts.Verified verified) {
    var template = records.one("select subject,body from notification.notification_templates"
        + " where template_key=? and language=?", purpose.template, language.name());
    return CommunicationFacts.render(template, verified, language, tone, details);
  }

  private void requireUnchanged(Map<String, Object> row, CommunicationFacts.Verified current) {
    if (!current.fingerprint().equals(row.get("facts_hash")))
      throw new ResponseStatusException(CONFLICT, "Verified details changed. Edit and approve a fresh preview");
  }

  private Map<String, Object> response(Map<String, Object> row) {
    var result = new LinkedHashMap<>(Records.object(cipher.decrypt(row.get("encrypted_preview").toString())));
    result.put("messageDraftId", row.get("id"));
    result.put("tenantId", row.get("tenant_id"));
    result.put("customerReference", row.get("customer_id"));
    result.put("vehicleReference", row.get("vehicle_id"));
    result.put("branchId", row.get("branch_id"));
    result.put("sourceReference", event(row).aggregateId());
    for (String name : List.of("purpose", "channel", "language", "tone", "version", "status",
        "include_details", "delivery_status", "delivery_error"))
      result.put(name, row.get(name));
    result.put("requiresApproval", "DRAFT".equals(row.get("status")));
    result.put("warnings", purpose(row) == CommunicationFacts.Purpose.ESTIMATE_APPROVAL
        ? List.of("The customer’s secure Billing approval link is added privately at delivery.")
        : List.of(purpose(row).optional()
            ? "Maintenance follow-ups also require optional communications consent."
            : "This operational message requires current channel consent."));
    return Records.dto(result);
  }

  private void audit(Jwt jwt, UUID delivery, String action, UUID draft) {
    store.db.update("""
        insert into notification.notification_audit
          (id,tenant_id,notification_id,actor_id,action,reason,correlation_id)
        values(?,?,?,?,?,?,?)
        """, UUID.randomUUID(), Access.tenant(jwt), delivery, Access.user(jwt), action,
        "Assistant draft " + draft, Correlation.current());
  }
}
