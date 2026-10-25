package com.motoros.foundation.events;

public interface EventHandler {
  String consumer();

  boolean accepts(EventEnvelope event);

  void handle(EventEnvelope event, java.util.Map<String, Object> authoritativeContext);
}
