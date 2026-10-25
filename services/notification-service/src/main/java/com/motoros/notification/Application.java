package com.motoros.notification;

import com.motoros.security.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@Import({
  SecurityConfiguration.class,
  ApiErrors.class,
  com.motoros.foundation.events.EventConfiguration.class
})
public class Application {
  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }
}
