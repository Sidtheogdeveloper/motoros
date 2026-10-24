package com.motoros.storage;

import static org.springframework.http.HttpStatus.*;

import java.io.*;
import java.net.URI;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.*;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.*;
import software.amazon.awssdk.services.s3.presigner.model.*;

public class PrivateObjects implements AutoCloseable {
  private final S3Client s3;
  private final S3Presigner signer;
  private final String bucket;
  private final boolean local;

  public PrivateObjects(
      @Value("${motoros.documents.endpoint:}") String endpoint,
      @Value("${motoros.documents.public-endpoint:}") String publicEndpoint,
      @Value("${motoros.documents.bucket:motoros-private}") String bucket,
      @Value("${motoros.documents.region:ap-south-1}") String region,
      @Value("${motoros.documents.local-access-key:}") String access,
      @Value("${motoros.documents.local-secret-key:}") String secret) {
    this.bucket = bucket;
    this.local = !endpoint.isBlank();
    var client =
        S3Client.builder()
            .region(Region.of(region))
            .overrideConfiguration(
                c ->
                    c.apiCallTimeout(Duration.ofSeconds(20))
                        .apiCallAttemptTimeout(Duration.ofSeconds(10)));
    var p = S3Presigner.builder().region(Region.of(region));
    if (!endpoint.isBlank()) {
      URI uri = URI.create(endpoint);
      if (!"127.0.0.1".equals(uri.getHost()) && !"storage".equals(uri.getHost()))
        throw new IllegalStateException(
            "Custom storage endpoint must be the explicit local emulator");
      var creds = StaticCredentialsProvider.create(AwsBasicCredentials.create(access, secret));
      client.endpointOverride(uri).credentialsProvider(creds).forcePathStyle(true);
      URI browserUri = publicEndpoint.isBlank() ? uri : URI.create(publicEndpoint);
      if (!"127.0.0.1".equals(browserUri.getHost()) && !"storage".equals(browserUri.getHost()))
        throw new IllegalStateException("Local upload endpoint must be explicitly local");
      p.endpointOverride(browserUri)
          .credentialsProvider(creds)
          .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
    }
    s3 = client.build();
    signer = p.build();
  }

  public Map<String, Object> upload(String key, String type, long size, String checksum) {
    try {
      var result =
          signer.presignPutObject(
              PutObjectPresignRequest.builder()
                  .signatureDuration(Duration.ofMinutes(5))
                  .putObjectRequest(
                      PutObjectRequest.builder()
                          .bucket(bucket)
                          .key(key)
                          .contentType(type)
                          .contentLength(size)
                          .checksumSHA256(
                              Base64.getEncoder().encodeToString(HexFormat.of().parseHex(checksum)))
                          .build())
                  .build());
      var headers = new LinkedHashMap<String, String>();
      result
          .signedHeaders()
          .forEach(
              (k, v) -> {
                if (!k.equalsIgnoreCase("host") && !k.equalsIgnoreCase("content-length"))
                  headers.put(k, String.join(",", v));
              });
      return Map.of("url", result.url().toString(), "headers", headers, "expiresIn", 300);
    } catch (Exception e) {
      throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Document upload signing unavailable");
    }
  }

  public byte[] readPending(String key, long expected) {
    try {
      var head = s3.headObject(b -> b.bucket(bucket).key(key));
      if (head.contentLength() != expected)
        throw new ResponseStatusException(
            BAD_REQUEST, "Uploaded size differs from declared metadata");
      try (var stream = s3.getObject(b -> b.bucket(bucket).key(key))) {
        byte[] bytes = stream.readNBytes((int) expected + 1);
        if (bytes.length != expected)
          throw new ResponseStatusException(BAD_REQUEST, "Uploaded object size mismatch");
        return bytes;
      }
    } catch (ResponseStatusException e) {
      throw e;
    } catch (NoSuchKeyException e) {
      throw new ResponseStatusException(
          CONFLICT, "Upload is missing; upload the file before completing");
    } catch (S3Exception e) {
      if (e.statusCode() == 404)
        throw new ResponseStatusException(
            CONFLICT, "Upload is missing; upload the file before completing");
      throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Object storage unavailable");
    } catch (Exception e) {
      throw new ResponseStatusException(
          SERVICE_UNAVAILABLE, "Object storage unavailable or upload missing");
    }
  }

  public void publish(String key, String type, byte[] bytes) {
    try {
      var request = PutObjectRequest.builder().bucket(bucket).key(key).contentType(type);
      if (!local) request.serverSideEncryption(ServerSideEncryption.AES256);
      s3.putObject(request.build(), RequestBody.fromBytes(bytes));
    } catch (Exception e) {
      throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Document publication unavailable");
    }
  }

  public void removePending(String key) {
    try {
      s3.deleteObject(b -> b.bucket(bucket).key(key));
    } catch (Exception ignored) {
      /* Local pending prefix has a lifecycle expiration; no sensitive content is logged. */
    }
  }

  public String download(String key, String name, String type) {
    try {
      return signer
          .presignGetObject(
              GetObjectPresignRequest.builder()
                  .signatureDuration(Duration.ofSeconds(60))
                  .getObjectRequest(
                      GetObjectRequest.builder()
                          .bucket(bucket)
                          .key(key)
                          .responseContentType(type)
                          .responseContentDisposition("attachment; filename=\"" + name + "\"")
                          .build())
                  .build())
          .url()
          .toString();
    } catch (Exception e) {
      throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Document download unavailable");
    }
  }

  public void close() {
    signer.close();
    s3.close();
  }
}
