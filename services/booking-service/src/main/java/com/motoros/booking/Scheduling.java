package com.motoros.booking;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import java.time.*;
import java.util.*;
import org.springframework.web.server.ResponseStatusException;

public final class Scheduling {
  private Scheduling() {}

  public static int validate(Map<String, Object> branch, Instant start, int duration) {
    if (start == null || duration < 15 || duration > 480)
      throw new ResponseStatusException(BAD_REQUEST, "Duration must be 15-480 minutes");
    if (!"ACTIVE".equals(branch.get("status")))
      throw new ResponseStatusException(CONFLICT, "Branch is inactive");
    ZoneId zone = ZoneId.of(branch.get("timezone").toString());
    var local = start.atZone(zone);
    var end = start.plusSeconds(duration * 60L).atZone(zone);
    var settings = Records.object(branch.get("settings"));
    var closures = settings.get("closedDates");
    if (closures instanceof List<?> dates
        && (dates.contains(local.toLocalDate().toString())
            || dates.contains(end.minusNanos(1).toLocalDate().toString())))
      throw new ResponseStatusException(CONFLICT, "Branch is closed on this date");
    var hours = Records.object(branch.get("operatingHours"));
    boolean open = false;
    for (var date : List.of(local.toLocalDate().minusDays(1), local.toLocalDate())) {
      Object config = hours.get(date.getDayOfWeek().name());
      if (!(config instanceof Map<?, ?> entry) || Boolean.TRUE.equals(entry.get("closed")))
        continue;
      try {
        LocalTime begin = LocalTime.parse(entry.get("open").toString()),
            close = LocalTime.parse(entry.get("close").toString());
        if (begin.equals(close)) continue;
        var from = date.atTime(begin).atZone(zone);
        var until = (close.isAfter(begin) ? date : date.plusDays(1)).atTime(close).atZone(zone);
        if (!local.isBefore(from) && !end.isAfter(until)) open = true;
      } catch (Exception ignored) {
        throw new ResponseStatusException(
            CONFLICT, "Branch opening hours need manager configuration");
      }
    }
    if (!open)
      throw new ResponseStatusException(
          CONFLICT, "Appointment is outside configured branch opening hours");
    Object configured =
        settings.getOrDefault("appointmentCapacity", settings.getOrDefault("serviceBays", 1));
    if (!(configured instanceof Number n) || n.intValue() < 1 || n.intValue() > 100)
      throw new ResponseStatusException(CONFLICT, "Invalid branch appointment capacity");
    return n.intValue();
  }

  public static boolean hasCapacity(
      List<Interval> existing, Instant start, Instant end, int capacity) {
    var events = new ArrayList<Event>();
    events.add(new Event(start, 1));
    events.add(new Event(end, -1));
    for (var interval : existing) {
      if (interval.start().isBefore(end) && interval.end().isAfter(start)) {
        events.add(new Event(interval.start().isBefore(start) ? start : interval.start(), 1));
        events.add(new Event(interval.end().isAfter(end) ? end : interval.end(), -1));
      }
    }
    events.sort(Comparator.comparing(Event::at).thenComparingInt(Event::delta));
    int count = 0;
    for (var event : events) {
      count += event.delta();
      if (count > capacity) return false;
    }
    return true;
  }

  public record Interval(Instant start, Instant end) {}

  private record Event(Instant at, int delta) {}

  public static boolean transition(String from, String to) {
    return switch (from) {
      case "REQUESTED" -> Set.of("CONFIRMED", "CANCELLED", "NO_SHOW").contains(to);
      case "CONFIRMED" -> Set.of("CHECKED_IN", "CANCELLED", "NO_SHOW").contains(to);
      case "CHECKED_IN" -> to.equals("COMPLETED");
      default -> false;
    };
  }
}
