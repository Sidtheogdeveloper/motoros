# Cognito readiness template — unapplied

This module configures a protected user pool, verified email/recovery, password policy, classic hosted login domain, confidential BFF code-only client, refresh rotation/revocation, and separate confidential Customer/Work Order machine clients restricted to `motoros/internal`. It never grants tenant roles through Cognito groups. Terraform `init -backend=false`, `fmt` and `validate` are local checks; do not run plan/apply against an account without approval. No AWS resource has been provisioned.

Use an encrypted remote Terraform state backend with restricted access before any approved deployment. Generated app-client secrets are present in Terraform state even though this module has no secret outputs. Inject them through a secret-managed deployment pipeline, not source files, browser bundles or command logs. Complete SES/email-domain setup and MFA/abuse controls before production. `prevent_destroy` and pool deletion protection are deliberate.

Copy `terraform.tfvars.example` to ignored `terraform.tfvars` and replace origin/domain/region after environment approval. The template uses classic hosted UI version 1; managed login version 2 needs the appropriate feature plan and branding resources and remains untested. Code-only client settings exclude implicit/password flows; the BFF always sends PKCE S256, state and nonce.

| Setting                                   | Local                                   | Cognito staging                                              |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| OIDC_PROVIDER                             | keycloak (default)                      | cognito                                                      |
| OIDC_ISSUER                               | http://127.0.0.1:8180/realms/motoros    | https://cognito-idp.REGION.amazonaws.com/POOL_ID             |
| OIDC_JWKS_URI                             | issuer/protocol/openid-connect/certs    | issuer/.well-known/jwks.json                                 |
| OIDC_TOKEN_URI                            | issuer/protocol/openid-connect/token    | https://DOMAIN.auth.REGION.amazoncognito.com/oauth2/token    |
| OIDC_USERINFO_URI                         | issuer/protocol/openid-connect/userinfo | https://DOMAIN.auth.REGION.amazoncognito.com/oauth2/userInfo |
| OIDC_SCOPES (BFF)                         | openid profile email motoros.api        | openid profile email motoros/api                             |
| OIDC_INTERNAL_SCOPE                       | motoros.internal                        | motoros/internal                                             |
| OIDC_ACCEPTED_CLIENTS                     | local BFF/customer/workorder IDs        | generated BFF/customer/workorder client IDs, comma separated |
| DELEGATING_CLIENTS                        | motoros-customer,motoros-workorder      | generated Customer/Work Order IDs, comma separated           |
| OIDC_CLIENT_ID / OIDC_CLIENT_SECRET       | local BFF                               | generated BFF credentials (server only)                      |
| SERVICE_CLIENT_ID / SERVICE_CLIENT_SECRET | per local service                       | generated per-service credentials                            |
| OIDC_LOGOUT_URL                           | discovered end-session endpoint         | https://DOMAIN.auth.REGION.amazoncognito.com/logout          |
| APP_ORIGIN                                | http://127.0.0.1:3000                   | exact approved HTTPS origin                                  |
| COOKIE_SECURE                             | false only in local runner              | true                                                         |
| OIDC_ALLOW_INSECURE_LOCAL                 | true only in local runner               | unset/false                                                  |

OIDC_AUDIENCE can remain `motoros-api` for local Keycloak. Cognito access tokens without audience are admitted only for an allowlisted `client_id` with `token_use=access`; ID tokens are rejected. User and machine scopes remain separate. The issuer output is the pool endpoint **without** the `https://` prefix; construct the issuer URL explicitly. Set Redis TLS URL, fresh encryption keys, database credentials, private service URLs and production SMTP_FROM/HOST/PORT/USERNAME/PASSWORD/AUTH/STARTTLS through the runtime secret provider. No application password is stored in MotorOS.

Staging acceptance must exercise registration/verification, recovery, callback/logout, refresh rotation, intended clients, service credentials, wrong-token rejection and live membership revocation using a real pool. Local Keycloak execution is not proof of Cognito runtime compatibility.

References: [AWS OAuth grants](https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoints-oauth-grants.html), [AWS refresh rotation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html), [Terraform app clients](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cognito_user_pool_client).
