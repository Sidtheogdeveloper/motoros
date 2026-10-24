package com.motoros.billing;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class MoneyTest {
  @Test
  void fractionalQuantityDiscountAndTaxRoundPerLine() {
    var x =
        Money.line(
            new BigDecimal("1.125"),
            new BigDecimal("199.99"),
            new BigDecimal("7.5"),
            new BigDecimal("18"));
    assertEquals(new BigDecimal("224.99"), x.gross());
    assertEquals(new BigDecimal("16.87"), x.discount());
    assertEquals(new BigDecimal("208.12"), x.net());
    assertEquals(new BigDecimal("37.46"), x.tax());
    assertEquals(new BigDecimal("245.58"), x.total());
  }

  @Test
  void fullDiscountAndZeroTaxRemainExact() {
    var x =
        Money.line(
            new BigDecimal("3"), new BigDecimal("0.10"), new BigDecimal("100"), BigDecimal.ZERO);
    assertEquals(new BigDecimal("0.00"), x.total());
  }

  @Test
  void negativeAndExcessiveInputsAreRejected() {
    assertThrows(
        IllegalArgumentException.class,
        () -> Money.line(BigDecimal.ZERO, BigDecimal.ONE, BigDecimal.ZERO, BigDecimal.ZERO));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            Money.line(BigDecimal.ONE, BigDecimal.ONE, new BigDecimal("100.01"), BigDecimal.ZERO));
  }

  @Test
  void pdfIsDeterministicEscapesInputAndPaginates() {
    var lines =
        java.util.stream.IntStream.range(0, 110).mapToObj(i -> "Part (" + i + ") \\ line").toList();
    byte[] a = InvoicePdf.render(lines);
    assertArrayEquals(a, InvoicePdf.render(lines));
    String text = new String(a, java.nio.charset.StandardCharsets.US_ASCII);
    assertTrue(text.startsWith("%PDF-1.4"));
    assertTrue(text.contains("/Count 3"));
    assertTrue(text.endsWith("%%EOF\n"));
    int start =
        Integer.parseInt(text.substring(text.lastIndexOf("startxref\n") + 10).split("\n")[0]);
    assertTrue(text.substring(start).startsWith("xref"));
  }

  @Test
  void pdfCurrencyFormattingPreservesLargeSnapshotValues() {
    var row = com.motoros.foundation.Records.object("{\"amount\":99999999999999999.99}");
    assertEquals("99999999999999999.99", InvoiceDocumentController.money(row.get("amount")));
    assertEquals("100.00", InvoiceDocumentController.money("100"));
  }

  @Test
  void pdfWrappingPreservesInvoiceIdentifiersAndDecimalAmounts() {
    String reference = "INV-90b1dbac-c40e-439b-b652-ad9f756b8c5c-2026-000005";
    String pdf =
        new String(
            InvoicePdf.render(
                java.util.List.of(
                    "Invoice: " + reference, "Discount 0.00 | Tax 18.00 | Total 118.00")),
            java.nio.charset.StandardCharsets.US_ASCII);
    assertTrue(pdf.contains(reference));
    assertTrue(pdf.contains("118.00"));
  }
}
