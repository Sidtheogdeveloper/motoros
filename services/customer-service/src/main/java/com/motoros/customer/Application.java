package com.motoros.customer;

import com.motoros.security.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@Import({com.motoros.foundation.events.EventConfiguration.class, SecurityConfiguration.class, ApiErrors.class})
public class Application {
  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }
}
