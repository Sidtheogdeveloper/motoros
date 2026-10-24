package com.motoros.tenant;

import java.security.SecureRandom;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class InvitationCipher {
  private final byte[] key;
  private final SecureRandom random = new SecureRandom();

  InvitationCipher(@Value("${motoros.invitation-key}") String secret) {
    if (secret.length() != 64)
      throw new IllegalStateException("Configure a 32-byte invitation encryption key");
    key = HexFormat.of().parseHex(secret);
  }

  String encrypt(String text) {
    try {
      byte[] nonce = new byte[12];
      random.nextBytes(nonce);
      var c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
      byte[] body = c.doFinal(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      byte[] combined = new byte[nonce.length + body.length];
      System.arraycopy(nonce, 0, combined, 0, 12);
      System.arraycopy(body, 0, combined, 12, body.length);
      return Base64.getEncoder().encodeToString(combined);
    } catch (Exception e) {
      throw new IllegalStateException("Invitation encryption failed");
    }
  }

  String decrypt(String encoded) {
    try {
      byte[] value = Base64.getDecoder().decode(encoded);
      var c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(128, Arrays.copyOf(value, 12)));
      return new String(
          c.doFinal(Arrays.copyOfRange(value, 12, value.length)),
          java.nio.charset.StandardCharsets.UTF_8);
    } catch (Exception e) {
      throw new IllegalStateException("Invitation decryption failed");
    }
  }
}
