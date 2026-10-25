# Runtime configuration and secrets

The Terraform task definitions are the authoritative cloud environment mapping. Application and migration secrets have separate ARNs and execution roles. Application roles cannot read Secrets Manager values; ECS execution roles inject only the corresponding runtime bundle. Migrators receive only their own migration password. The private initialization task alone receives RDS operator credentials and SES SMTP credentials.

| Setting                                   | Source / rule                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| APP_ORIGIN                                | Exact environment HTTPS origin; determines callback, logout and CSRF checks           |
| SPRING_PROFILES_ACTIVE                    | cloud for application tasks                                                           |
| DATABASE_URL                              | Generated private RDS URL, sslmode=verify-full, bundled public Mumbai RDS CA          |
| DATABASE_USER / DATABASE_PASSWORD         | Owned runtime role / own injected runtime secret                                      |
| MOTOROS_MIGRATE_ONLY                      | true only in dedicated migration tasks; exits after Flyway and privilege finalization |
| OIDC_ISSUER / JWKS / TOKEN / USERINFO     | Generated Cognito pool/domain endpoints                                               |
| OIDC_ACCEPTED_CLIENTS                     | Actual provider-generated BFF/machine IDs                                             |
| OIDC_MACHINE_CLIENTS                      | logical-service=provider-client-ID map; unknown aliases fail closed when configured   |
| SERVICE_CLIENT_SECRET                     | Own confidential machine client, injected privately                                   |
| OIDC_PROVIDER / OIDC_LOGOUT_URL           | cognito / exact hosted-domain logout endpoint                                         |
| REDIS_HOST / REDIS_USER / REDIS_IAM_CACHE | Private TLS Valkey and IAM identity; credentials rotate through task-role signing     |
| SESSION_ENCRYPTION_KEY                    | BFF-only AES key; never a public build variable                                       |
| MESSAGING_ACCOUNT / PREFIX / AWS_REGION   | Target account/environment/region, not local emulator values                          |
| MESSAGING_ENDPOINT / BOOTSTRAP            | Empty / false in cloud; no runtime topology creation                                  |
| S3_BUCKET / S3_UPLOAD_ORIGIN              | Own environment bucket and exact HTTPS origin, runtime CSP                            |
| SMTP_HOST / AUTH / STARTTLS / FROM        | Verified SES SMTP, authenticated STARTTLS, verified sender                            |
| INVITATION_ENCRYPTION_KEY                 | Tenant/Billing private encrypted-payload keys                                         |
| NOTIFICATION_ENCRYPTION_KEY               | Notification-only private key                                                         |
| MOTOROS_ENVIRONMENT                       | Low-cardinality logging/metrics namespace                                             |

Never set AWS static keys in task definitions. Do not use NEXT_PUBLIC variables for credentials, provider secrets or customer data. Cloud profiles keep health probes available internally while disabling public API documentation and sensitive management endpoints.

Local Compose retains generated ignored credentials, Keycloak, Redis, Mailpit and emulator storage/messaging. It does not use Cognito IDs, cloud runtime roles or AWS secret values.
