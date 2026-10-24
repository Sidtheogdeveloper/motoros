package com.motoros.billing;

import java.math.*;

/** All arithmetic is decimal. Each line is rounded HALF_UP to currency minor units (2). */
public final class Money {
  private Money() {}

  public record Line(
      BigDecimal gross, BigDecimal discount, BigDecimal net, BigDecimal tax, BigDecimal total) {}

  public static BigDecimal rounded(BigDecimal x) {
    return x.setScale(2, RoundingMode.HALF_UP);
  }

  public static Line line(
      BigDecimal quantity, BigDecimal unit, BigDecimal discountPercent, BigDecimal taxPercent) {
    if (quantity == null
        || unit == null
        || discountPercent == null
        || taxPercent == null
        || quantity.signum() <= 0
        || unit.signum() < 0
        || discountPercent.signum() < 0
        || discountPercent.compareTo(new BigDecimal("100")) > 0
        || taxPercent.signum() < 0
        || taxPercent.compareTo(new BigDecimal("100")) > 0)
      throw new IllegalArgumentException("Invalid monetary input");
    BigDecimal gross = rounded(quantity.multiply(unit)),
        discount = rounded(gross.multiply(discountPercent).movePointLeft(2)),
        net = gross.subtract(discount),
        tax = rounded(net.multiply(taxPercent).movePointLeft(2));
    return new Line(gross, discount, net, tax, net.add(tax));
  }
}
