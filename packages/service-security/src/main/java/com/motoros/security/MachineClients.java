package com.motoros.security;

import java.util.*;

/** Maps provider-generated client IDs to stable internal identities; never maps user subjects. */
public final class MachineClients {
  private final Map<String, String> identities;

  public MachineClients(String mapping) {
    var values = new HashMap<String, String>();
    if (!mapping.isBlank())
      for (String pair : mapping.split(",")) {
        String[] parts = pair.split("=", -1);
        if (parts.length != 2
            || !Set.of(
                    "customer",
                    "workorder",
                    "booking",
                    "inventory",
                    "billing",
                    "notification",
                    "analytics")
                .contains(parts[0])
            || parts[1].isBlank()
            || values.put(parts[1], "motoros-" + parts[0]) != null)
          throw new IllegalArgumentException("Invalid or duplicate machine client mapping");
      }
    identities = Map.copyOf(values);
  }

  public String logical(String client) {
    if (client == null) return "untrusted";
    return identities.isEmpty() ? client : identities.getOrDefault(client, "untrusted");
  }
}
