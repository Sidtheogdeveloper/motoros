package com.motoros.billing;

import com.motoros.security.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.*;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@Import({com.motoros.foundation.events.EventConfiguration.class, SecurityConfiguration.class, ApiErrors.class})
public class Application {
  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }
}
