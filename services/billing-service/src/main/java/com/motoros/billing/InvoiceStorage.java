package com.motoros.billing;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class InvoiceStorage extends com.motoros.storage.PrivateObjects {
  public InvoiceStorage(
      @Value("${motoros.documents.endpoint:}") String endpoint,
      @Value("${motoros.documents.public-endpoint:}") String publicEndpoint,
      @Value("${motoros.documents.bucket:motoros-private}") String bucket,
      @Value("${motoros.documents.region:ap-south-1}") String region,
      @Value("${motoros.documents.local-access-key:}") String access,
      @Value("${motoros.documents.local-secret-key:}") String secret) {
    super(endpoint, publicEndpoint, bucket, region, access, secret);
  }
}
