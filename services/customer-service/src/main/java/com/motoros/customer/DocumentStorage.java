package com.motoros.customer;
import org.springframework.stereotype.Component;import org.springframework.beans.factory.annotation.Value;
@Component public class DocumentStorage extends com.motoros.storage.PrivateObjects {
 public DocumentStorage(@Value("${motoros.documents.endpoint:}")String endpoint,@Value("${motoros.documents.public-endpoint:}")String publicEndpoint,@Value("${motoros.documents.bucket:motoros-private}")String bucket,@Value("${motoros.documents.region:ap-south-1}")String region,@Value("${motoros.documents.local-access-key:}")String access,@Value("${motoros.documents.local-secret-key:}")String secret){super(endpoint,publicEndpoint,bucket,region,access,secret);}
}
