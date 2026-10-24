package com.motoros.billing;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.Records;
import com.motoros.security.*;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/invoices")
@Transactional
public class InvoiceDocumentController {
  private final Records r;
  private final InvoiceStorage storage;

  InvoiceDocumentController(JdbcTemplate db, InvoiceStorage storage) {
    r = new Records(db);
    this.storage = storage;
  }

  @GetMapping("/{id}/pdf")
  public Map<String, Object> pdf(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    Access.require(j, Permission.INVOICE_READ);
    var row =
        r.one("select * from billing.invoices where tenant_id=? and id=?", Access.tenant(j), id);
    Access.branch(j, (UUID) row.get("branch_id"));
    if (!"ISSUED".equals(row.get("status")))
      throw new ResponseStatusException(CONFLICT, "Issue the invoice before downloading its PDF");
    r.lock("invoice-pdf" + Access.tenant(j) + id);
    var docs =
        r.db.queryForList(
            "select * from billing.invoice_documents where tenant_id=? and invoice_id=?",
            Access.tenant(j),
            id);
    String objectKey;
    if (docs.isEmpty()) {
      var snap = Records.object(row.get("snapshot"));
      var workshop = Records.object(snap.get("workshop"));
      var customer = Records.object(snap.get("customer"));
      var vehicle = Records.object(snap.get("vehicle"));
      var lines = new ArrayList<String>();
      lines.add("MOTOROS | INVOICE");
      lines.add(Objects.toString(workshop.get("legalName"), ""));
      lines.add(Objects.toString(workshop.get("address"), ""));
      lines.add("Invoice: " + row.get("invoice_number"));
      lines.add("Issued (UTC): " + Records.instant(row.get("issued_at")).toString());
      lines.add("Customer: " + customer.get("name"));
      for (String field : List.of("email", "phone", "address", "city", "country")) {
        String value = Objects.toString(customer.get(field), "").strip();
        if (!value.isEmpty()) lines.add(value);
      }
      String workshopReference =
          Objects.toString(workshop.get("registrationReference"), "").strip();
      if (!workshopReference.isEmpty()) lines.add("Workshop reference: " + workshopReference);
      lines.add(
          "Vehicle: "
              + vehicle.get("registration")
              + " | "
              + vehicle.get("make")
              + " "
              + vehicle.get("model"));
      lines.add("Job: " + snap.get("jobCardNumber"));
      lines.add(
          "Estimate: " + snap.get("estimateId") + " revision " + snap.get("estimateRevision"));
      lines.add("");
      for (var item : (List<Map<String, Object>>) snap.get("items")) {
        lines.add(item.get("lineNumber") + ". " + item.get("description"));
        lines.add(
            "Quantity "
                + new java.math.BigDecimal(item.get("quantity").toString())
                    .stripTrailingZeros()
                    .toPlainString()
                + " | Unit price "
                + money(item.get("unitPrice")));
        lines.add(
            "Discount "
                + money(item.get("discountAmount"))
                + " | Tax "
                + money(item.get("taxAmount"))
                + " | Total "
                + money(item.get("total")));
      }
      lines.add("");
      lines.add("Currency: " + row.get("currency"));
      lines.add("Subtotal: " + row.get("subtotal"));
      lines.add("Discount: " + row.get("discount_total"));
      lines.add(workshop.get("taxLabel") + ": " + row.get("tax_total"));
      lines.add("Invoice total: " + row.get("total"));
      lines.add("");
      lines.add(
          "Payment status and later credits are maintained separately from this issued invoice.");
      lines.add(Objects.toString(snap.get("taxComplianceStatement"), ""));
      byte[] bytes = InvoicePdf.render(lines);
      String digest;
      try {
        digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
      } catch (Exception e) {
        throw new IllegalStateException(e);
      }
      objectKey = "tenants/" + Access.tenant(j) + "/invoices/" + id + "/" + digest + ".pdf";
      storage.publish(objectKey, "application/pdf", bytes);
      r.db.update(
          "insert into billing.invoice_documents(tenant_id,invoice_id,object_key,sha256,byte_size)"
              + " values(?,?,?,?,?)",
          Access.tenant(j),
          id,
          objectKey,
          digest,
          bytes.length);
    } else objectKey = docs.getFirst().get("object_key").toString();
    return Map.of(
        "url",
        storage.download(objectKey, "invoice-" + id + ".pdf", "application/pdf"),
        "expiresInSeconds",
        60);
  }

  static String money(Object value) {
    return new java.math.BigDecimal(value.toString())
        .setScale(2, java.math.RoundingMode.UNNECESSARY)
        .toPlainString();
  }
}
