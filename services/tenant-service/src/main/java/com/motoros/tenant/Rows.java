package com.motoros.tenant;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

final class Rows {
  static final ObjectMapper JSON = new ObjectMapper();

  static Map<String, Object> dto(Map<String, Object> row) {
    var out = new LinkedHashMap<String, Object>();
    row.forEach(
        (k, v) -> {
          var key = new StringBuilder();
          boolean upper = false;
          for (char c : k.toCharArray()) {
            if (c == '_') {
              upper = true;
              continue;
            }
            key.append(upper ? Character.toUpperCase(c) : c);
            upper = false;
          }
          if (v instanceof java.sql.Timestamp t) v = t.toInstant().toString();
          if (v != null && v.getClass().getName().equals("org.postgresql.util.PGobject")) {
            try {
              v = JSON.readTree(v.toString());
            } catch (Exception ignored) {
              v = null;
            }
          }
          out.put(key.toString(), v);
        });
    return out;
  }

  static String json(Object value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid JSON");
    }
  }
}
