package com.motoros.workorder;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import com.motoros.storage.PrivateObjects;
import jakarta.validation.*;
import jakarta.validation.constraints.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/work-orders/{id}/photos")
@Transactional
public class PhotoController {
  private final Records r;
  private final WorkshopController jobs;
  private final PrivateObjects objects;

  PhotoController(JdbcTemplate db, WorkshopController jobs, PrivateObjects objects) {
    r = new Records(db);
    this.jobs = jobs;
    this.objects = objects;
  }

  public record Upload(
      @NotBlank
          @Pattern(regexp = "FRONT|REAR|LEFT|RIGHT|DASHBOARD|DAMAGE|COMPLAINT|INSPECTION|REPAIR")
          String label,
      @NotBlank @Size(max = 180) String fileName,
      @NotBlank @Pattern(regexp = "image/png|image/jpeg") String contentType,
      @Min(1) @Max(10485760) long byteSize,
      @NotBlank @Pattern(regexp = "[a-fA-F0-9]{64}") String sha256) {}

  public record Complete(@NotNull @Min(0) Long version) {}

  @PostMapping
  public Map<String, Object> begin(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String key,
      @Valid @RequestBody Upload in) {
    Access.require(j, Permission.WORKORDER_PHOTO_WRITE);
    var o = jobs.row(j, id);
    jobs.editable(j, o);
    if (!in.fileName().matches("[A-Za-z0-9][A-Za-z0-9 _().-]{0,175}")
        || in.fileName().contains(".."))
      throw new ResponseStatusException(BAD_REQUEST, "Use a safe filename");
    String name = in.fileName().toLowerCase(Locale.ROOT);
    if (!(in.contentType().equals("image/png")
        ? name.endsWith(".png")
        : name.endsWith(".jpg") || name.endsWith(".jpeg")))
      throw new ResponseStatusException(BAD_REQUEST, "Filename and media type must agree");
    UUID photo = r.replay("workorder", Access.tenant(j), Access.user(j), key, "PHOTO_" + id, in);
    if (photo != null) {
      var old =
          r.one(
              "select * from workorder.workshop_photos where tenant_id=? and work_order_id=? and"
                  + " id=?",
              Access.tenant(j),
              id,
              photo);
      if (!"PENDING".equals(old.get("status"))
          || !Records.instant(old.get("expires_at")).isAfter(Instant.now()))
        throw new ResponseStatusException(CONFLICT, "Upload has completed or expired");
      return grant(old);
    }
    photo = UUID.randomUUID();
    String objectKey =
        "workshop-pending/" + Access.tenant(j) + "/" + photo + "/" + UUID.randomUUID();
    r.db.update(
        "insert into"
            + " workorder.workshop_photos(id,tenant_id,branch_id,work_order_id,label,file_name,content_type,byte_size,sha256,object_key,status,expires_at,created_by)"
            + " values(?,?,?,?,?,?,?,?,?,?,'PENDING',now()+interval '5 minutes',?)",
        photo,
        Access.tenant(j),
        o.get("branch_id"),
        id,
        in.label(),
        in.fileName(),
        in.contentType(),
        in.byteSize(),
        in.sha256().toLowerCase(Locale.ROOT),
        objectKey,
        Access.user(j));
    jobs.audit(j, o, "PHOTO_UPLOAD_AUTHORIZED", photo, in.label());
    r.remember("workorder", Access.tenant(j), Access.user(j), key, "PHOTO_" + id, in, photo);
    return grant(
        r.one(
            "select * from workorder.workshop_photos where tenant_id=? and id=?",
            Access.tenant(j),
            photo));
  }

  Map<String, Object> grant(Map<String, Object> photo) {
    var out =
        new LinkedHashMap<>(
            objects.upload(
                photo.get("object_key").toString(),
                photo.get("content_type").toString(),
                ((Number) photo.get("byte_size")).longValue(),
                photo.get("sha256").toString()));
    out.put("photoId", photo.get("id"));
    return out;
  }

  static boolean magic(String type, byte[] b) {
    if (type.equals("image/png"))
      return b.length >= 8
          && Arrays.equals(
              Arrays.copyOf(b, 8), new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
    return b.length >= 3 && (b[0] & 255) == 255 && (b[1] & 255) == 216 && (b[2] & 255) == 255;
  }

  @PostMapping("/{photo}/complete")
  public Map<String, Object> complete(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @PathVariable UUID photo,
      @Valid @RequestBody Complete in) {
    Access.require(j, Permission.WORKORDER_PHOTO_WRITE);
    var o = jobs.row(j, id);
    jobs.editable(j, o);
    var p =
        r.one(
            "select * from workorder.workshop_photos where tenant_id=? and work_order_id=? and id=?"
                + " for update",
            Access.tenant(j),
            id,
            photo);
    if ("AVAILABLE".equals(p.get("status"))) return Map.of("id", photo, "status", "AVAILABLE");
    Records.version(p, in.version());
    if (!Records.instant(p.get("expires_at")).isAfter(Instant.now()))
      throw new ResponseStatusException(CONFLICT, "Upload expired");
    byte[] bytes =
        objects.readPending(
            p.get("object_key").toString(), ((Number) p.get("byte_size")).longValue());
    String digest;
    try {
      digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    if (!digest.equals(p.get("sha256")) || !magic(p.get("content_type").toString(), bytes))
      throw new ResponseStatusException(
          BAD_REQUEST, "Photo bytes do not match declared checksum or type");
    String finalKey = "workshop-photos/" + Access.tenant(j) + "/" + photo + "/" + UUID.randomUUID();
    objects.publish(finalKey, p.get("content_type").toString(), bytes);
    r.db.update(
        "update workorder.workshop_photos set"
            + " object_key=?,status='AVAILABLE',version=version+1,updated_at=now() where"
            + " tenant_id=? and id=?",
        finalKey,
        Access.tenant(j),
        photo);
    objects.removePending(p.get("object_key").toString());
    jobs.audit(j, o, "PHOTO_PUBLISHED", photo, p.get("label").toString());
    return Map.of("id", photo, "status", "AVAILABLE");
  }

  @GetMapping("/{photo}/download")
  public Map<String, Object> download(
      @AuthenticationPrincipal Jwt j, @PathVariable UUID id, @PathVariable UUID photo) {
    var o = jobs.row(j, id);
    var p =
        r.one(
            "select * from workorder.workshop_photos where tenant_id=? and work_order_id=? and id=?"
                + " and status='AVAILABLE'",
            Access.tenant(j),
            id,
            photo);
    jobs.audit(j, o, "PHOTO_DOWNLOAD_AUTHORIZED", photo, p.get("label").toString());
    return Map.of(
        "url",
        objects.download(
            p.get("object_key").toString(),
            p.get("file_name").toString(),
            p.get("content_type").toString()),
        "expiresIn",
        60);
  }
}
