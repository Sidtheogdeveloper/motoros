package com.motoros.booking;
import com.motoros.foundation.events.EventStore;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="motoros.events.enabled",havingValue="true")
public class AppointmentReminders {
  private final EventStore store;
  AppointmentReminders(EventStore store){this.store=store;}
  @Scheduled(fixedDelayString="${motoros.appointment.reminder-poll-ms:1000}") public void due(){
    store.tx.executeWithoutResult(t->{
      var rows=store.db.queryForList("select j.*,to_jsonb(a)::text as source,a.appointment_status,a.requested_start_time from booking.appointment_reminder_jobs j join booking.appointments a on a.tenant_id=j.tenant_id and a.id=j.appointment_id where j.status='SCHEDULED' and j.due_at<=now() order by j.due_at limit 10 for update of j,a skip locked");
      for(var row:rows){boolean valid="CONFIRMED".equals(row.get("appointment_status"))&&row.get("starts_at").equals(row.get("requested_start_time"))&&com.motoros.foundation.Records.instant(row.get("starts_at")).isAfter(java.time.Instant.now());
        if(valid)store.db.update("insert into booking.outbox_events(event_id,event_type,tenant_id,branch_id,aggregate_id,aggregate_type,correlation_id,payload,actor_id,source_snapshot) values(?,'AppointmentReminderDue',?,?,?,'appointments',?,'{}',?,?::jsonb)",UUID.randomUUID(),row.get("tenant_id"),row.get("branch_id"),row.get("appointment_id"),UUID.randomUUID().toString(),new UUID(0,0),row.get("source"));
        store.db.update("update booking.appointment_reminder_jobs set status=?,updated_at=now() where id=?",valid?"EMITTED":"CANCELLED",row.get("id"));
      }
    });
  }
}
