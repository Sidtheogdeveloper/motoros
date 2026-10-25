package com.motoros.analytics;

import com.motoros.security.*;
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
    com.motoros.foundation.ServiceLauncher.run(Application.class, args);
  }
}
