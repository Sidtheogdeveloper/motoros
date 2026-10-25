package com.motoros.notification;

import com.motoros.foundation.*;
import com.motoros.foundation.events.*;
import java.util.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class NotificationDelivery {
  private final EventStore store;
  private final NotificationConsumer consumer;
  private final EventGateway gateway;
  private final DeliveryCipher cipher;
  private final DeliveryProviders providers;

  NotificationDelivery(
      EventStore store,
      NotificationConsumer consumer,
      EventGateway gateway,
      DeliveryCipher cipher,
      DeliveryProviders providers) {
    this.store = store;
    this.consumer = consumer;
    this.gateway = gateway;
    this.cipher = cipher;
    this.providers = providers;
  }

  @Scheduled(fixedDelayString = "${motoros.notification.poll-ms:1000}")
  public void send() {
    UUID claim = UUID.randomUUID();
    var rows =
        store.tx.execute(
            t ->
                store.db.queryForList(
                    "with due as(select id from notification.notification_requests where (status in"
                        + " ('APPROVED','QUEUED') and next_attempt_at<=now()) or (status='SENDING'"
                        + " and lease_until<now()) order by created_at limit 5 for update skip"
                        + " locked) update notification.notification_requests n set"
                        + " status='SENDING',claim_token=?,lease_until=now()+interval '90"
                        + " seconds',attempt_count=attempt_count+1,version=version+1,updated_at=now()"
                        + " from due where n.id=due.id returning n.*",
                    claim));
    for (var row : rows) {
      var event = EventEnvelope.read(row.get("source_envelope").toString());
      String template = row.get("template_key").toString();
      int attempt = ((Number) row.get("attempt_count")).intValue();
      try {
        var context = gateway.proof(event);
        var prefs = consumer.preferences(event, context);
        var type =
            new Records(store.db)
                .one(
                    "select optional from notification.notification_templates where template_key=?"
                        + " and language=?",
                    template,
                    row.get("language"));
        String channel = row.get("channel").toString();
        String recipient = cipher.decrypt(row.get("encrypted_recipient").toString());
        if (!NotificationPolicy.current(event, context, template)
            || !NotificationPolicy.allowed(
                prefs, channel, Boolean.TRUE.equals(type.get("optional")))
            || !recipient.equalsIgnoreCase(
                Objects.toString(prefs.get(channel.equals("EMAIL") ? "email" : "phone"), ""))) {
          finish(row, claim, event, "CANCELLED", "POLICY_OR_SOURCE_CHANGED", null);
          continue;
        }
        var content = Records.object(cipher.decrypt(row.get("encrypted_content").toString()));
        var accepted =
            providers.send(
                channel,
                (UUID) row.get("id"),
                recipient,
                content.get("subject").toString(),
                content.get("body").toString());
        finish(row, claim, event, "SENT", accepted.status(), accepted.messageId());
      } catch (Exception e) {
        boolean terminal =
            e instanceof IllegalArgumentException
                || e instanceof org.springframework.web.client.HttpClientErrorException
                || attempt >= 5;
        finish(
            row,
            claim,
            event,
            terminal ? "FAILED" : "QUEUED",
            terminal ? "DELIVERY_FAILED" : "PROVIDER_RETRY",
            null);
      }
    }
  }

  private void finish(
      Map<String, Object> row,
      UUID claim,
      EventEnvelope source,
      String status,
      String category,
      String providerId) {
    store.tx.executeWithoutResult(
        t -> {
          int changed =
              store.db.update(
                  "update notification.notification_requests set"
                      + " status=?,provider_status=?,provider_message_id=coalesce(?,provider_message_id),sent_at=case"
                      + " when ?='SENT' then now() else sent_at end,failed_at=case when ?='FAILED'"
                      + " then now() else failed_at end,last_error=case when ? in"
                      + " ('FAILED','QUEUED','CANCELLED') then ? else null"
                      + " end,next_attempt_at=now()+make_interval(secs=>?),claim_token=null,lease_until=null,version=version+1,updated_at=now(),encrypted_content=case"
                      + " when ? in ('SENT','CANCELLED') then null else encrypted_content"
                      + " end,encrypted_recipient=case when ? in ('SENT','CANCELLED') then null"
                      + " else encrypted_recipient end where id=? and claim_token=? and"
                      + " status='SENDING'",
                  status,
                  category,
                  providerId,
                  status,
                  status,
                  status,
                  category,
                  EventStore.backoff(((Number) row.get("attempt_count")).intValue()),
                  status,
                  status,
                  row.get("id"),
                  claim);
          if (changed == 0) return;
          store.db.update(
              "insert into"
                  + " notification.notification_attempts(id,notification_id,attempt_number,category,provider_message_id)"
                  + " values(?,?,?,?,?)",
              UUID.randomUUID(),
              row.get("id"),
              row.get("attempt_count"),
              category,
              providerId);
          if (Set.of("SENT", "FAILED").contains(status))
            store.append(
                source,
                (UUID) row.get("id"),
                status.equals("SENT") ? "NotificationSent" : "NotificationFailed",
                Map.of(
                    "id", row.get("id"), "customer_id", row.get("customer_id"), "status", status));
        });
  }

  @Scheduled(fixedDelayString = "${motoros.notification.reminder-poll-ms:1000}")
  public void reminders() {
    for (int i = 0; i < 5; i++) {
      Boolean found =
          store.tx.execute(
              t -> {
                var rows =
                    store.db.queryForList(
                        "select * from notification.scheduled_notifications where"
                            + " status='SCHEDULED' and due_at<=now() order by due_at limit 1 for"
                            + " update skip locked");
                if (rows.isEmpty()) return false;
                var row = rows.getFirst();
                var event = EventEnvelope.read(row.get("source_envelope").toString());
                String template = row.get("template_key").toString();
                var context = gateway.proof(event);
                var prefs = consumer.preferences(event, context);
                boolean active = NotificationPolicy.current(event, context, template);
                // Booking owns the due-event timer; its unique durable job emits
                // AppointmentReminderDue.
                if (active && !prefs.isEmpty() && !template.equals("appointment-reminder"))
                  consumer.enqueue(event, context, prefs, template);
                store.db.update(
                    "update notification.scheduled_notifications set"
                        + " status=?,version=version+1,updated_at=now() where id=?",
                    active ? "QUEUED" : "CANCELLED",
                    row.get("id"));
                return true;
              });
      if (!Boolean.TRUE.equals(found)) return;
    }
  }
}
