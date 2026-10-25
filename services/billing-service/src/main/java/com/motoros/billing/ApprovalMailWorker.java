package com.motoros.billing;

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
@org.springframework.boot.autoconfigure.condition.ConditionalOnExpression("${motoros.mail-enabled:false} and !${motoros.events.enabled:false}")
public class ApprovalMailWorker {
  private final JdbcTemplate db;
  private final ApprovalCipher cipher;
  private final JavaMailSender mail;
  private final TransactionTemplate tx;
  private final String from;

  ApprovalMailWorker(
      JdbcTemplate db,
      ApprovalCipher cipher,
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
                  "select * from billing.approval_mail_outbox where status='PENDING' and"
                      + " next_attempt_at<=now() order by created_at limit 1 for update skip"
                      + " locked");
          if (rows.isEmpty()) return;
          var row = rows.getFirst();
          try {
            var message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(row.get("recipient").toString());
            message.setSubject("Review MotorOS estimate " + row.get("estimate_id"));
            message.setText(cipher.decrypt(row.get("encrypted_body").toString()));
            mail.send(message);
            db.update(
                "update billing.approval_mail_outbox set"
                    + " status='SENT',sent_at=now(),encrypted_body='',attempts=attempts+1 where"
                    + " id=?",
                row.get("id"));
          } catch (Exception e) {
            int attempts = ((Number) row.get("attempts")).intValue() + 1;
            db.update(
                "update billing.approval_mail_outbox set"
                    + " attempts=?,status=?,next_attempt_at=now()+interval '30 seconds' where id=?",
                attempts,
                attempts >= 5 ? "FAILED" : "PENDING",
                row.get("id"));
            org.slf4j.LoggerFactory.getLogger(getClass())
                .warn("Approval delivery retry id={} attempt={}", row.get("id"), attempts);
          }
        });
  }
}
