package com.motoros.foundation;

import static org.springframework.http.HttpStatus.*;

import com.fasterxml.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

public class Records {
  public final JdbcTemplate db;
  public static final ObjectMapper JSON =
      new ObjectMapper()
          .findAndRegisterModules()
          .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

  public Records(JdbcTemplate db) {
    this.db = db;
  }

  public Map<String, Object> one(String sql, Object... args) {
    var rows = db.queryForList(sql, args);
    if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "Record not found");
    return rows.getFirst();
  }

  public static Map<String, Object> dto(Map<String, Object> row) {
    var out = new LinkedHashMap<String, Object>();
    row.forEach(
        (k, v) -> {
          var parts = k.split("_");
          String key = parts[0];
          for (int i = 1; i < parts.length; i++)
            key += Character.toUpperCase(parts[i].charAt(0)) + parts[i].substring(1);
          if (v instanceof Timestamp t) v = t.toInstant().toString();
          if (v != null && v.getClass().getName().equals("org.postgresql.util.PGobject"))
            try {
              v = JSON.readValue(v.toString(), Object.class);
            } catch (Exception e) {
              throw new IllegalStateException(e);
            }
          out.put(key, v);
        });
    return out;
  }

  public static String json(Object value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid request data");
    }
  }

  public static Map<String, Object> object(Object value) {
    if (value instanceof Map<?, ?> m) return (Map<String, Object>) m;
    if (value instanceof JsonNode node) return JSON.convertValue(node, Map.class);
    try {
      return JSON.readValue(value.toString(), Map.class);
    } catch (Exception e) {
      throw new IllegalStateException("Invalid stored data");
    }
  }

  public static UUID uuid(Object value) {
    return value instanceof UUID u ? u : UUID.fromString(value.toString());
  }

  public static Instant instant(Object value) {
    return value instanceof Timestamp t
        ? t.toInstant()
        : value instanceof Instant i ? i : Instant.parse(value.toString());
  }

  public static void version(Map<String, Object> row, Long expected) {
    if (expected == null || ((Number) row.get("version")).longValue() != expected)
      throw new ResponseStatusException(CONFLICT, "Record changed. Refresh before retrying.");
  }

  public static void page(int page, int size) {
    if (page < 0 || page > 100000 || size < 1 || size > 100)
      throw new ResponseStatusException(BAD_REQUEST, "Invalid page; size must be 1-100");
  }

  public static Map<String, Object> page(List<Map<String, Object>> rows, long count, int size) {
    return Map.of(
        "content",
        rows.stream().map(Records::dto).toList(),
        "totalElements",
        count,
        "totalPages",
        (count + size - 1) / size);
  }

  public void lock(String scope) {
    db.queryForObject("select pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, scope);
  }

  public UUID replay(
      String schema, UUID tenant, UUID actor, String key, String operation, Object request) {
    if (key == null || !key.matches("[A-Za-z0-9_-]{16,100}"))
      throw new ResponseStatusException(
          BAD_REQUEST, "A stable 16-100 character Idempotency-Key is required");
    if (!schema.matches("[a-z]+")) throw new IllegalArgumentException();
    lock(schema + tenant + actor + key + operation);
    String hash = hash(request);
    var rows =
        db.queryForList(
            "select * from "
                + schema
                + ".operation_keys where tenant_id=? and actor_id=? and request_key=? and"
                + " operation=?",
            tenant,
            actor,
            key,
            operation);
    if (rows.isEmpty()) return null;
    var row = rows.getFirst();
    if (!hash.equals(row.get("request_hash")))
      throw new ResponseStatusException(
          CONFLICT, "Idempotency key was already used for different input");
    return uuid(row.get("resource_id"));
  }

  public void remember(
      String schema,
      UUID tenant,
      UUID actor,
      String key,
      String operation,
      Object request,
      UUID resource) {
    db.update(
        "insert into "
            + schema
            + ".operation_keys(tenant_id,actor_id,request_key,operation,request_hash,resource_id)"
            + " values(?,?,?,?,?,?)",
        tenant,
        actor,
        key,
        operation,
        hash(request),
        resource);
  }

  static String hash(Object request) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(json(request).getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
