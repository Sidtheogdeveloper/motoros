package com.motoros.security;

import java.util.UUID;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

public final class Correlation {
  private Correlation() {}

  public static String current() {
    if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
      Object id = attrs.getRequest().getAttribute("correlationId");
      if (id != null) return id.toString();
    }
    return UUID.randomUUID().toString();
  }
}
