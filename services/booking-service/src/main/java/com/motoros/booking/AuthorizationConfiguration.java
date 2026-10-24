package com.motoros.booking;

import com.motoros.security.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;

@Configuration
public class AuthorizationConfiguration {
  @Bean
  AuthorizationResolver authorizationResolver(
      @Value("${motoros.tenant-url}") String url, ServiceTokens tokens) {
    return new RemoteAuthorizationResolver(url, tokens);
  }
}
