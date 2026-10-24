# MotorOS Milestone 2 engineering report

Review date: 24 October 2026. Scope: the existing reviewed repository, implemented code, real local infrastructure, executable services and production-built Next.js application. No AWS resources were provisioned. Milestone 3 was not started.

## Verdict

Core local Milestone 2 acceptance is verified: real identity-provider registration and email verification, transactional onboarding, multi-brand/branch administration, emailed manager/mechanic invitations, live permissions, cross-branch history, cross-tenant denial and immediate membership revocation. Local critical acceptance tests pass. This is a development milestone, not a production deployment approval. Cognito configuration validates as infrastructure code, but actual Cognito runtime compatibility and production operations remain unverified.

## Baseline and preservation

Before changes, inspected the Tenant, Customer and Work Order implementations, shared security, BFF/UI, schemas, migrations, contracts, architecture, ADRs, AGENTS instructions and Milestone 1 review. Baseline passed: **21 Java tests, five Node tests, 38 HTTP checks and six browser tests**. The reviewed Milestone 1 source ZIP remains a recoverable checkpoint. Original domain records and PostgreSQL volume were preserved.

The original HS256/password APIs and JWT-role authorization were temporary foundations. They were removed rather than retained as an authentication bypass. Historical test sources that depended on them now live under `tests/legacy/`; active commands run the new OIDC tests. The final suites retain customer/vehicle/work-order lifecycle verification through the new identity boundary.

## Implemented architecture

- **Identity:** local Keycloak 26.8.1 and configurable OIDC discovery/JWKS endpoints; Authorization Code with PKCE S256, state, nonce, verified ID token and verified email. Registration, verification and password recovery are hosted by the provider. Keycloak verifies email before password enrollment.
- **Application sessions:** opaque HttpOnly cookie, encrypted server-side tokens in password-protected Redis, eight-hour absolute expiry, five-minute access tokens and rotating refresh tokens. Atomic login transaction consumption, distributed refresh lock and compare-and-swap session updates protect concurrent refresh, selection changes and logout. Production cookies default Secure; insecure OIDC is permitted only for explicitly configured loopback development. No access/refresh token is returned to browser application state or localStorage.
- **Authority:** Tenant owns immutable issuer/subject identities, active tenant/branch memberships and the explicit permission matrix. Customer and Work Order independently validate provider JWTs, then obtain current membership through authenticated service clients. User permission decisions are not cached. Internal delegation validates both an allowlisted machine bearer with internal scope and the independently signed original user token. Arbitrary authorization headers cannot bypass it.
- **Context:** the BFF stores active tenant server-side, checks live permission before switching, and denies stale-tab requests whose expected brand differs. Tenant URL IDs must match authorized selection. Resource lookups apply tenant predicates and branch checks. UI query namespaces include identity, tenant, permission context and branch where appropriate.
- **Mail:** Mailpit receives local provider and staff emails. Invitation metadata and encrypted outbox commit together; SMTP retries are bounded to five attempts. Delivery status is visible. SMTP endpoint, credentials, STARTTLS and sender are configurable for an approved production environment.
- **Audit:** administrative events persist actor, tenant, applicable branch, action, target, outcome, time and correlation ID. Denied authority decisions survive rollback. Resource services emit structured security denial logs. Correlation propagates across internal requests. Access logs exclude bodies, bearer tokens and URL query secrets; Next request logging is disabled for callback/invitation confidentiality.

See [identity architecture](../architecture/identity-and-authorization.md), [ADR 0003](../decisions/0003-oidc-and-live-membership-authority.md) and [role matrix](../architecture/role-permission-matrix.json).

## Database and ownership

Tenant Flyway **V2** extends tenants/branches and adds platform_users, tenant_memberships, branch_memberships, roles, permissions, role_permissions, staff_invitations, invitation_branches, invitation_mail_outbox and audit_events. UUID identities, foreign keys, tenant-composite branch links, unique tenant branch codes, status/scope constraints, timestamps, useful indexes and optimistic versions protect the model.

V2 preserves legacy staff IDs for references, renames the old table and drops password_hash. Legacy identities and memberships become MIGRATION_REQUIRED; no automatic email match can claim ownership. The explicit development migration maps only database-confirmed synthetic workshops and example.test accounts. Production identity migration requires operator-controlled issuer/subject mapping.

Tenant, Customer and Work Order schemas remain owned by separate database roles; Keycloak uses its own database/role. Four Flyway migrations (Tenant V1/V2, Customer V1, Work Order V1) pass on a fresh temporary Compose volume. Six cross-schema usage denials were verified. **PostgreSQL RLS is not enabled**; explicit resource predicates and ownership constraints remain essential.

## Functional APIs and screens

[API documentation](../api/README.md) and exported OpenAPI snapshots in `packages/api-contracts/openapi/` describe the implemented service routes. They include authentication integration, tenant list/create/read/update, branch create/list/detail/update/status/hours/settings, staff directory/detail/roles/assignments/deactivation, invitations/list/accept/resend/revoke, memberships/permissions, privileged brand status administration and audits. Listings use page/size bounds; staff search and role/branch filters execute in PostgreSQL. Errors are sanitized and correlated. The BFF implements session logout; direct APIs are stateless bearer resources.

The existing design system now includes hosted-auth entry pages, welcome/onboarding, invitation acceptance, account profile, brand chooser/switcher, brand settings, branch directory/profile/forms, opening hours/settings, staff directory/profile/access editor, invitation delivery/status/actions and privileged platform administration. Sensitive status/access changes prompt confirmation. Owners have all-branches overview; managers have assigned branches; mechanics lack customer administration, brand settings and work-order creation. History displays the originating branch name without exposing its staff/contact directory. Desktop and 390px mobile layouts were visually inspected; wide data tables scroll within their panels.

## Acceptance verification

| Required workflow                    | Verified evidence                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Register, verify email and sign in   | Browser uses real Keycloak registration and Mailpit verification, then password enrollment/code-PKCE callback         |
| Create workshop and become owner     | Browser onboarding persists brand, first branch and ownership atomically; database tests reject incomplete operations |
| Create/manage multiple branches      | Real API and browser creation, unique code rejection, settings/hours editing; new branch visible without new JWT      |
| Invite Branch Manager and accept     | Owner UI sends real email; intended verified identity explicitly accepts; replay/wrong identity denied                |
| Manager sees assigned branches       | Browser selector and live API both contain only the assigned branch; unauthorized modifications rejected              |
| Invite Mechanic and restrict screens | Real mail/acceptance; customer/staff/create actions hidden and backend permissions deny manipulation                  |
| Branch and brand switching           | Browser all-branches and brand switch; server rejects unauthorized tenant selection and stale-tab context             |
| Same-brand cross-branch history      | OMR mechanic retrieves completed Anna Nagar record; operational branch scope remains restricted                       |
| Cross-tenant access denied           | Brand, branch, vehicle, history and search checks against the unrelated fixture tenant                                |
| Deactivated staff loses access       | The same still-valid JWT immediately fails Customer and Work Order access; browser reload loses workspace             |
| Secure internal authorization        | Real machine/user delegation succeeds; forged user headers, machine-only context and invalid original user token fail |
| Protected routes/session restoration | Real reload retains opaque session; unauthenticated protected route redirects; forged callback fails                  |
| Password recovery/profile            | Real reset email and new password login; application profile save persists through reload                             |
| Session expiration/logout            | Redis session expiry leaves workspace; deleted cookie cannot replay; browser provider logout requires login again     |
| Privileged suspension                | Ordinary owner denied platform access; explicit operator suspends/restores brand and same JWT loses resource access   |
| Local environment                    | Health-checked Compose infrastructure, host services and production-built frontend; fresh migration verification      |

Tests use synthetic example.test identities and local mail only. Live tests use actual signatures, PKCE callbacks, SMTP delivery, Redis and all service APIs. JUnit database tests intentionally mock provider userinfo or remote resolvers to isolate service logic; those tests alone are not presented as end-to-end identity proof. Expiry/refresh tests shorten ignored test-session metadata instead of waiting eight hours. Invitation expiry is adjusted in the synthetic test row. Platform tests temporarily grant a fixture-only database flag and revoke it afterward.

## Final checks

| Check                                           | Result                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Java 21 Maven verify after clean build          | **26 tests passed**, zero failures/errors/skips; all shared/service modules package successfully                                        |
| Node unit tests                                 | **5 passed**                                                                                                                            |
| TypeScript                                      | Passed                                                                                                                                  |
| Next.js production build                        | Passed; production server exercised by browser/API suites                                                                               |
| Live OIDC/API security suite                    | **72 checks passed**                                                                                                                    |
| Production-mode Playwright                      | **9 passed**, including registration/verification, mail invitations, recovery, profile persistence, expiry and provider logout          |
| Fresh Compose volume                            | Passed: four migrations, three service health endpoints, schema owners and six privilege denials                                        |
| Development fixtures without legacy login files | Passed through real OIDC and business APIs; existing records preserved                                                                  |
| Service image builds/container smoke            | Passed: three non-root images, advertised port/health, real JWKS validation, authenticated internal delegation and cross-branch history |
| OpenAPI export                                  | Three authenticated service contracts regenerated                                                                                       |
| Terraform 1.13.5                                | fmt, init -backend=false and validate passed with locked AWS provider; no plan/apply                                                    |
| npm production dependency audit                 | Zero reported vulnerabilities at verification time                                                                                      |
| Source/generated-secret scan                    | No findings; .env/runtime/credential fixtures ignored                                                                                   |

Machine-readable sanitized evidence is in [m2 evidence](../milestone-2-evidence/results.json). Historical M1 evidence remains separate. Test logs and credential-bearing local diagnostics stay in ignored/runtime or task-local work files; they are excluded from source delivery.

## Issues found and fixed during review

- Replaced the custom password signer and stale role/branch claims with JWKS validation and live authority, eliminating the original access-revocation gap.
- Required signed user identity plus authenticated service identity for internal authorization; neither caller-controlled tenant headers nor machine identity alone grant business access.
- Added missing provider email/profile/basic subject mappers; retained strict subject validation instead of weakening it when real tokens lacked sub.
- Protected concurrent refresh/brand selection/logout with atomic session updates, preventing lost context and session resurrection.
- Added a stale-tab guard so a brand switch cannot apply an old screen's mutation to a different brand.
- Fixed Spring proxy field access in history/audit controllers by moving queries behind service methods; added database-backed regression tests.
- Fixed staff detail lookup beyond the first page and pushed staff filtering/pagination into database queries.
- Added tenant-row locking and authority rechecks around membership mutations; concurrent owner revocations cannot remove the final active owner.
- Fixed Cognito-compatible validation for access tokens with no aud claim; allowlisted client_id and token_use=access remain mandatory on that path.
- Removed obsolete custom-password setup/test commands, added guarded fresh-install fixture creation, and updated CI to exercise the actual OIDC application.
- Corrected container SMTP configuration to use the Compose service hostname rather than container loopback; transport health checks remain enabled.
- Made browser CRUD assertions target the unique synthetic registration so suites remain repeatable when fixture records are retained.

## Remaining limitations and security concerns

1. **Cognito runtime is untested.** Valid Terraform and local OIDC success do not prove AWS hosted login, email, refresh, logout or M2M behavior. Approved staging execution is required before production.
2. **Production operations are not established.** No AWS deployment, TLS/private network rollout, managed secret injection, backup/restore exercise, HA Redis, durable audit export, monitoring, rate-limit/load/failure testing or production email deliverability is claimed. Local Keycloak start-dev and Mailpit must stay private development infrastructure. Production MFA policy and abuse controls still need deployment-level configuration.
3. **RLS is deferred.** Database schema separation is verified, but tenant isolation inside a service schema depends on the enforced application predicates and composite constraints. A future RLS rollout needs pooled-connection/transaction-context tests.
4. **Customer self-service is deferred.** CUSTOMER exists with no staff permissions; personal account-to-customer/vehicle ownership linkage and a customer portal are not implemented. Platform operators have explicit administrative status controls without implicit sensitive tenant-data access.
5. **Future modules remain future work.** Booking, inventory operations, estimate/invoice flows and AI features are permission catalog entries, not implemented products. No AI orchestrator bypass exists.
6. **Scale/UX debt remains.** Operational customer/vehicle/work-order screens retain the M1 first-100 limit. Large-tenant invitation listing still filters scoped metadata in the service before paging; measure/refactor before large-scale rollout. Management tables scroll horizontally on small screens. General create requests lack idempotency keys; avoid automatic POST retries.
7. **Mail is at-least-once.** A transport success followed by a database failure can deliver duplicate messages. Single-use invitation consumption prevents duplicate access grants. Retry exhaustion is shown but operational recovery/alerting needs production procedures.
8. **Bearer/session distinction matters.** Application logout invalidates the BFF session immediately and ends the provider browser session. An independently copied, otherwise valid access token can remain cryptographically valid until its short expiry; live membership deactivation still denies its business access immediately. In-flight reads admitted before a revocation can finish.
9. **Repository history is unavailable.** The inherited repository has no commits/tracked source. Current source and generated local secrets were scanned; a history-based assertion about previous commits cannot be made. No commit identity, push or remote CI result was fabricated. CI configuration was updated but GitHub execution was not performed.
10. **Validation has limits.** npm audit is not a full Java/image vulnerability assessment. No penetration test, browser matrix beyond Chromium, real outage/load exercise, SMTP failure/retry exhaustion exercise or production recovery validation was performed. CSP retains the existing inline-script allowance; production nonce hardening remains work before public exposure.

## Readiness for Milestone 3

Core local acceptance and critical tenant/security checks pass; no known blocking failure remains in the verified local workflows. The repository can proceed to Milestone 3 development after this review, while the production/Cognito/scale limitations above remain tracked prerequisites for deployment. **Milestone 3 has not been started.** AWS resources and paid services were not modified.
