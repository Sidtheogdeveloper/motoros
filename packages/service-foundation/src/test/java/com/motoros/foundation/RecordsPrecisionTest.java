package com.motoros.foundation;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class RecordsPrecisionTest {
  @Test
  void jsonSnapshotsRetainAllDecimalDigits() {
    var row = Records.object("{\"amount\":99999999999999999.99,\"tax\":0.01}");
    assertEquals(new BigDecimal("99999999999999999.99"), row.get("amount"));
    assertEquals(new BigDecimal("0.01"), row.get("tax"));
    assertEquals("{\"amount\":99999999999999999.99,\"tax\":0.01}", Records.json(row));
  }
}
