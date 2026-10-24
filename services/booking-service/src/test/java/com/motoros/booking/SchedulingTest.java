package com.motoros.booking;

import static org.junit.jupiter.api.Assertions.*;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class SchedulingTest {
  @Test
  void capacityCountsConcurrentIntervalsRatherThanAllOverlaps() {
    Instant start = Instant.parse("2026-10-25T09:00:00Z");
    assertTrue(
        Scheduling.hasCapacity(
            List.of(
                new Scheduling.Interval(start, start.plusSeconds(1800)),
                new Scheduling.Interval(start.plusSeconds(1800), start.plusSeconds(3600))),
            start,
            start.plusSeconds(3600),
            2));
    assertFalse(
        Scheduling.hasCapacity(
            List.of(
                new Scheduling.Interval(start, start.plusSeconds(3600)),
                new Scheduling.Interval(start, start.plusSeconds(3600))),
            start,
            start.plusSeconds(3600),
            2));
  }

  @Test
  void cancelledAppointmentsCannotBeCheckedIn() {
    assertFalse(Scheduling.transition("CANCELLED", "CHECKED_IN"));
    assertTrue(Scheduling.transition("CONFIRMED", "CHECKED_IN"));
    assertFalse(Scheduling.transition("CHECKED_IN", "CANCELLED"));
  }

  @Test
  void branchZoneHoursAndClosuresApply() {
    var branch = new HashMap<String, Object>();
    branch.put("status", "ACTIVE");
    branch.put("timezone", "Asia/Kolkata");
    branch.put("settings", Map.of("appointmentCapacity", 3));
    branch.put("operatingHours", Map.of("SUNDAY", Map.of("open", "09:00", "close", "18:00")));
    assertEquals(3, Scheduling.validate(branch, Instant.parse("2026-10-25T04:00:00Z"), 60));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> Scheduling.validate(branch, Instant.parse("2026-10-25T01:00:00Z"), 60));
    branch.put("settings", Map.of("closedDates", List.of("2026-10-25")));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> Scheduling.validate(branch, Instant.parse("2026-10-25T04:00:00Z"), 60));
  }
}
