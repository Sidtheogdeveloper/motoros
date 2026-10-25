package com.motoros.notification;

import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * Provider adapters report acceptance only. No real SMS/WhatsApp provider is enabled by fixtures.
 */
@Component
public class DeliveryProviders {
  public record Accepted(String messageId, String status) {}

  private final JavaMailSender smtp;
  private final Environment env;

  DeliveryProviders(JavaMailSender smtp, Environment env) {
    this.smtp = smtp;
    this.env = env;
  }

  public Accepted send(
      String channel, UUID request, String recipient, String subject, String body) {
    boolean local = Arrays.asList(env.getActiveProfiles()).contains("local");
    if (channel.equals("EMAIL")) {
      if (local
          && (!recipient.endsWith("@example.test")
              || !Set.of("127.0.0.1", "localhost", "mailpit")
                  .contains(env.getProperty("spring.mail.host", "127.0.0.1"))))
        throw new IllegalArgumentException("LOCAL_RECIPIENT_OR_PROVIDER_DENIED");
      try {
        var message = smtp.createMimeMessage();
        var helper = new org.springframework.mail.javamail.MimeMessageHelper(message, "UTF-8");
        helper.setFrom(env.getProperty("motoros.mail-from", "motoros@example.test"));
        helper.setTo(recipient);
        helper.setSubject(subject);
        helper.setText(body, false);
        String stable = "<motoros-" + request + "@notifications.motoros>";
        message.setHeader("Message-ID", stable);
        smtp.send(message);
        return new Accepted(stable, "ACCEPTED_UNCONFIRMED");
      } catch (Exception e) {
        throw new IllegalStateException("EMAIL_PROVIDER_UNAVAILABLE");
      }
    }
    if (!local) throw new IllegalArgumentException("CHANNEL_PROVIDER_NOT_CONFIGURED");
    // Deliberate sink: no network access, telephone number or message body is logged.
    return new Accepted(
        "development-" + channel.toLowerCase(Locale.ROOT) + "-" + request, "DEVELOPMENT_CAPTURED");
  }
}
