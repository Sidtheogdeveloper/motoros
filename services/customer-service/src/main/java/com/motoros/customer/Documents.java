package com.motoros.customer;

import static org.springframework.http.HttpStatus.*;

import com.motoros.security.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class Documents {
  private final Registry registry;
  private final DocumentStorage storage;
  private final org.springframework.jdbc.core.JdbcTemplate db;

  Documents(
      Registry registry, DocumentStorage storage, org.springframework.jdbc.core.JdbcTemplate db) {
    this.registry = registry;
    this.storage = storage;
    this.db = db;
  }

  static final Map<String, String> TYPES =
      Map.of("application/pdf", "pdf", "image/png", "png", "image/jpeg", "jpg");

  void target(Jwt jwt, String kind, UUID id) {
    if (kind.equals("customers")) {
      Access.require(jwt, Permission.CUSTOMER_READ);
      registry.customer(Access.tenant(jwt), id);
    } else {
      Access.require(jwt, Permission.VEHICLE_READ);
      registry.vehicle(Access.tenant(jwt), id);
    }
  }

  Map<String, Object> row(Jwt jwt, UUID id) {
    var row =
        registry.one(
            "select * from customer.documents where id=? and tenant_id=?", id, Access.tenant(jwt));
    if ("CUSTOMER_PRIVATE".equals(row.get("visibility")))
      Access.require(jwt, Permission.CUSTOMER_READ);
    if (!"AVAILABLE".equals(row.get("status")))
      throw new ResponseStatusException(NOT_FOUND, "Document not available");
    return row;
  }

  static Map<String, Object> metadata(Map<String, Object> row) {
    var out = Registry.dto(row);
    out.remove("objectKey");
    out.remove("sha256");
    return out;
  }

  @Transactional
  public Map<String, Object> begin(Jwt jwt, String kind, UUID id, DocumentController.Upload in) {
    Access.require(jwt, Permission.DOCUMENT_WRITE);
    target(jwt, kind, id);
    Access.branch(jwt, in.branchId());
    if (!TYPES.containsKey(in.contentType())
        || !in.fileName().matches("[A-Za-z0-9][A-Za-z0-9 _().-]{0,175}")
        || in.fileName().contains("..")
        || !in.sha256().matches("[a-fA-F0-9]{64}"))
      throw new ResponseStatusException(
          BAD_REQUEST, "Use a safe filename and a PDF, PNG or JPEG with a valid SHA-256 checksum");
    String ext =
        in.fileName().substring(in.fileName().lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    if (!ext.equals(TYPES.get(in.contentType()))
        && !(in.contentType().equals("image/jpeg") && ext.equals("jpeg")))
      throw new ResponseStatusException(
          BAD_REQUEST, "Filename extension and media type must agree");
    String visibility = kind.equals("customers") ? "CUSTOMER_PRIVATE" : in.visibility();
    if (!Set.of("CUSTOMER_PRIVATE", "TECHNICAL").contains(visibility))
      throw new ResponseStatusException(BAD_REQUEST, "Invalid document visibility");
    if (visibility.equals("CUSTOMER_PRIVATE")) Access.require(jwt, Permission.CUSTOMER_READ);
    UUID t = Access.tenant(jwt), doc = UUID.randomUUID();
    String key = "uploads/" + t + "/" + doc + "/" + UUID.randomUUID();
    db.update(
        "insert into"
            + " customer.documents(id,tenant_id,vehicle_id,customer_id,branch_id,object_key,file_name,content_type,byte_size,sha256,visibility,status,created_by,expires_at)"
            + " values(?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,now()+interval '5 minutes')",
        doc,
        t,
        kind.equals("vehicles") ? id : null,
        kind.equals("customers") ? id : null,
        in.branchId(),
        key,
        in.fileName(),
        in.contentType(),
        in.byteSize(),
        in.sha256().toLowerCase(Locale.ROOT),
        visibility,
        Access.user(jwt));
    var grant =
        new LinkedHashMap<>(storage.upload(key, in.contentType(), in.byteSize(), in.sha256()));
    grant.put("documentId", doc);
    registry.audit(jwt, in.branchId(), "DOCUMENT_UPLOAD_INITIATED", doc);
    return grant;
  }

  static boolean magic(String type, byte[] b) {
    if (type.equals("application/pdf"))
      return b.length >= 5
          && new String(Arrays.copyOf(b, 5), java.nio.charset.StandardCharsets.US_ASCII)
              .equals("%PDF-");
    if (type.equals("image/png"))
      return b.length >= 8
          && Arrays.equals(
              Arrays.copyOf(b, 8), new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
    return b.length >= 3 && (b[0] & 255) == 255 && (b[1] & 255) == 216 && (b[2] & 255) == 255;
  }

  @Transactional
  public Map<String, Object> complete(Jwt jwt, UUID id, Long version) {
    Access.require(jwt, Permission.DOCUMENT_WRITE);
    UUID t = Access.tenant(jwt);
    var row =
        registry.one(
            "select * from customer.documents where tenant_id=? and id=? for update", t, id);
    registry.version(row, version);
    Access.branch(jwt, (UUID) row.get("branch_id"));
    if ("CUSTOMER_PRIVATE".equals(row.get("visibility")))
      Access.require(jwt, Permission.CUSTOMER_READ);
    if (!"PENDING".equals(row.get("status"))
        || !((java.sql.Timestamp) row.get("expires_at")).toInstant().isAfter(Instant.now()))
      throw new ResponseStatusException(CONFLICT, "Upload is expired or already completed");
    byte[] bytes =
        storage.readPending(
            row.get("object_key").toString(), ((Number) row.get("byte_size")).longValue());
    String digest;
    try {
      digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    if (!digest.equals(row.get("sha256")) || !magic(row.get("content_type").toString(), bytes))
      throw new ResponseStatusException(
          BAD_REQUEST, "Document bytes do not match the declared checksum or file type");
    String finalKey = "documents/" + t + "/" + id + "/" + UUID.randomUUID();
    storage.publish(finalKey, row.get("content_type").toString(), bytes);
    db.update(
        "update customer.documents set"
            + " object_key=?,status='AVAILABLE',version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        finalKey,
        t,
        id);
    storage.removePending(row.get("object_key").toString());
    registry.audit(jwt, (UUID) row.get("branch_id"), "DOCUMENT_PUBLISHED", id);
    return metadata(
        registry.one("select * from customer.documents where tenant_id=? and id=?", t, id));
  }

  public Map<String, Object> list(Jwt jwt, String kind, UUID id, int page, int size) {
    Access.require(jwt, Permission.DOCUMENT_READ);
    target(jwt, kind, id);
    Registry.paging(page, size);
    UUID t = Access.tenant(jwt);
    boolean privateAllowed = jwt.getClaimAsStringList("permissions").contains("CUSTOMER_READ");
    String where =
        " from customer.documents where tenant_id=? and "
            + (kind.equals("vehicles") ? "vehicle_id" : "customer_id")
            + "=? and status='AVAILABLE' and (? or visibility='TECHNICAL')";
    long count = db.queryForObject("select count(*)" + where, Long.class, t, id, privateAllowed);
    return Registry.page(
        db
            .queryForList(
                "select *" + where + " order by created_at desc,id limit ? offset ?",
                t,
                id,
                privateAllowed,
                size,
                (long) page * size)
            .stream()
            .map(Documents::metadata)
            .toList(),
        count,
        size);
  }

  @Transactional
  public Map<String, Object> download(Jwt jwt, UUID id) {
    Access.require(jwt, Permission.DOCUMENT_READ);
    var row = row(jwt, id);
    registry.audit(jwt, (UUID) row.get("branch_id"), "DOCUMENT_DOWNLOAD_AUTHORIZED", id);
    return Map.of(
        "url",
        storage.download(
            row.get("object_key").toString(),
            row.get("file_name").toString(),
            row.get("content_type").toString()),
        "expiresIn",
        60);
  }

  @Transactional
  public Map<String, Object> archive(Jwt jwt, UUID id, Long version) {
    Access.require(jwt, Permission.DOCUMENT_WRITE);
    var row = row(jwt, id);
    Access.branch(jwt, (UUID) row.get("branch_id"));
    registry.version(row, version);
    int n =
        db.update(
            "update customer.documents set status='DELETED',version=version+1,updated_at=now()"
                + " where id=? and tenant_id=? and version=?",
            id,
            Access.tenant(jwt),
            version);
    if (n != 1) throw new ResponseStatusException(CONFLICT);
    registry.audit(jwt, (UUID) row.get("branch_id"), "DOCUMENT_ARCHIVED", id);
    return Map.of("ok", true);
  }
}
