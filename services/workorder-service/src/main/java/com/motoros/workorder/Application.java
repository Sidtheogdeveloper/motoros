package com.motoros.workorder;

import com.motoros.security.*;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@Import({
  com.motoros.foundation.events.EventConfiguration.class,
  SecurityConfiguration.class,
  ApiErrors.class,
  com.motoros.storage.PrivateObjects.class
})
public class Application {
  public static void main(String[] args) {
    com.motoros.foundation.ServiceLauncher.run(Application.class, args);
  }
}
