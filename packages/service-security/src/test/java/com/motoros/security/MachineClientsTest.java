package com.motoros.security;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class MachineClientsTest {
  @Test
  void providerIdsAreMappedWithoutAcceptingLegacyAliases() {
    var clients = new MachineClients("notification=generatedN,analytics=generatedA");
    assertEquals("motoros-notification", clients.logical("generatedN"));
    assertEquals("motoros-analytics", clients.logical("generatedA"));
    assertEquals("untrusted", clients.logical("motoros-notification"));
    assertEquals("untrusted", clients.logical(null));
  }

  @Test
  void invalidOrAmbiguousMappingFailsClosed() {
    assertThrows(
        IllegalArgumentException.class, () -> new MachineClients("notification=x,analytics=x"));
    assertThrows(IllegalArgumentException.class, () -> new MachineClients("administrator=x"));
    assertEquals("motoros-notification", new MachineClients("").logical("motoros-notification"));
  }
}
