package com.motoros.security;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

public interface AuthorizationResolver {
  AuthorizationContext resolve(Jwt identity, UUID tenant, Permission permission);
}
