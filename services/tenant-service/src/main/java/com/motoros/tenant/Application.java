package com.motoros.tenant;

import com.motoros.security.*;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@Import({
  com.motoros.foundation.events.EventConfiguration.class,
  SecurityConfiguration.class,
  ApiErrors.class
})
public class Application {
  public static void main(String[] args) {
    com.motoros.foundation.ServiceLauncher.run(Application.class, args);
  }
}
