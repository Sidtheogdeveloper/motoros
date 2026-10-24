package com.motoros.workorder;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class StatusTest {
  @Test
  void lifecycle() {
    var s = Status.values();
    for (int i = 0; i < 10; i++) assertTrue(s[i].canMoveTo(s[i + 1]));
  }

  @Test
  void rejectsSkippingAndTerminalTransitions() {
    assertFalse(Status.CREATED.canMoveTo(Status.DELIVERED));
    assertFalse(Status.CLOSED.canMoveTo(Status.CHECKED_IN));
    assertFalse(Status.DELIVERED.canMoveTo(Status.CANCELLED));
    assertFalse(Status.CANCELLED.canMoveTo(Status.CREATED));
  }

  @Test
  void supportsRework() {
    assertTrue(Status.QUALITY_CHECK.canMoveTo(Status.IN_PROGRESS));
    assertTrue(Status.INSPECTION.canMoveTo(Status.CANCELLED));
  }
}
