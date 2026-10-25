package com.motoros.notification;

import java.security.SecureRandom;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DeliveryCipher {
  private final byte[] key;

  DeliveryCipher(@Value("${NOTIFICATION_ENCRYPTION_KEY}") String value) {
    if (value.length() != 64)
      throw new IllegalStateException("Configure notification encryption key");
    key = HexFormat.of().parseHex(value);
  }

  String encrypt(String text) {
    try {
      byte[] nonce = new byte[12];
      new SecureRandom().nextBytes(nonce);
      var c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
      var bytes = c.doFinal(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      var out = new byte[12 + bytes.length];
      System.arraycopy(nonce, 0, out, 0, 12);
      System.arraycopy(bytes, 0, out, 12, bytes.length);
      return Base64.getEncoder().encodeToString(out);
    } catch (Exception e) {
      throw new IllegalStateException("Encryption failure");
    }
  }

  String decrypt(String text) {
    try {
      byte[] v = Base64.getDecoder().decode(text);
      var c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(128, Arrays.copyOf(v, 12)));
      return new String(
          c.doFinal(Arrays.copyOfRange(v, 12, v.length)), java.nio.charset.StandardCharsets.UTF_8);
    } catch (Exception e) {
      throw new IllegalStateException("Decryption failure");
    }
  }
}
