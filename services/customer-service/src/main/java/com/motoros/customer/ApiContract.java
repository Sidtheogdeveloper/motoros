package com.motoros.customer;
import org.springframework.context.annotation.*;
import org.springdoc.core.customizers.OpenApiCustomizer;
import io.swagger.v3.oas.models.security.*;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.media.StringSchema;
@Configuration class ApiContract {
 @Bean OpenApiCustomizer securityContract(){return api->{
  if(api.getComponents()==null)api.setComponents(new io.swagger.v3.oas.models.Components());
  api.getComponents().addSecuritySchemes("oidcBearer",new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT"));api.addSecurityItem(new SecurityRequirement().addList("oidcBearer"));
  api.getPaths().forEach((path,item)->{boolean unscoped=path.equals("/api/tenants")||path.startsWith("/api/auth/")||path.startsWith("/api/platform/")||path.equals("/api/me/memberships")||path.equals("/api/invitations/accept")||path.startsWith("/api/internal/");if(!unscoped)item.readOperations().forEach(operation->operation.addParametersItem(new Parameter().in("header").name("X-MotorOS-Tenant").required(true).description("Selected tenant; independently authorized against current membership. BFF supplies this from the server session.").schema(new StringSchema().format("uuid"))));});
 };}
}
