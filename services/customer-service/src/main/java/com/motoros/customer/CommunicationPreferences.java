package com.motoros.customer;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import com.motoros.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@RestController
public class CommunicationPreferences {
  private final Records r;private final ObjectProvider<EventGateway> gateway;
  CommunicationPreferences(JdbcTemplate db,ObjectProvider<EventGateway> gateway){r=new Records(db);this.gateway=gateway;}
  public record Preferences(boolean emailEnabled,boolean smsEnabled,boolean whatsappEnabled,boolean operationalEnabled,boolean promotionalEnabled,@NotBlank @Pattern(regexp="en|ta") String preferredLanguage,@NotBlank @Size(min=10,max=500) String consentNote,@NotNull @Min(0) Long version){}
  private Map<String,Object> customer(UUID tenant,UUID id){return r.one("select id,tenant_id,email,phone,status from customer.customers where tenant_id=? and id=?",tenant,id);}
  private void scope(Jwt j,UUID id,boolean write){
    var c=customer(Access.tenant(j),id);
    if("CUSTOMER".equals(j.getClaimAsString("role"))){
      if(!Boolean.TRUE.equals(j.getClaim("email_verified"))||!Objects.toString(c.get("email"),"").equalsIgnoreCase(j.getClaimAsString("email")))throw new ResponseStatusException(FORBIDDEN);
    }else Access.require(j,write?Permission.COMMUNICATION_PREFERENCES_WRITE:Permission.CUSTOMER_READ);
  }
  Map<String,Object> prefs(UUID tenant,UUID id){
    var rows=r.db.queryForList("select * from customer.communication_preferences where tenant_id=? and customer_id=?",tenant,id);
    return rows.isEmpty()?new LinkedHashMap<>(Map.of("emailEnabled",true,"smsEnabled",false,"whatsappEnabled",false,"operationalEnabled",true,"promotionalEnabled",false,"preferredLanguage","en","version",0)):Records.dto(rows.getFirst());
  }
  @GetMapping("/api/communication-preferences/{id}") public Map<String,Object> get(@AuthenticationPrincipal Jwt j,@PathVariable UUID id){scope(j,id,false);return prefs(Access.tenant(j),id);}
  @PutMapping("/api/communication-preferences/{id}") @Transactional
  public Map<String,Object> put(@AuthenticationPrincipal Jwt j,@PathVariable UUID id,@Valid @RequestBody Preferences p){
    scope(j,id,true);UUID t=Access.tenant(j);r.lock("communication"+t+id);var old=prefs(t,id);if(((Number)old.get("version")).longValue()!=p.version())throw new ResponseStatusException(CONFLICT,"Preferences changed; refresh");
    r.db.update("insert into customer.communication_preferences(tenant_id,customer_id,email_enabled,sms_enabled,whatsapp_enabled,operational_enabled,promotional_enabled,preferred_language,consent_note,consent_recorded_by,version) values(?,?,?,?,?,?,?,?,?,?,1) on conflict(tenant_id,customer_id) do update set email_enabled=excluded.email_enabled,sms_enabled=excluded.sms_enabled,whatsapp_enabled=excluded.whatsapp_enabled,operational_enabled=excluded.operational_enabled,promotional_enabled=excluded.promotional_enabled,preferred_language=excluded.preferred_language,consent_note=excluded.consent_note,consent_recorded_by=excluded.consent_recorded_by,consent_recorded_at=now(),version=communication_preferences.version+1,updated_at=now()",t,id,p.emailEnabled(),p.smsEnabled(),p.whatsappEnabled(),p.operationalEnabled(),p.promotionalEnabled(),p.preferredLanguage(),p.consentNote(),Access.user(j));
    r.db.update("insert into customer.communication_preference_audit(id,tenant_id,customer_id,actor_id,preferences) values(?,?,?,?,?::jsonb)",UUID.randomUUID(),t,id,Access.user(j),Records.json(p));return prefs(t,id);
  }
  @GetMapping("/api/automation/communication-context") public Map<String,Object> resolve(@RequestHeader("X-MotorOS-Tenant") UUID tenant,@RequestParam UUID customerId,@RequestParam UUID eventId,@RequestParam String producer){
    var proof=gateway.getObject().get(producer,"/api/automation/event-proof/"+eventId,tenant);
    var source=EventEnvelope.read(Records.json(proof.get("event")));
    var current=proof.containsKey("current")?Records.object(proof.get("current")):Map.<String,Object>of();
    Object linked=current.getOrDefault("customerId",source.payload().get("customerId"));
    if(!customerId.toString().equals(String.valueOf(linked)))throw new ResponseStatusException(FORBIDDEN,"Source/customer linkage mismatch");
    var customer=customer(tenant,customerId);if(!"ACTIVE".equals(customer.get("status")))throw new ResponseStatusException(CONFLICT,"Customer unavailable");
    var result=prefs(tenant,customerId);result.put("customerId",customerId);result.put("tenantId",tenant);
    result.put("email",Objects.toString(customer.get("email"),""));result.put("phone",Objects.toString(customer.get("phone"),""));return result;
  }
}
