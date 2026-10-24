package com.motoros.customer;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class Registry {
  final JdbcTemplate db;

  public Registry(JdbcTemplate db) {
    this.db = db;
  }

  static String clean(String s) {
    return s == null ? "" : s.trim();
  }

  static String email(String s) {
    return clean(s).toLowerCase(Locale.ROOT);
  }

  static String phone(String s, String country) {
    String n = clean(s).replaceAll("[^0-9]", "");
    if (n.startsWith("00")) n = n.substring(2);
    return Set.of("India", "IN").contains(country) && n.length() == 10 ? "91" + n : n;
  }

  static String registration(String s) {
    return clean(s).toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
  }

  static void paging(int page, int size) {
    if (page < 0 || page > 100000 || size < 1 || size > 100)
      throw new ResponseStatusException(BAD_REQUEST, "Page must be non-negative and size 1-100");
  }

  static Map<String, Object> dto(Map<String, Object> row) {
    var out = new LinkedHashMap<String, Object>();
    row.forEach(
        (k, v) -> {
          var parts = k.split("_");
          String key = parts[0];
          for (int i = 1; i < parts.length; i++)
            key += Character.toUpperCase(parts[i].charAt(0)) + parts[i].substring(1);
          if (v instanceof Timestamp t) v = t.toInstant().toString();
          out.put(key, v);
        });
    return out;
  }

  Map<String, Object> one(String sql, Object... args) {
    var rows = db.queryForList(sql, args);
    if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "Record not found");
    return rows.getFirst();
  }

  void lock(UUID tenant) {
    db.queryForObject(
        "select pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, tenant.toString());
  }

  void version(Map<String, Object> row, Long expected) {
    if (expected == null || ((Number) row.get("version")).longValue() != expected)
      throw new ResponseStatusException(CONFLICT, "Record changed. Refresh before saving.");
  }

  Map<String, Object> customer(UUID tenant, UUID id) {
    return one("select * from customer.customers where tenant_id=? and id=?", tenant, id);
  }

  Map<String, Object> vehicle(UUID tenant, UUID id) {
    return one("select * from customer.vehicles where tenant_id=? and id=?", tenant, id);
  }

  void activeCustomer(UUID tenant, UUID id) {
    if (!"ACTIVE".equals(customer(tenant, id).get("status")))
      throw new ResponseStatusException(CONFLICT, "Customer is inactive");
  }

  void audit(Jwt jwt, UUID branch, String action, UUID target) {
    db.update(
        "insert into"
            + " customer.registry_audit(id,tenant_id,actor_id,branch_id,action,target_id,outcome,correlation_id)"
            + " values(?,?,?,?,?,?,'SUCCESS',?)",
        UUID.randomUUID(),
        Access.tenant(jwt),
        Access.user(jwt),
        branch,
        action,
        target,
        Correlation.current());
  }

  Map<String, Object> vehicleDto(Jwt jwt, Map<String, Object> row) {
    var result = dto(row);
    if (!jwt.getClaimAsStringList("permissions").contains("CUSTOMER_READ"))
      result.remove("customerId");
    return result;
  }

  static Map<String, Object> page(List<Map<String, Object>> rows, long count, int size) {
    return Map.of("content", rows, "totalElements", count, "totalPages", (count + size - 1) / size);
  }

  public List<Map<String, Object>> duplicates(
      UUID tenant, String e, String p, String country, UUID exclude) {
    e = email(e);
    p = phone(p, country);
    if (e.isEmpty() && p.isEmpty()) return List.of();
    return db
        .queryForList(
            "select c.id,c.name,c.email,c.phone from customer.customers c where c.tenant_id=? and"
                + " (?::uuid is null or c.id!=?::uuid) and ((?!='' and c.normalized_email=?) or"
                + " (?!='' and c.normalized_phone=?) or exists(select 1 from"
                + " customer.customer_contacts x where x.tenant_id=c.tenant_id and"
                + " x.customer_id=c.id and x.status='ACTIVE' and ((x.kind='EMAIL' and ?!='' and"
                + " x.normalized_value=?) or(x.kind='PHONE' and ?!='' and x.normalized_value=?))))"
                + " order by c.id limit 20",
            tenant,
            exclude,
            exclude,
            e,
            e,
            p,
            p,
            e,
            e,
            p,
            p)
        .stream()
        .map(Registry::dto)
        .toList();
  }

  @Transactional
  public Map<String, Object> saveCustomer(Jwt jwt, UUID id, CustomerController.CustomerInput in) {
    Access.require(jwt, Permission.CUSTOMER_WRITE);
    UUID t = Access.tenant(jwt);
    lock(t);
    String country = clean(in.country()).isEmpty() ? "India" : in.country();
    var existing = id == null ? null : customer(t, id);
    if (existing != null) version(existing, in.version());
    boolean contactChanged =
        existing == null
            || !email(Objects.toString(existing.get("email"), "")).equals(email(in.email()))
            || !phone(
                    Objects.toString(existing.get("phone"), ""), existing.get("country").toString())
                .equals(phone(in.phone(), country));
    if (contactChanged
        && !duplicates(t, in.email(), in.phone(), country, id).isEmpty()
        && clean(in.duplicateReason()).length() < 10)
      throw new ResponseStatusException(
          CONFLICT,
          "Possible duplicate contact. Review matches; provide a reason of at least 10 characters"
              + " to create a separate record.");
    String status = clean(in.status()).isEmpty() ? "ACTIVE" : in.status();
    if (!clean(in.phone()).isEmpty() && !phone(in.phone(), country).matches("[0-9]{7,15}"))
      throw new ResponseStatusException(BAD_REQUEST, "Enter a valid contact number");
    if (!Set.of("ACTIVE", "INACTIVE").contains(status))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid customer status");
    if (id == null) {
      id = UUID.randomUUID();
      db.update(
          "insert into"
              + " customer.customers(id,tenant_id,name,email,phone,address,city,country,status,created_at)"
              + " values(?,?,?,?,?,?,?,?,?,now())",
          id,
          t,
          in.name().trim(),
          email(in.email()),
          clean(in.phone()),
          in.address(),
          in.city(),
          country,
          status);
    } else {
      var row = customer(t, id);
      version(row, in.version());
      db.update(
          "update customer.customers set"
              + " name=?,email=?,phone=?,address=?,city=?,country=?,status=?,version=version+1,updated_at=now()"
              + " where tenant_id=? and id=?",
          in.name().trim(),
          email(in.email()),
          clean(in.phone()),
          in.address(),
          in.city(),
          country,
          status,
          t,
          id);
    }
    if (!clean(in.duplicateReason()).isEmpty())
      db.update(
          "update customer.customers set duplicate_review_reason=? where tenant_id=? and id=?",
          in.duplicateReason(),
          t,
          id);
    audit(
        jwt,
        null,
        clean(in.duplicateReason()).isEmpty() ? "CUSTOMER_SAVED" : "CUSTOMER_DUPLICATE_REVIEWED",
        id);
    return dto(customer(t, id));
  }

  public Map<String, Object> customers(Jwt jwt, String q, String status, int page, int size) {
    Access.require(jwt, Permission.CUSTOMER_READ);
    paging(page, size);
    UUID t = Access.tenant(jwt);
    String term = "%" + clean(q).toLowerCase(Locale.ROOT) + "%";
    String where =
        " from customer.customers c where c.tenant_id=? and (?='' or c.status=?) and (lower(c.name)"
            + " like ? or c.normalized_email like ? or c.normalized_phone like ? or exists(select 1"
            + " from customer.customer_contacts x where x.tenant_id=c.tenant_id and"
            + " x.customer_id=c.id and x.status='ACTIVE' and lower(x.value) like ?))";
    var args =
        new ArrayList<Object>(
            List.of(
                t, clean(status), clean(status), term, term, "%" + phone(q, "India") + "%", term));
    if (clean(q).isEmpty()) args.set(5, term);
    else if (phone(q, "India").isEmpty()) args.set(5, "!not-a-phone!");
    long count = db.queryForObject("select count(*)" + where, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    return page(
        db
            .queryForList(
                "select c.*" + where + " order by c.created_at desc,c.id limit ? offset ?",
                args.toArray())
            .stream()
            .map(Registry::dto)
            .toList(),
        count,
        size);
  }

  @Transactional
  public Map<String, Object> saveVehicle(Jwt jwt, UUID id, CustomerController.VehicleInput in) {
    Access.require(jwt, Permission.VEHICLE_WRITE);
    UUID t = Access.tenant(jwt);
    lock(t);
    String reg = registration(in.registration()), vin = clean(in.vin()).toUpperCase(Locale.ROOT);
    if (!reg.matches("[A-Z0-9]{3,24}") || (!vin.isEmpty() && !vin.matches("[A-HJ-NPR-Z0-9]{17}")))
      throw new ResponseStatusException(
          BAD_REQUEST, "Enter a valid registration and 17-character VIN without I, O or Q");
    if (in.year() != null && (in.year() < 1900 || in.year() > Year.now().getValue() + 1))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid model year");
    var matches =
        db.queryForList(
            "select id from customer.vehicles where tenant_id=? and (?::uuid is null or"
                + " id!=?::uuid) and (normalized_registration=? or (?!='' and vin=?))",
            t,
            id,
            id,
            reg,
            vin,
            vin);
    if (!matches.isEmpty())
      throw new ResponseStatusException(
          CONFLICT,
          "A vehicle with this registration or VIN already exists. Review the existing record;"
              + " vehicles are never automatically merged.");
    String status = clean(in.status()).isEmpty() ? "ACTIVE" : in.status();
    if (!Set.of("ACTIVE", "INACTIVE").contains(status))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid vehicle status");
    if (in.branchId() != null) Access.branch(jwt, in.branchId());
    if (id == null) {
      Access.require(jwt, Permission.CUSTOMER_READ);
      Access.require(jwt, Permission.VEHICLE_OWNERSHIP_WRITE);
      activeCustomer(t, in.customerId());
      id = UUID.randomUUID();
      db.update(
          "insert into"
              + " customer.vehicles(id,tenant_id,customer_id,registration,make,model,vin,year,fuel_type,color,status,registration_branch_id,created_at)"
              + " values(?,?,?,?,?,?,?,?,?,?,?,?,now())",
          id,
          t,
          in.customerId(),
          in.registration().trim().toUpperCase(Locale.ROOT),
          in.make().trim(),
          in.model().trim(),
          vin.isEmpty() ? null : vin,
          in.year(),
          in.fuelType(),
          in.color(),
          status,
          in.branchId());
      db.update(
          "insert into"
              + " customer.vehicle_ownerships(id,tenant_id,vehicle_id,customer_id,started_at,reason,actor_id)"
              + " values(?,?,?,?,now(),'Initial registration',?)",
          UUID.randomUUID(),
          t,
          id,
          in.customerId(),
          Access.user(jwt));
    } else {
      var row = vehicle(t, id);
      version(row, in.version());
      if (!row.get("customer_id").equals(in.customerId()))
        throw new ResponseStatusException(
            CONFLICT, "Use the audited ownership transfer endpoint to change owner");
      db.update(
          "update customer.vehicles set"
              + " registration=?,make=?,model=?,vin=?,year=?,fuel_type=?,color=?,status=?,identifier_conflict=false,version=version+1,updated_at=now()"
              + " where tenant_id=? and id=?",
          in.registration().trim().toUpperCase(Locale.ROOT),
          in.make().trim(),
          in.model().trim(),
          vin.isEmpty() ? null : vin,
          in.year(),
          in.fuelType(),
          in.color(),
          status,
          t,
          id);
    }
    audit(jwt, in.branchId(), "VEHICLE_SAVED", id);
    return vehicleDto(jwt, vehicle(t, id));
  }

  public Map<String, Object> vehicles(
      Jwt jwt, String q, String status, UUID owner, int page, int size) {
    Access.require(jwt, Permission.VEHICLE_READ);
    if (owner != null) Access.require(jwt, Permission.CUSTOMER_READ);
    paging(page, size);
    UUID t = Access.tenant(jwt);
    String term = "%" + clean(q).toUpperCase(Locale.ROOT) + "%", reg = "%" + registration(q) + "%";
    if (!clean(q).isEmpty() && registration(q).isEmpty()) reg = "!invalid!";
    String where =
        " from customer.vehicles where tenant_id=? and (?='' or status=?) and (?::uuid is null or"
            + " customer_id=?::uuid) and (normalized_registration like ? or vin like ? or"
            + " upper(make||' '||model) like ?)";
    var args =
        new ArrayList<Object>(
            Arrays.asList(t, clean(status), clean(status), owner, owner, reg, term, term));
    long count = db.queryForObject("select count(*)" + where, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    return page(
        db
            .queryForList(
                "select *" + where + " order by created_at desc,id limit ? offset ?",
                args.toArray())
            .stream()
            .map(row -> vehicleDto(jwt, row))
            .toList(),
        count,
        size);
  }

  @Transactional
  public Map<String, Object> transfer(
      Jwt jwt, UUID id, UUID next, Long version, String reason, UUID branch) {
    Access.require(jwt, Permission.VEHICLE_OWNERSHIP_WRITE);
    Access.require(jwt, Permission.CUSTOMER_READ);
    Access.branch(jwt, branch);
    UUID t = Access.tenant(jwt);
    lock(t);
    var v = vehicle(t, id);
    version(v, version);
    activeCustomer(t, next);
    if (next.equals(v.get("customer_id")))
      throw new ResponseStatusException(CONFLICT, "This customer is already the current owner");
    if (!"ACTIVE".equals(v.get("status")))
      throw new ResponseStatusException(CONFLICT, "Vehicle is inactive");
    db.update(
        "update customer.vehicle_ownerships set ended_at=now() where tenant_id=? and vehicle_id=?"
            + " and ended_at is null",
        t,
        id);
    db.update(
        "insert into"
            + " customer.vehicle_ownerships(id,tenant_id,vehicle_id,customer_id,started_at,reason,actor_id)"
            + " values(?,?,?,?,now(),?,?)",
        UUID.randomUUID(),
        t,
        id,
        next,
        reason,
        Access.user(jwt));
    db.update(
        "update customer.vehicles set customer_id=?,version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        next,
        t,
        id);
    audit(jwt, branch, "VEHICLE_OWNERSHIP_CHANGED", id);
    return vehicleDto(jwt, vehicle(t, id));
  }

  public Map<String, Object> ownerships(Jwt jwt, UUID id, int page, int size) {
    Access.require(jwt, Permission.VEHICLE_OWNERSHIP_READ);
    Access.require(jwt, Permission.CUSTOMER_READ);
    UUID t = Access.tenant(jwt);
    vehicle(t, id);
    paging(page, size);
    long count =
        db.queryForObject(
            "select count(*) from customer.vehicle_ownerships where tenant_id=? and vehicle_id=?",
            Long.class,
            t,
            id);
    return page(
        db
            .queryForList(
                "select o.*,c.name as customer_name from customer.vehicle_ownerships o join"
                    + " customer.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id"
                    + " where o.tenant_id=? and o.vehicle_id=? order by o.started_at desc,o.id"
                    + " limit ? offset ?",
                t,
                id,
                size,
                (long) page * size)
            .stream()
            .map(Registry::dto)
            .toList(),
        count,
        size);
  }

  @Transactional
  public Map<String, Object> odometer(Jwt jwt, UUID id, long km, UUID branch, String note,UUID reference) {
    Access.require(jwt, Permission.VEHICLE_ODOMETER_WRITE);
    Access.branch(jwt, branch);
    UUID t = Access.tenant(jwt);
    lock(t);
    var v = vehicle(t, id);
    if (!"ACTIVE".equals(v.get("status")))
      throw new ResponseStatusException(CONFLICT, "Vehicle is inactive");
    if(reference!=null){var old=db.queryForList("select * from customer.odometer_records where tenant_id=? and external_reference=?",t,reference);if(!old.isEmpty()){var row=old.getFirst();if(!id.equals(row.get("vehicle_id"))||!branch.equals(row.get("branch_id"))||km!=((Number)row.get("kilometers")).longValue())throw new ResponseStatusException(CONFLICT,"Odometer coordination key mismatch");return dto(row);}}
    Long last =
        db.queryForObject(
            "select max(kilometers) from customer.odometer_records where tenant_id=? and"
                + " vehicle_id=?",
            Long.class,
            t,
            id);
    if (last != null && km < last)
      throw new ResponseStatusException(
          CONFLICT, "Odometer cannot decrease. Correction requires a separate reviewed procedure.");
    UUID record = UUID.randomUUID();
    db.update(
        "insert into"
            + " customer.odometer_records(id,tenant_id,vehicle_id,branch_id,kilometers,recorded_at,actor_id,note,external_reference)"
            + " values(?,?,?,?,?,now(),?,?,?)",
        record,
        t,
        id,
        branch,
        km,
        Access.user(jwt),
        note,reference);
    audit(jwt, branch, "ODOMETER_RECORDED", id);
    return dto(
        one("select * from customer.odometer_records where id=? and tenant_id=?", record, t));
  }

  public Map<String, Object> readings(Jwt jwt, UUID id, int page, int size) {
    Access.require(jwt, Permission.VEHICLE_READ);
    UUID t = Access.tenant(jwt);
    vehicle(t, id);
    paging(page, size);
    long n =
        db.queryForObject(
            "select count(*) from customer.odometer_records where tenant_id=? and vehicle_id=?",
            Long.class,
            t,
            id);
    return page(
        db
            .queryForList(
                "select * from customer.odometer_records where tenant_id=? and vehicle_id=? order"
                    + " by recorded_at desc,id limit ? offset ?",
                t,
                id,
                size,
                (long) page * size)
            .stream()
            .map(Registry::dto)
            .toList(),
        n,
        size);
  }

  @Transactional
  public Map<String, Object> contact(Jwt jwt, UUID id, CustomerController.Contact in) {
    Access.require(jwt, Permission.CUSTOMER_WRITE);
    UUID t = Access.tenant(jwt);
    lock(t);
    var c = customer(t, id);
    String kind = in.kind(),
        value =
            kind.equals("EMAIL")
                ? email(in.value())
                : phone(in.value(), c.get("country").toString());
    if (!Set.of("EMAIL", "PHONE").contains(kind)
        || value.isBlank()
        || (kind.equals("EMAIL") && !value.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))
        || (kind.equals("PHONE") && !value.matches("[0-9]{7,15}")))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid contact");
    if (!duplicates(
                t,
                kind.equals("EMAIL") ? value : null,
                kind.equals("PHONE") ? value : null,
                c.get("country").toString(),
                id)
            .isEmpty()
        && clean(in.duplicateReason()).length() < 10)
      throw new ResponseStatusException(
          CONFLICT, "Contact matches another customer; review and provide a reason");
    UUID contact = UUID.randomUUID();
    db.update(
        "insert into"
            + " customer.customer_contacts(id,tenant_id,customer_id,kind,label,value,normalized_value)"
            + " values(?,?,?,?,?,?,?)",
        contact,
        t,
        id,
        kind,
        in.label(),
        in.value().trim(),
        value);
    db.update(
        "update customer.customer_contacts set review_reason=? where tenant_id=? and id=?",
        in.duplicateReason(),
        t,
        contact);
    audit(jwt, null, "CUSTOMER_CONTACT_ADDED", id);
    return dto(
        one("select * from customer.customer_contacts where id=? and tenant_id=?", contact, t));
  }

  public List<Map<String, Object>> contacts(Jwt jwt, UUID id) {
    Access.require(jwt, Permission.CUSTOMER_READ);
    UUID t = Access.tenant(jwt);
    customer(t, id);
    return db
        .queryForList(
            "select * from customer.customer_contacts where tenant_id=? and customer_id=? and"
                + " status='ACTIVE' order by created_at,id",
            t,
            id)
        .stream()
        .map(Registry::dto)
        .toList();
  }

  @Transactional
  public void removeContact(Jwt jwt, UUID id, UUID contact, Long version) {
    Access.require(jwt, Permission.CUSTOMER_WRITE);
    UUID t = Access.tenant(jwt);
    var row =
        one(
            "select * from customer.customer_contacts where tenant_id=? and customer_id=? and id=?"
                + " for update",
            t,
            id,
            contact);
    version(row, version);
    db.update(
        "update customer.customer_contacts set status='INACTIVE',version=version+1,updated_at=now()"
            + " where tenant_id=? and id=?",
        t,
        contact);
    audit(jwt, null, "CUSTOMER_CONTACT_REMOVED", id);
  }

  public Map<String, Object> auditTrail(Jwt jwt, String kind, UUID id, int page, int size) {
    Access.require(jwt, Permission.CUSTOMER_READ);
    UUID t = Access.tenant(jwt);
    if (kind.equals("vehicles")) vehicle(t, id);
    else customer(t, id);
    paging(page, size);
    long n =
        db.queryForObject(
            "select count(*) from customer.registry_audit where tenant_id=? and target_id=?",
            Long.class,
            t,
            id);
    return page(
        db
            .queryForList(
                "select * from customer.registry_audit where tenant_id=? and target_id=? order by"
                    + " created_at desc,id limit ? offset ?",
                t,
                id,
                size,
                (long) page * size)
            .stream()
            .map(Registry::dto)
            .toList(),
        n,
        size);
  }
}
