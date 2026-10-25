package com.motoros.notification;

import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.security.*;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.*;

@Configuration
class ApiContract {
  @Bean
  OpenApiCustomizer exactDecimalSchemas() {
    return api -> {
      if (api.getComponents() == null || api.getComponents().getSchemas() == null) return;
      for (var schema : api.getComponents().getSchemas().values()) {
        if (schema.getProperties() != null)
          schema
              .getProperties()
              .replaceAll(
                  (name, property) ->
                      "number".equals(((io.swagger.v3.oas.models.media.Schema) property).getType())
                          ? new StringSchema()
                              .pattern("^-?[0-9]+(?:\\.[0-9]+)?$")
                              .description(
                                  "Exact decimal string. Range and scale are validated by the"
                                      + " service; do not calculate financial values using binary"
                                      + " floating point.")
                          : property);
      }
    };
  }

  @Bean
  org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer
      decimalContract() {
    return builder ->
        builder.serializerByType(
            java.math.BigDecimal.class,
            com.fasterxml.jackson.databind.ser.std.ToStringSerializer.instance);
  }

  @Bean
  OpenApiCustomizer securityContract() {
    return api -> {
      if (api.getComponents() == null) api.setComponents(new io.swagger.v3.oas.models.Components());
      api.getComponents()
          .addSecuritySchemes(
              "oidcBearer",
              new SecurityScheme()
                  .type(SecurityScheme.Type.HTTP)
                  .scheme("bearer")
                  .bearerFormat("JWT"));
      api.addSecurityItem(new SecurityRequirement().addList("oidcBearer"));
      api.getPaths()
          .forEach(
              (path, item) -> {
                boolean unscoped =
                    path.equals("/api/tenants")
                        || path.startsWith("/api/auth/")
                        || path.startsWith("/api/platform/")
                        || path.equals("/api/me/memberships")
                        || path.equals("/api/invitations/accept")
                        || path.startsWith("/api/internal/");
                if (!unscoped)
                  item.readOperations()
                      .forEach(
                          operation ->
                              operation.addParametersItem(
                                  new Parameter()
                                      .in("header")
                                      .name("X-MotorOS-Tenant")
                                      .required(true)
                                      .description(
                                          "Selected tenant; independently authorized against"
                                              + " current membership. BFF supplies this from the"
                                              + " server session.")
                                      .schema(new StringSchema().format("uuid"))));
              });
    };
  }
}
