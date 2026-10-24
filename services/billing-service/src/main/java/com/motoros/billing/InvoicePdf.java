package com.motoros.billing;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.*;

/** A deterministic, paginated PDF with no external URLs, HTML, scripts or executable content. */
final class InvoicePdf {
  private InvoicePdf() {}

  static byte[] render(List<String> text) {
    var lines = new ArrayList<String>();
    for (String raw : text) {
      String s =
          Normalizer.normalize(raw.replaceAll("\\s+", " "), Normalizer.Form.NFKD)
              .replaceAll("\\p{M}", "")
              .replaceAll("[^\\x20-\\x7E]", "?")
              .strip();
      while (s.length() > 54) {
        int split = s.lastIndexOf(' ', 54);
        if (split < 1) split = 54;
        lines.add(s.substring(0, split));
        s = s.substring(split).stripLeading();
      }
      lines.add(s);
    }
    if (lines.isEmpty()) lines.add("Invoice");
    int pages = (lines.size() + 46) / 47;
    var objects = new ArrayList<String>();
    objects.add("<< /Type /Catalog /Pages 2 0 R >>");
    var kids = new StringBuilder();
    for (int i = 0; i < pages; i++) kids.append(4 + i * 2).append(" 0 R ");
    objects.add("<< /Type /Pages /Count " + pages + " /Kids [" + kids + "] >>");
    objects.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    for (int i = 0; i < pages; i++) {
      objects.add(
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >>"
              + " >> /Contents "
              + (5 + i * 2)
              + " 0 R >>");
      var stream =
          new StringBuilder(
              "q 0.98 0.42 0.12 RG 2 w 42 812 m 553 812 l S Q\nBT /F1 10 Tf 42 788 Td 15 TL\n");
      for (int k = i * 47; k < Math.min(lines.size(), (i + 1) * 47); k++)
        stream
            .append(k == 0 ? "/F1 14 Tf " : "/F1 10 Tf ")
            .append("(")
            .append(lines.get(k).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)"))
            .append(") Tj T*\n");
      stream
          .append("ET\nBT /F1 9 Tf 42 30 Td (Page ")
          .append(i + 1)
          .append(" of ")
          .append(pages)
          .append(") Tj ET\n");
      objects.add(
          "<< /Length "
              + stream.toString().getBytes(StandardCharsets.US_ASCII).length
              + " >>\nstream\n"
              + stream
              + "endstream");
    }
    var out = new ByteArrayOutputStream();
    write(out, "%PDF-1.4\n");
    var offsets = new ArrayList<Integer>();
    offsets.add(0);
    for (int i = 0; i < objects.size(); i++) {
      offsets.add(out.size());
      write(out, (i + 1) + " 0 obj\n" + objects.get(i) + "\nendobj\n");
    }
    int xref = out.size();
    write(out, "xref\n0 " + (objects.size() + 1) + "\n0000000000 65535 f \n");
    for (int i = 1; i < offsets.size(); i++)
      write(out, String.format(Locale.ROOT, "%010d 00000 n \n", offsets.get(i)));
    write(
        out,
        "trailer\n<< /Size "
            + (objects.size() + 1)
            + " /Root 1 0 R >>\nstartxref\n"
            + xref
            + "\n%%EOF\n");
    return out.toByteArray();
  }

  static void write(ByteArrayOutputStream out, String s) {
    out.writeBytes(s.getBytes(StandardCharsets.US_ASCII));
  }
}
