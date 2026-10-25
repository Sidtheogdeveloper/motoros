package com.motoros.foundation.events;

import java.util.Map;

public interface EventContextContributor {
  void contribute(EventEnvelope event, String client, Map<String, Object> context);
}
