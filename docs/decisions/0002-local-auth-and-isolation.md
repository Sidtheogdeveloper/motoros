> Superseded by [ADR 0003](0003-oidc-and-live-membership-authority.md) in Milestone 2. The custom signer/password API below describes the historical M1 baseline and has been removed.

# ADR 0002 — Local identities, signed context and explicit production gate

Accepted: 2026-10-24.

Self-service registration and password login exist only when MOTOROS_LOCAL_AUTH=true. They create a brand owner and first branch, hash the chosen password with BCrypt cost 12, and issue 15-minute HS256 JWTs with fixed issuer, audience, subject, tenant, role and branch claims. The signing key is generated on the developer's machine and ignored by Git. Tokens are validated independently by every service. Tenant identity is always taken from verified claims, never from request bodies. Client-selected branch IDs must be in signed memberships. Cross-tenant resource lookup returns 404 to limit disclosure.

Only brand owners can create branches. Creating a branch requires a new login before it appears in signed scope; already-issued tokens cannot acquire new permissions. General staff membership editing and token revocation are Milestone 2 work. Claims can remain valid for up to 15 minutes. There is no claim of immediate permission revocation.

The Next.js BFF stores tokens in HttpOnly, SameSite=Strict cookies, checks exact same-origin mutation requests, constrains upstream hosts to configured services, applies request-size limits and timeouts, and returns sanitized errors. Backend APIs use bearer tokens and do not authenticate browser cookies, so their CSRF filter is disabled. Backend ports and the development database bind to loopback. Production requires HTTPS, Secure cookies, Cognito/OIDC issuer and JWKS validation, asymmetric keys, durable/distributed rate limiting, invitation workflows and complete RBAC. Do not expose this local identity provider publicly.

Schema ownership is a cross-service database boundary. Application-level tenant filtering and composite ownership foreign keys enforce the current tenant boundary. PostgreSQL RLS is **not yet implemented**: transaction-local tenant context and pooled-connection reset behavior must be designed and tested before enabling it. Queries must continue to apply tenant predicates after RLS is introduced.

Tenant-scoped staff access to completed vehicle history intentionally spans branches. Operational work orders remain branch restricted. History retrieval writes a sensitive-access audit row. Status changes record actor, time and note in the same transaction as the change. Optimistic versions reject stale edits.
