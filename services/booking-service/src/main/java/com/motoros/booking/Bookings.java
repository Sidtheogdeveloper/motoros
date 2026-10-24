package com.motoros.booking;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.*;
import com.motoros.foundation.Records;
import com.motoros.security.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class Bookings {
  private final Records r;
  private final ServiceGateway gateway;
  private final String tenant, customer, workorder;
  private final TransactionTemplate tx;

  Bookings(
      JdbcTemplate db,
      ServiceTokens tokens,
      PlatformTransactionManager tm,
      @Value("${motoros.tenant-url}") String tenant,
      @Value("${motoros.customer-url}") String customer,
      @Value("${motoros.workorder-url}") String workorder) {
    r = new Records(db);
    gateway = new ServiceGateway(tokens);
    tx = new TransactionTemplate(tm);
    this.tenant = tenant;
    this.customer = customer;
    this.workorder = workorder;
  }

  Map<String, Object> row(Jwt j, UUID id) {
    Access.require(j, Permission.BOOKING_READ);
    var row =
        r.one(
            "select * from booking.appointments where tenant_id=? and id=?", Access.tenant(j), id);
    Access.branch(j, (UUID) row.get("branch_id"));
    return row;
  }

  public List<Map<String, Object>> categories(Jwt j) {
    Access.require(j, Permission.BOOKING_READ);
    return r.db.queryForList("select * from booking.service_categories order by name").stream()
        .map(Records::dto)
        .toList();
  }

  public Map<String, Object> detail(Jwt j, UUID id) {
    var result = Records.dto(row(j, id));
    result.put(
        "history",
        r
            .db
            .queryForList(
                "select * from booking.appointment_status_history where tenant_id=? and"
                    + " appointment_id=? order by created_at,id",
                Access.tenant(j),
                id)
            .stream()
            .map(Records::dto)
            .toList());
    result.remove("checkInRequest");
    result.remove("checkInKey");
    return result;
  }

  void audit(Jwt j, UUID branch, UUID id, String before, String after, String note) {
    r.db.update(
        "insert into"
            + " booking.appointment_status_history(id,tenant_id,branch_id,appointment_id,from_status,to_status,note,actor_id,correlation_id)"
            + " values(?,?,?,?,?,?,?,?,?)",
        UUID.randomUUID(),
        Access.tenant(j),
        branch,
        id,
        before,
        after,
        note,
        Access.user(j),
        Correlation.current());
  }

  Map<String, Object> branch(Jwt j, UUID id) {
    Access.branch(j, id);
    return gateway.get(j, tenant, "/api/branches/" + id + "/operations");
  }

  public Map<String, Object> availability(
      Jwt j, UUID branch, Instant start, int duration, UUID technician, UUID excluding) {
    Access.require(j, Permission.BOOKING_READ);
    var config = branch(j, branch);
    int capacity = Scheduling.validate(config, start, duration);
    Instant end = start.plusSeconds(duration * 60L);
    var intervals =
        r
            .db
            .queryForList(
                "select starts_at,ends_at from booking.appointment_capacity_reservations where"
                    + " tenant_id=? and branch_id=? and active and starts_at<? and ends_at>? and"
                    + " (?::uuid is null or appointment_id!=?::uuid)",
                Access.tenant(j),
                branch,
                Timestamp.from(end),
                Timestamp.from(start),
                excluding,
                excluding)
            .stream()
            .map(
                m ->
                    new Scheduling.Interval(
                        Records.instant(m.get("starts_at")), Records.instant(m.get("ends_at"))))
            .toList();
    boolean available = Scheduling.hasCapacity(intervals, start, end, capacity);
    if (technician != null) {
      gateway.get(
          j,
          tenant,
          "/api/staff/"
              + technician
              + "/eligibility?branchId="
              + branch
              + "&kind=TECHNICIAN&startsAt="
              + start
              + "&endsAt="
              + end);
      if (!r.db
          .queryForList(
              "select 1 from booking.appointment_capacity_reservations where tenant_id=? and"
                  + " technician_id=? and active and starts_at<? and ends_at>? and (?::uuid is null"
                  + " or appointment_id!=?::uuid) limit 1",
              Access.tenant(j),
              technician,
              Timestamp.from(end),
              Timestamp.from(start),
              excluding,
              excluding)
          .isEmpty()) available = false;
    }
    return Map.of(
        "available",
        available,
        "capacity",
        capacity,
        "startsAt",
        start,
        "endsAt",
        end,
        "timezone",
        config.get("timezone"),
        "configuration",
        config);
  }

  @Transactional
  public Map<String, Object> save(Jwt j, UUID id, BookingController.Input in, String key) {
    Access.require(j, Permission.BOOKING_WRITE);
    Access.branch(j, in.branchId());
    UUID t = Access.tenant(j);
    String op = id == null ? "BOOK_APPOINTMENT" : "RESCHEDULE_" + id;
    UUID replay = r.replay("booking", t, Access.user(j), key, op, in);
    if (replay != null) return detail(j, replay);
    r.lock("schedule" + t + in.branchId());
    if (in.assignedTechnicianId() != null)
      r.lock("schedule-technician" + t + in.assignedTechnicianId());
    Map<String, Object> previous = id == null ? null : row(j, id);
    if (previous != null) {
      Records.version(previous, in.version());
      if (!in.branchId().equals(previous.get("branch_id"))
          || !in.vehicleId().equals(previous.get("vehicle_id"))
          || !in.customerId().equals(previous.get("customer_id")))
        throw new ResponseStatusException(
            CONFLICT,
            "Branch and vehicle identity are immutable; cancel and create a new appointment");
      if (!Set.of("REQUESTED", "CONFIRMED").contains(previous.get("appointment_status"))
          || previous.get("check_in_state") != null)
        throw new ResponseStatusException(CONFLICT, "Appointment is no longer reschedulable");
    }
    if (in.requestedStartTime()
        .isBefore(Instant.now().minusSeconds(in.bookingSource().equals("WALK_IN") ? 300 : 0)))
      throw new ResponseStatusException(BAD_REQUEST, "Appointment start is in the past");
    if (in.requestedStartTime().isAfter(Instant.now().plus(Duration.ofDays(366))))
      throw new ResponseStatusException(BAD_REQUEST, "Book within the next year");
    if (!Set.of("STAFF", "PHONE", "WALK_IN").contains(in.bookingSource()))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid booking source");
    r.one("select id from booking.service_categories where id=?", in.serviceCategoryId());
    var v = gateway.get(j, customer, "/api/vehicles/" + in.vehicleId());
    var c = gateway.get(j, customer, "/api/customers/" + in.customerId());
    if (!"ACTIVE".equals(v.get("status"))
        || !"ACTIVE".equals(c.get("status"))
        || !in.customerId().toString().equals(Objects.toString(v.get("customerId"))))
      throw new ResponseStatusException(
          CONFLICT, "Active vehicle and current customer ownership required");
    var available =
        availability(
            j,
            in.branchId(),
            in.requestedStartTime(),
            in.estimatedDurationMinutes(),
            in.assignedTechnicianId(),
            id);
    if (!Boolean.TRUE.equals(available.get("available")))
      throw new ResponseStatusException(
          CONFLICT, "No capacity or technician availability for this interval");
    Instant end = in.requestedStartTime().plusSeconds(in.estimatedDurationMinutes() * 60L);
    if (id == null) {
      id = UUID.randomUUID();
      r.db.update(
          "insert into"
              + " booking.appointments(id,tenant_id,branch_id,customer_id,vehicle_id,service_category_id,requested_start_time,expected_end_time,estimated_duration_minutes,customer_complaint,appointment_status,booking_source,assigned_technician_id,registration,vehicle_model,customer_name,branch_timezone,created_by)"
              + " values(?,?,?,?,?,?,?,?,?,?,'REQUESTED',?,?,?,?,?,?,?)",
          id,
          t,
          in.branchId(),
          in.customerId(),
          in.vehicleId(),
          in.serviceCategoryId(),
          Timestamp.from(in.requestedStartTime()),
          Timestamp.from(end),
          in.estimatedDurationMinutes(),
          in.customerComplaint(),
          in.bookingSource(),
          in.assignedTechnicianId(),
          v.get("registration"),
          v.get("make") + " " + v.get("model"),
          c.get("name"),
          available.get("timezone"),
          Access.user(j));
    } else
      r.db.update(
          "update booking.appointments set"
              + " service_category_id=?,requested_start_time=?,expected_end_time=?,estimated_duration_minutes=?,customer_complaint=?,assigned_technician_id=?,branch_timezone=?,version=version+1,updated_at=now()"
              + " where tenant_id=? and id=?",
          in.serviceCategoryId(),
          Timestamp.from(in.requestedStartTime()),
          Timestamp.from(end),
          in.estimatedDurationMinutes(),
          in.customerComplaint(),
          in.assignedTechnicianId(),
          available.get("timezone"),
          t,
          id);
    r.db.update(
        "insert into"
            + " booking.appointment_capacity_reservations(appointment_id,tenant_id,branch_id,starts_at,ends_at,technician_id)"
            + " values(?,?,?,?,?,?) on conflict(appointment_id) do update set"
            + " starts_at=excluded.starts_at,ends_at=excluded.ends_at,technician_id=excluded.technician_id,updated_at=now()",
        id,
        t,
        in.branchId(),
        Timestamp.from(in.requestedStartTime()),
        Timestamp.from(end),
        in.assignedTechnicianId());
    r.db.update(
        "insert into"
            + " booking.branch_schedule_snapshots(id,tenant_id,branch_id,appointment_id,configuration)"
            + " values(?,?,?,?,?::jsonb)",
        UUID.randomUUID(),
        t,
        in.branchId(),
        id,
        Records.json(available.get("configuration")));
    audit(
        j,
        in.branchId(),
        id,
        previous == null ? null : previous.get("appointment_status").toString(),
        previous == null ? "REQUESTED" : previous.get("appointment_status").toString(),
        previous == null ? "Appointment booked" : "Rescheduled with capacity validation");
    r.remember("booking", t, Access.user(j), key, op, in, id);
    return detail(j, id);
  }

  @Transactional
  public Map<String, Object> status(Jwt j, UUID id, String next, BookingController.Change in) {
    Access.require(j, Permission.BOOKING_WRITE);
    var initial = row(j, id);
    r.lock("schedule" + Access.tenant(j) + initial.get("branch_id"));
    var old = row(j, id);
    Records.version(old, in.version());
    if (old.get("check_in_state") != null)
      throw new ResponseStatusException(CONFLICT, "Check-in coordination must be reconciled first");
    String previous = old.get("appointment_status").toString();
    if (!Scheduling.transition(previous, next))
      throw new ResponseStatusException(CONFLICT, "Invalid appointment transition");
    r.db.update(
        "update booking.appointments set appointment_status=?,version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        next,
        Access.tenant(j),
        id);
    if (Set.of("CANCELLED", "NO_SHOW").contains(next))
      r.db.update(
          "update booking.appointment_capacity_reservations set active=false,updated_at=now() where"
              + " tenant_id=? and appointment_id=?",
          Access.tenant(j),
          id);
    audit(j, (UUID) old.get("branch_id"), id, previous, next, in.note());
    return detail(j, id);
  }

  public Map<String, Object> list(
      Jwt j,
      UUID branch,
      Instant from,
      Instant until,
      boolean today,
      String status,
      UUID category,
      String q,
      int page,
      int size) {
    Access.require(j, Permission.BOOKING_READ);
    Access.branch(j, branch);
    Records.page(page, size);
    if (today) {
      var zone = ZoneId.of(branch(j, branch).get("timezone").toString());
      var date = LocalDate.now(zone);
      from = date.atStartOfDay(zone).toInstant();
      until = date.plusDays(1).atStartOfDay(zone).toInstant();
    }
    if (from == null) from = Instant.now().minus(Duration.ofDays(1));
    if (until == null) until = from.plus(Duration.ofDays(90));
    if (!until.isAfter(from) || Duration.between(from, until).toDays() > 366)
      throw new ResponseStatusException(BAD_REQUEST, "Use a bounded calendar interval");
    String where =
        " from booking.appointments where tenant_id=? and branch_id=? and requested_start_time>=?"
            + " and requested_start_time<? and (?='' or appointment_status=?) and (?::uuid is null"
            + " or service_category_id=?::uuid) and (lower(registration||' '||customer_name) like"
            + " ?)";
    var args =
        new ArrayList<Object>(
            Arrays.asList(
                Access.tenant(j),
                branch,
                Timestamp.from(from),
                Timestamp.from(until),
                status,
                status,
                category,
                category,
                "%" + q.toLowerCase(Locale.ROOT) + "%"));
    long count = r.db.queryForObject("select count(*)" + where, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    return Records.page(
        r
            .db
            .queryForList(
                "select *" + where + " order by requested_start_time,id limit ? offset ?",
                args.toArray())
            .stream()
            .map(
                row -> {
                  row.remove("check_in_key");
                  row.remove("check_in_request");
                  return row;
                })
            .toList(),
        count,
        size);
  }

  public Map<String, Object> checkin(Jwt j, UUID id, String key, Map<String, Object> incoming) {
    Access.require(j, Permission.BOOKING_WRITE);
    Access.require(j, Permission.WORKORDER_CREATE);
    Map<String, Object> prepared =
        tx.execute(
            s -> {
              var row = row(j, id);
              r.lock("schedule" + Access.tenant(j) + row.get("branch_id"));
              row = row(j, id);
              if (key == null || !key.matches("[A-Za-z0-9_-]{16,100}"))
                throw new ResponseStatusException(BAD_REQUEST, "Stable Idempotency-Key required");
              var body = new LinkedHashMap<>(incoming);
              for (String field : List.of("branchId", "customerId", "vehicleId")) {
                Object expected =
                    row.get(
                        field.equals("branchId")
                            ? "branch_id"
                            : field.equals("customerId") ? "customer_id" : "vehicle_id");
                if (body.containsKey(field)
                    && !expected.toString().equals(body.get(field).toString()))
                  throw new ResponseStatusException(
                      CONFLICT, "Appointment and intake identity mismatch");
                body.put(field, expected.toString());
              }
              body.put("appointmentId", id.toString());
              if (row.get("check_in_request") != null
                  && !Records.object(row.get("check_in_request")).equals(body))
                throw new ResponseStatusException(
                    CONFLICT, "Pending intake differs; reconcile the existing request first");
              if (row.get("check_in_id") != null) return row;
              if (!"CONFIRMED".equals(row.get("appointment_status")))
                throw new ResponseStatusException(
                    CONFLICT, "Confirm the appointment before check-in");
              r.db.update(
                  "update booking.appointments set"
                      + " check_in_state='PENDING',check_in_key=?,check_in_request=?::jsonb,updated_at=now()"
                      + " where tenant_id=? and id=?",
                  row.get("check_in_key") == null ? key : row.get("check_in_key"),
                  Records.json(body),
                  Access.tenant(j),
                  id);
              return row(j, id);
            });
    if (prepared.get("check_in_id") != null) return detail(j, id);
    try {
      var result =
          gateway.post(
              j,
              workorder,
              "/api/check-ins",
              Records.object(prepared.get("check_in_request")),
              prepared.get("check_in_key").toString());
      tx.executeWithoutResult(
          s -> {
            r.lock("schedule" + Access.tenant(j) + prepared.get("branch_id"));
            var current = row(j, id);
            if (current.get("check_in_id") == null) {
              r.db.update(
                  "update booking.appointments set"
                      + " appointment_status='CHECKED_IN',check_in_state='COMPLETE',check_in_id=?,work_order_id=?,last_error_status=null,version=version+1,updated_at=now()"
                      + " where tenant_id=? and id=?",
                  Records.uuid(result.get("id")),
                  Records.uuid(result.get("workOrderId")),
                  Access.tenant(j),
                  id);
              audit(
                  j,
                  (UUID) prepared.get("branch_id"),
                  id,
                  "CONFIRMED",
                  "CHECKED_IN",
                  "Vehicle intake committed and reconciled");
            }
          });
      return detail(j, id);
    } catch (ResponseStatusException e) {
      tx.executeWithoutResult(
          s ->
              r.db.update(
                  "update booking.appointments set"
                      + " check_in_state='RETRY_REQUIRED',last_error_status=?,updated_at=now()"
                      + " where tenant_id=? and id=?",
                  e.getStatusCode().value(),
                  Access.tenant(j),
                  id));
      throw e;
    }
  }

  public Map<String, Object> reconcile(Jwt j, UUID id) {
    Access.require(j, Permission.BOOKING_WRITE);
    var row = row(j, id);
    if (row.get("check_in_request") != null && row.get("check_in_id") == null)
      return checkin(
          j, id, row.get("check_in_key").toString(), Records.object(row.get("check_in_request")));
    if (row.get("work_order_id") != null && "CHECKED_IN".equals(row.get("appointment_status"))) {
      var job = gateway.get(j, workorder, "/api/work-orders/" + row.get("work_order_id"));
      if (Set.of("DELIVERED", "CLOSED", "CANCELLED").contains(job.get("status")))
        tx.executeWithoutResult(
            s -> {
              r.lock("schedule" + Access.tenant(j) + row.get("branch_id"));
              var current = row(j, id);
              if ("CHECKED_IN".equals(current.get("appointment_status"))) {
                r.db.update(
                    "update booking.appointments set"
                        + " appointment_status=?,version=version+1,updated_at=now() where"
                        + " tenant_id=? and id=?",
                    "CANCELLED".equals(job.get("status")) ? "CANCELLED" : "COMPLETED",
                    Access.tenant(j),
                    id);
                r.db.update(
                    "update booking.appointment_capacity_reservations set"
                        + " active=false,updated_at=now() where tenant_id=? and appointment_id=?",
                    Access.tenant(j),
                    id);
                audit(
                    j,
                    (UUID) row.get("branch_id"),
                    id,
                    "CHECKED_IN",
                    "CANCELLED".equals(job.get("status")) ? "CANCELLED" : "COMPLETED",
                    "Verified terminal Work Order API state");
              }
            });
    }
    return detail(j, id);
  }
}
