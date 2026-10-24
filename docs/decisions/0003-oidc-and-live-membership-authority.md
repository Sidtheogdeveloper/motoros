# ADR 0003: OIDC identity and live membership authority

Status: accepted for Milestone 2, supersedes ADR 0002 authentication details.

Use Keycloak for local OIDC and configure Cognito with the same code/PKCE, JWKS and client-credentials boundary for AWS staging. Use a server-managed Next.js session with encrypted Redis token storage. Keep tenant authorization in the Tenant Service, independent of IdP groups. Resolve membership on every request; authorize internal calls with both confidential machine identity and the original verified user token. Disable the original custom password authentication and symmetric token signer entirely.

This costs an internal authority lookup on resource requests and makes authority availability part of API availability. Fail closed, bound timeouts, propagate correlation IDs and measure before introducing any permission cache. Separate domain databases/schemas remain owned by each service. Add an encrypted transactional mail outbox for invitation delivery. Retain issuer/subject identity and require explicit mapping for legacy users; matching email alone is insufficient.

Cognito configuration is validated as infrastructure code only. Production compatibility must be demonstrated against a real approved staging pool before deployment. See the identity architecture and milestone report for tested guarantees and outstanding operational work.
