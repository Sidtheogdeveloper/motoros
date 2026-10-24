package com.motoros.security;

import static org.junit.jupiter.api.Assertions.*;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.*;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.*;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;

class JwksDecoderTest {
  static com.nimbusds.jose.jwk.RSAKey key;
  static HttpServer server;
  static org.springframework.security.oauth2.jwt.JwtDecoder decoder;
  static final String ISSUER = "https://identity.example.test/realm";

  @BeforeAll
  static void setup() throws Exception {
    key = new RSAKeyGenerator(2048).keyID("test-key").generate();
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    byte[] body =
        new JWKSet(key.toPublicJWK()).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    server.createContext(
        "/jwks",
        e -> {
          e.getResponseHeaders().set("Content-Type", "application/json");
          e.sendResponseHeaders(200, body.length);
          e.getResponseBody().write(body);
          e.close();
        });
    server.start();
    decoder =
        new SecurityConfiguration()
            .jwtDecoder(
                ISSUER,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/jwks",
                "motoros-api",
                "client");
  }

  @AfterAll
  static void stop() {
    server.stop(0);
  }

  JWTClaimsSet.Builder claims() {
    return new JWTClaimsSet.Builder()
        .issuer(ISSUER)
        .subject("opaque-identity")
        .audience("motoros-api")
        .issueTime(Date.from(Instant.now().minusSeconds(10)))
        .expirationTime(Date.from(Instant.now().plusSeconds(300)))
        .claim("scope", "openid motoros.api");
  }

  String sign(JWTClaimsSet claims, com.nimbusds.jose.jwk.RSAKey signer) throws Exception {
    var jwt =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID("test-key")
                .type(JOSEObjectType.JWT)
                .build(),
            claims);
    jwt.sign(new RSASSASigner(signer));
    return jwt.serialize();
  }

  @Test
  void validSignature() throws Exception {
    assertEquals("opaque-identity", decoder.decode(sign(claims().build(), key)).getSubject());
  }

  @Test
  void incorrectIssuer() throws Exception {
    String token = sign(claims().issuer("https://wrong.example.test").build(), key);
    assertThrows(
        org.springframework.security.oauth2.jwt.JwtException.class, () -> decoder.decode(token));
  }

  @Test
  void incorrectAudience() throws Exception {
    String token = sign(claims().audience("other-api").build(), key);
    assertThrows(
        org.springframework.security.oauth2.jwt.JwtException.class, () -> decoder.decode(token));
  }

  @Test
  void expiredAccessToken() throws Exception {
    String token =
        sign(
            claims()
                .issueTime(Date.from(Instant.now().minusSeconds(600)))
                .expirationTime(Date.from(Instant.now().minusSeconds(120)))
                .build(),
            key);
    assertThrows(
        org.springframework.security.oauth2.jwt.JwtException.class, () -> decoder.decode(token));
  }

  @Test
  void wrongSignature() throws Exception {
    String token = sign(claims().build(), new RSAKeyGenerator(2048).keyID("attacker").generate());
    assertThrows(
        org.springframework.security.oauth2.jwt.JwtException.class, () -> decoder.decode(token));
  }
}
