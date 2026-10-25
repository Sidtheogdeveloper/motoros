package com.motoros.security;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;

@Configuration
public class SecurityConfiguration {
  @Bean
  JwtDecoder jwtDecoder(
      @Value("${motoros.oidc.issuer}") String issuer,
      @Value("${motoros.oidc.jwks-uri}") String jwks,
      @Value("${motoros.oidc.audience:motoros-api}") String audience,
      @Value("${motoros.oidc.accepted-clients:motoros-bff,motoros-customer,motoros-workorder}")
          String clients) {
    var decoder = NimbusJwtDecoder.withJwkSetUri(jwks).build();
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer),
            new ProviderClaimsValidator(audience, clients)));
    return decoder;
  }

  @Bean
  MachineClients machineClients(@Value("${OIDC_MACHINE_CLIENTS:}") String mapping) {
    return new MachineClients(mapping);
  }

  @Bean
  ServiceTokens serviceTokens(
      @Value("${motoros.oidc.token-uri}") String uri,
      @Value("${motoros.service-client-id:}") String id,
      @Value("${motoros.service-client-secret:}") String secret,
      @Value("${motoros.internal-scope:motoros.internal}") String scope) {
    return new ServiceTokens(uri, id, secret, scope);
  }

  @Bean
  SecurityFilterChain security(
      HttpSecurity http,
      JwtDecoder decoder,
      AuthorizationResolver resolver,
      MachineClients machines,
      @Value("${spring.application.name}") String app,
      @Value("${motoros.delegating-clients:}") String delegates,
      @Value("${motoros.internal-scope:motoros.internal}") String internalScope)
      throws Exception {
    Set<String> trusted = new HashSet<>(Arrays.asList(delegates.split(",")));
    http.csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers("/actuator/health", "/actuator/health/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .oauth2ResourceServer(
            o ->
                o.jwt(j -> {})
                    .authenticationEntryPoint(
                        (req, res, e) -> {
                          Throwable cause = e.getCause();
                          String reason =
                              cause instanceof JwtValidationException validation
                                  ? validation.getErrors().stream()
                                      .map(OAuth2Error::getDescription)
                                      .toList()
                                      .toString()
                                  : cause == null
                                      ? e.getClass().getSimpleName()
                                      : cause.getClass().getSimpleName();
                          org.slf4j.LoggerFactory.getLogger("authentication")
                              .warn(
                                  "authentication_rejected reason={} correlationId={}",
                                  reason,
                                  req.getAttribute("correlationId"));
                          problem(res, 401, "Authentication required");
                        }))
        .exceptionHandling(
            e -> e.accessDeniedHandler((req, res, x) -> problem(res, 403, "Access denied")));
    http.addFilterBefore(
        new OncePerRequestFilter() {
          protected void doFilterInternal(
              HttpServletRequest req, HttpServletResponse res, FilterChain chain)
              throws ServletException, IOException {
            String id = req.getHeader("X-Correlation-ID");
            if (id == null || !id.matches("[a-zA-Z0-9-]{1,64}")) id = UUID.randomUUID().toString();
            req.setAttribute("correlationId", id);
            res.setHeader("X-Correlation-ID", id);
            try {
              chain.doFilter(req, res);
            } finally {
              org.slf4j.LoggerFactory.getLogger("http")
                  .info(
                      "method={} path={} status={} correlationId={}",
                      req.getMethod(),
                      req.getRequestURI(),
                      res.getStatus(),
                      id);
              if (res.getStatus() == 403)
                org.slf4j.LoggerFactory.getLogger("security-audit")
                    .warn(
                        "event={} action=UNAUTHORIZED_ACCESS outcome=DENIED target={}"
                            + " actor={} tenant={} branch={} timestamp={} correlationId={}",
                        UUID.randomUUID(),
                        req.getRequestURI(),
                        req.getAttribute("auditActor"),
                        req.getAttribute("auditTenant"),
                        req.getAttribute("auditBranch"),
                        java.time.Instant.now(),
                        id);
            }
          }
        },
        BearerTokenAuthenticationFilter.class);
    http.addFilterAfter(
        new OncePerRequestFilter() {
          protected void doFilterInternal(
              HttpServletRequest req, HttpServletResponse res, FilterChain chain)
              throws ServletException, IOException {
            try {
              var authentication = SecurityContextHolder.getContext().getAuthentication();
              if (authentication instanceof JwtAuthenticationToken auth) {
                Jwt identity = auth.getToken();
                String delegated = req.getHeader("X-User-Token");
                String client = identity.getClaimAsString("client_id");
                if (client == null) client = identity.getClaimAsString("azp");
                String scopes = identity.getClaimAsString("scope");
                boolean service =
                    trusted.contains(client)
                        && scopes != null
                        && Arrays.asList(scopes.split(" ")).contains(internalScope);
                if (req.getRequestURI().startsWith("/api/automation/")) {
                  String logicalClient = machines.logical(client);
                  boolean eventClient =
                      Set.of(
                              "motoros-notification",
                              "motoros-analytics",
                              "motoros-customer",
                              "motoros-workorder")
                          .contains(logicalClient);
                  String eventPath = req.getRequestURI();
                  boolean allowedPath =
                      eventPath.matches("/api/automation/event-proof/[0-9a-fA-F-]{36}")
                          || (app.equals("motoros-customer")
                              && eventPath.equals("/api/automation/communication-context")
                              && "motoros-notification".equals(logicalClient))
                          || eventPath.equals("/api/automation/reconciliation-events")
                              && Set.of("motoros-analytics").contains(logicalClient);
                  if (!service
                      || !eventClient
                      || !allowedPath
                      || delegated != null
                      || !req.getMethod().equals("GET"))
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.FORBIDDEN,
                        "Restricted event service identity required");
                  chain.doFilter(req, res);
                  return;
                }
                if (delegated != null) {
                  if (!service)
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.FORBIDDEN,
                        "Authenticated service delegation required");
                  identity = decoder.decode(delegated);
                  String userScope = identity.getClaimAsString("scope");
                  if (userScope == null
                      || !(Arrays.asList(userScope.split(" ")).contains("motoros.api")
                          || Arrays.asList(userScope.split(" ")).contains("motoros/api")))
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.FORBIDDEN,
                        "User access scope required");
                  req.setAttribute("trustedService", client);
                } else if (req.getRequestURI().startsWith("/api/internal/"))
                  throw new ResponseStatusException(
                      org.springframework.http.HttpStatus.FORBIDDEN,
                      "Internal endpoint requires service and user identities");
                else if (req.getRequestURI().startsWith("/api/")) {
                  if (scopes == null
                      || !(Arrays.asList(scopes.split(" ")).contains("motoros.api")
                          || Arrays.asList(scopes.split(" ")).contains("motoros/api")))
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.FORBIDDEN,
                        "User access scope required");
                }
                req.setAttribute("auditActor", identity.getIssuer() + "/" + identity.getSubject());
                req.setAttribute("auditBranch", req.getParameter("branchId"));
                String path = req.getRequestURI();
                boolean tenantService = app.equals("motoros-tenant");
                boolean unscoped =
                    path.startsWith("/api/platform/messaging")
                        || tenantService
                            && (path.equals("/api/tenants")
                                || path.startsWith("/api/auth/")
                                || path.equals("/api/me/memberships")
                                || path.equals("/api/invitations/accept")
                                || path.startsWith("/api/internal/")
                                || path.startsWith("/api/platform/"));
                if (path.startsWith("/api/") && !unscoped) {
                  String selected = req.getHeader("X-MotorOS-Tenant");
                  String pathTenant = null;
                  var matcher =
                      java.util.regex.Pattern.compile("^/api/tenants/([0-9a-fA-F-]{36})(?:/.*)?$")
                          .matcher(path);
                  if (matcher.matches()) pathTenant = matcher.group(1);
                  if (selected != null && pathTenant != null && !selected.equals(pathTenant))
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.FORBIDDEN, "Tenant selection mismatch");
                  if (selected == null) selected = pathTenant;
                  if (selected == null) selected = req.getParameter("tenantId");
                  if (selected == null)
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.BAD_REQUEST, "Select a workshop brand");
                  UUID tenant;
                  try {
                    tenant = UUID.fromString(selected);
                  } catch (Exception e) {
                    throw new ResponseStatusException(
                        org.springframework.http.HttpStatus.BAD_REQUEST, "Invalid tenant context");
                  }
                  req.setAttribute("auditTenant", tenant);
                  Permission permission = required(path, req.getMethod());
                  var context = resolver.resolve(identity, tenant, permission);
                  var claims = new HashMap<>(identity.getClaims());
                  claims.put("motorosAuthorized", true);
                  claims.put("motorosUser", context.userId().toString());
                  claims.put("tenant", context.tenantId().toString());
                  claims.put("role", context.role());
                  claims.put("permissions", context.permissions());
                  claims.put("branches", context.branches().stream().map(UUID::toString).toList());
                  claims.put(
                      "assignedBranches",
                      context.assignedBranches().stream().map(UUID::toString).toList());
                  claims.put("tenantWide", context.tenantWide());
                  identity =
                      new Jwt(
                          identity.getTokenValue(),
                          identity.getIssuedAt(),
                          identity.getExpiresAt(),
                          identity.getHeaders(),
                          claims);
                }
                SecurityContextHolder.getContext()
                    .setAuthentication(
                        new JwtAuthenticationToken(identity, authentication.getAuthorities()));
              }
              chain.doFilter(req, res);
            } catch (JwtException e) {
              problem(res, 401, "Invalid delegated identity");
            } catch (ResponseStatusException e) {
              problem(res, e.getStatusCode().value(), e.getReason());
            }
          }
        },
        BearerTokenAuthenticationFilter.class);
    return http.build();
  }

  private static Permission required(String path, String method) {
    boolean read = method.equals("GET");
    if (path.startsWith("/api/documents/") && path.endsWith("/download"))
      return Permission.DOCUMENT_READ;
    if (path.contains("/documents"))
      return read ? Permission.DOCUMENT_READ : Permission.DOCUMENT_WRITE;
    if (path.startsWith("/api/vehicles/") && path.endsWith("/ownership"))
      return read ? Permission.VEHICLE_OWNERSHIP_READ : Permission.VEHICLE_OWNERSHIP_WRITE;
    if (path.startsWith("/api/vehicles/") && path.endsWith("/odometer"))
      return read ? Permission.VEHICLE_READ : Permission.VEHICLE_ODOMETER_WRITE;
    if (path.startsWith("/api/customers"))
      return read ? Permission.CUSTOMER_READ : Permission.CUSTOMER_WRITE;
    if (path.startsWith("/api/documents"))
      return read ? Permission.DOCUMENT_READ : Permission.DOCUMENT_WRITE;
    if (path.startsWith("/api/vehicles"))
      return (path.endsWith("/history") || path.endsWith("/timeline"))
          ? Permission.VEHICLE_HISTORY_READ
          : read ? Permission.VEHICLE_READ : Permission.VEHICLE_WRITE;
    if (path.startsWith("/api/appointments"))
      return read ? Permission.BOOKING_READ : Permission.BOOKING_WRITE;
    if (path.startsWith("/api/work-orders/")
        && (path.contains("/notes")
            || path.contains("/parts")
            || path.contains("/tasks")
            || path.contains("/inspections")
            || path.contains("/quality-check")
            || path.contains("/photos")
            || path.endsWith("/assign")
            || path.endsWith("/commercial-approval")
            || path.endsWith("/ready-for-delivery")
            || path.endsWith("/development-approval")
            || path.endsWith("/transition"))) return null;
    if (path.startsWith("/api/work-orders"))
      return read
          ? Permission.WORKORDER_READ
          : method.equals("POST") ? Permission.WORKORDER_CREATE : Permission.WORKORDER_UPDATE;
    return null;
  }

  static void problem(HttpServletResponse res, int status, String title) throws IOException {
    res.setStatus(status);
    res.setContentType("application/problem+json");
    new com.fasterxml.jackson.databind.ObjectMapper()
        .writeValue(
            res.getWriter(),
            Map.of(
                "status",
                status,
                "title",
                title == null ? "Access denied" : title,
                "correlationId",
                String.valueOf(res.getHeader("X-Correlation-ID"))));
  }
}
