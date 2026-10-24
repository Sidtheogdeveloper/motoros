package com.motoros.customer;

import java.net.URI;
import java.util.*;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.*;
import software.amazon.awssdk.services.s3.model.*;

public final class LocalStorageSetup {
  static void optional(Runnable operation) {
    try {
      operation.run();
    } catch (S3Exception e) {
      if (e.statusCode() != 501) throw e;
      System.out.println(
          "Optional AWS bucket control unsupported by local provider; authentication denial is"
              + " separately verified.");
    }
  }

  public static void main(String[] args) {
    try (var s3 =
        S3Client.builder()
            .endpointOverride(URI.create("http://127.0.0.1:8333"))
            .region(Region.AP_SOUTH_1)
            .credentialsProvider(
                StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(
                        System.getenv("S3_LOCAL_ACCESS_KEY"),
                        System.getenv("S3_LOCAL_SECRET_KEY"))))
            .forcePathStyle(true)
            .build()) {
      String bucket = "motoros-private";
      try {
        s3.headBucket(b -> b.bucket(bucket));
      } catch (NoSuchBucketException e) {
        s3.createBucket(
            b ->
                b.bucket(bucket)
                    .createBucketConfiguration(c -> c.locationConstraint("ap-south-1")));
      } catch (S3Exception e) {
        if (e.statusCode() != 404) throw e;
        s3.createBucket(
            b ->
                b.bucket(bucket)
                    .createBucketConfiguration(c -> c.locationConstraint("ap-south-1")));
      }
      optional(
          () ->
              s3.putPublicAccessBlock(
                  b ->
                      b.bucket(bucket)
                          .publicAccessBlockConfiguration(
                              c ->
                                  c.blockPublicAcls(true)
                                      .ignorePublicAcls(true)
                                      .blockPublicPolicy(true)
                                      .restrictPublicBuckets(true))));
      optional(
          () ->
              s3.putBucketEncryption(
                  b ->
                      b.bucket(bucket)
                          .serverSideEncryptionConfiguration(
                              c ->
                                  c.rules(
                                      ServerSideEncryptionRule.builder()
                                          .applyServerSideEncryptionByDefault(
                                              a -> a.sseAlgorithm(ServerSideEncryption.AES256))
                                          .build()))));
      s3.putBucketCors(
          b ->
              b.bucket(bucket)
                  .corsConfiguration(
                      c ->
                          c.corsRules(
                              CORSRule.builder()
                                  .allowedOrigins("http://127.0.0.1:3000")
                                  .allowedMethods("PUT", "GET", "HEAD")
                                  .allowedHeaders("*")
                                  .exposeHeaders("ETag")
                                  .maxAgeSeconds(300)
                                  .build())));
      optional(
          () ->
              s3.putBucketLifecycleConfiguration(
                  b ->
                      b.bucket(bucket)
                          .lifecycleConfiguration(
                              c ->
                                  c.rules(
                                      LifecycleRule.builder()
                                          .id("expire-pending-uploads")
                                          .status(ExpirationStatus.ENABLED)
                                          .filter(f -> f.prefix("uploads/"))
                                          .expiration(e -> e.days(1))
                                          .build()))));

      try {
        String probe = ".private-access-probe";
        s3.putObject(
            b -> b.bucket(bucket).key(probe),
            software.amazon.awssdk.core.sync.RequestBody.fromString("private"));
        var request =
            java.net.http.HttpRequest.newBuilder(
                    URI.create("http://127.0.0.1:8333/" + bucket + "/" + probe))
                .build();
        int status =
            java.net.http.HttpClient.newHttpClient()
                .send(request, java.net.http.HttpResponse.BodyHandlers.discarding())
                .statusCode();
        s3.deleteObject(b -> b.bucket(bucket).key(probe));
        if (status != 403)
          throw new IllegalStateException("Local storage must deny unsigned object reads");
      } catch (Exception e) {
        throw new IllegalStateException("Private-object security probe failed", e);
      }
      System.out.println(
          "Local private document bucket and CORS configured; unsigned object reads denied.");
    }
  }
}
