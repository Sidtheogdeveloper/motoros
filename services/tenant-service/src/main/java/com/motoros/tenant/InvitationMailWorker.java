package com.motoros.tenant;

import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@EnableScheduling
@ConditionalOnProperty(name = "motoros.mail-enabled", havingValue = "true")
public class InvitationMailWorker {
  private final JdbcTemplate db;
  private final InvitationCipher cipher;
  private final JavaMailSender mail;
  private final TransactionTemplate tx;
  private final String from;

  InvitationMailWorker(
      JdbcTemplate db,
      InvitationCipher cipher,
      JavaMailSender mail,
      PlatformTransactionManager manager,
      @org.springframework.beans.factory.annotation.Value(
              "${motoros.mail-from:motoros@example.test}")
          String from) {
    this.from = from;
    this.db = db;
    this.cipher = cipher;
    this.mail = mail;
    tx = new TransactionTemplate(manager);
  }

  @Scheduled(fixedDelay = 1000)
  public void deliver() {
    tx.executeWithoutResult(
        t -> {
          var rows =
              db.queryForList(
                  "select * from tenant.invitation_mail_outbox where status='PENDING' and"
                      + " next_attempt_at<=now() order by created_at limit 1 for update skip"
                      + " locked");
          if (rows.isEmpty()) return;
          var row = rows.getFirst();
          try {
            var message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(row.get("recipient").toString());
            message.setSubject("Your MotorOS workshop invitation");
            message.setText(cipher.decrypt(row.get("encrypted_body").toString()));
            mail.send(message);
            db.update(
                "update tenant.invitation_mail_outbox set"
                    + " status='SENT',sent_at=now(),encrypted_body='',attempts=attempts+1 where"
                    + " id=?",
                row.get("id"));
          } catch (Exception e) {
            int attempts = ((Number) row.get("attempts")).intValue() + 1;
            db.update(
                "update tenant.invitation_mail_outbox set"
                    + " attempts=?,status=?,next_attempt_at=now()+interval '30 seconds' where id=?",
                attempts,
                attempts >= 5 ? "FAILED" : "PENDING",
                row.get("id"));
            org.slf4j.LoggerFactory.getLogger(getClass())
                .warn("Invitation delivery retry id={} attempt={}", row.get("id"), attempts);
          }
        });
  }
}
