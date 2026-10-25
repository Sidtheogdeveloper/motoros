package com.motoros.billing;
import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class NotificationContext implements EventContextContributor {
  private final Records r;private final ApprovalCipher cipher;
  NotificationContext(JdbcTemplate db,ApprovalCipher cipher){r=new Records(db);this.cipher=cipher;}
  public void contribute(EventEnvelope event,String client,Map<String,Object> context){
    if(event.aggregateType().equals("invoices")&&context.containsKey("current")){
      var outstanding=r.db.queryForObject("select greatest(0,i.total-coalesce((select sum(amount) from billing.invoice_adjustments a where a.tenant_id=i.tenant_id and a.invoice_id=i.id),0)-coalesce((select sum(case when p.record_type='PAYMENT' then p.amount else -p.amount end) from billing.payments p where p.tenant_id=i.tenant_id and p.invoice_id=i.id),0)) from billing.invoices i where tenant_id=? and id=?",java.math.BigDecimal.class,event.tenantId(),event.aggregateId());
      ((Map<String,Object>)context.get("current")).put("outstanding",outstanding.toPlainString());
    }
    if(event.aggregateType().equals("payments")){
      var rows=r.db.queryForList("select i.customer_id,i.work_order_id,i.vehicle_id from billing.payments p join billing.invoices i on i.tenant_id=p.tenant_id and i.id=p.invoice_id where p.tenant_id=? and p.id=?",event.tenantId(),event.aggregateId());
      if(!rows.isEmpty())((Map<String,Object>)context.get("current")).putAll(Records.dto(rows.getFirst()));
    }
    if(!client.equals("motoros-notification")||!event.eventType().equals("EstimateSubmitted"))return;
    var current=(Map<String,Object>)context.get("current");
    if(current==null||!"PENDING_CUSTOMER_APPROVAL".equals(current.get("status")))return;
    var rows=r.db.queryForList("select m.recipient,m.encrypted_body from billing.approval_mail_outbox m join billing.estimate_approvals a on a.tenant_id=m.tenant_id and a.estimate_id=m.estimate_id where m.tenant_id=? and m.estimate_id=? and a.status='PENDING' and a.expires_at>now() and m.encrypted_body<>'' order by m.created_at desc limit 1",event.tenantId(),event.aggregateId());
    if(!rows.isEmpty()){
      context.put("approvalRecipient",rows.getFirst().get("recipient"));
      context.put("approvalBody",cipher.decrypt(rows.getFirst().get("encrypted_body").toString()));
    }
  }
}
