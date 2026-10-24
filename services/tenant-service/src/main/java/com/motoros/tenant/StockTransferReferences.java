package com.motoros.tenant;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Minimal same-tenant branch references for requesting stock; no authority to operate that branch.
 */
@RestController
@RequestMapping("/api/stock-transfer/branches")
public class StockTransferReferences {
  private final Records r;

  StockTransferReferences(JdbcTemplate db) {
    r = new Records(db);
  }

  void authorize(Jwt j) {
    Access.require(j, Permission.INVENTORY_TRANSFER);
    if (j.getClaimAsStringList("branches").isEmpty())
      throw new ResponseStatusException(FORBIDDEN, "An active assigned branch is required");
  }

  @GetMapping
  public Map<String, Object> list(
      @AuthenticationPrincipal Jwt j,
      @RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "30") int size) {
    authorize(j);
    Records.page(page, size);
    if (q.length() > 200) throw new ResponseStatusException(BAD_REQUEST);
    String f =
        " from tenant.branches where tenant_id=? and status='ACTIVE' and (name ilike ? or"
            + " branch_code ilike ?)";
    return Records.page(
        r.db.queryForList(
            "select id,name,branch_code,status" + f + " order by name,id limit ? offset ?",
            Access.tenant(j),
            "%" + q + "%",
            "%" + q + "%",
            size,
            page * size),
        r.db.queryForObject(
            "select count(*)" + f, Long.class, Access.tenant(j), "%" + q + "%", "%" + q + "%"),
        size);
  }

  @GetMapping("/{id}")
  public Map<String, Object> reference(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    authorize(j);
    var row =
        r.one(
            "select id,name,branch_code,status from tenant.branches where tenant_id=? and id=?",
            Access.tenant(j),
            id);
    if (!"ACTIVE".equals(row.get("status")))
      throw new ResponseStatusException(CONFLICT, "Referenced branch is inactive");
    return Records.dto(row);
  }
}
