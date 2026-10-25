package com.motoros.workorder;
import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="motoros.events.enabled",havingValue="true")
public class EstimateApprovalConsumer implements EventHandler {
  private final Records r;
  EstimateApprovalConsumer(JdbcTemplate db){r=new Records(db);}
  public String consumer(){return "workorder-approval";}
  public boolean accepts(EventEnvelope e){return e.producer().equals("billing")&&e.eventType().equals("EstimateApproved");}
  public void handle(EventEnvelope e,Map<String,Object> proof){
    var current=Records.object(proof.get("current"));
    if(!Boolean.TRUE.equals(current.get("approvalValid")))return; // A later revision/rejection/expiry is authoritative.
    UUID job=Records.uuid(current.get("workOrderId"));
    var o=r.one("select * from workorder.work_orders where tenant_id=? and id=? for update",e.tenantId(),job);
    if(!Objects.equals(o.get("branch_id"),e.branchId())||!o.get("customer_id").toString().equals(current.get("customerId").toString())||!o.get("vehicle_id").toString().equals(current.get("vehicleId").toString()))throw new IllegalArgumentException("APPROVAL_OWNERSHIP_MISMATCH");
    if(!Set.of("AWAITING_APPROVAL","APPROVED","IN_PROGRESS").contains(o.get("status")))return;
    if(e.aggregateId().equals(o.get("commercial_estimate_id"))&&Objects.equals(((Number)current.get("revision")).intValue(),o.get("commercial_revision")))return;
    r.db.update("update workorder.work_orders set commercial_estimate_id=?,commercial_revision=?,development_approval_id=null,status=case when status='AWAITING_APPROVAL' then 'APPROVED' else status end,version=version+1,updated_at=now() where tenant_id=? and id=?",e.aggregateId(),current.get("revision"),e.tenantId(),job);
    if("AWAITING_APPROVAL".equals(o.get("status")))r.db.update("insert into workorder.work_order_status_history(id,tenant_id,branch_id,work_order_id,from_status,to_status,note,actor_id,correlation_id) values(?,?,?,?,?,'APPROVED','Authoritative customer estimate approval event',?,?)",UUID.randomUUID(),e.tenantId(),e.branchId(),job,o.get("status"),new UUID(0,0),e.correlationId());
    r.db.update("insert into workorder.work_order_audit_events(id,tenant_id,branch_id,work_order_id,action,target_id,actor_id,note,correlation_id) values(?,?,?,?, 'ESTIMATE_APPROVAL_EVENT',?,?,?,?)",UUID.randomUUID(),e.tenantId(),e.branchId(),job,e.aggregateId(),new UUID(0,0),"Verified source event "+e.eventId(),e.correlationId());
  }
}
