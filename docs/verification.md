# Milestone 1 verification

> Historical initial-handoff results. The later [Milestone 1 engineering review](../MILESTONE_1_REVIEW.md) supersedes this document for current fixes, test counts, container verification and readiness.

Verified on 24 October 2026 (Asia/Calcutta), Windows, Java 21.0.12, Node 24.18.0, Docker 29.6.2 and PostgreSQL 17.6. Maven 3.9.11, Spring Boot 3.5.16, Next.js 16.4.3, React 19.3.1 and Playwright 1.64.1 were used. This is a local foundation release, not a production readiness certification.

| Check                      | Result                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Root `npm run dev`         | PASS: bootstrapped checksum-verified Maven, started PostgreSQL, built/tested services, waited for health and started Next.js |
| Java build/test            | PASS: 14 tests, no failures, errors or skips; three executable service JARs packaged                                         |
| PostgreSQL integration     | PASS: real Testcontainers PostgreSQL for all three services                                                                  |
| Real HTTP security suite   | PASS: 13 checks against the three running applications                                                                       |
| TypeScript                 | PASS: `npm run typecheck`                                                                                                    |
| Production frontend build  | PASS: `npm run build`                                                                                                        |
| Browser tests              | PASS: four Chromium tests; final run 9.3 seconds                                                                             |
| Schema privilege isolation | PASS: Customer role cannot SELECT from Tenant schema                                                                         |
| Live OpenAPI export        | PASS: all three specifications in packages/api-contracts/openapi                                                             |
| Visual review              | Inspected desktop dark and mobile light screenshots; tested 390px page overflow                                              |
| AWS provisioning           | Not performed; no AWS resources created or public deployment attempted                                                       |
| Remote GitHub CI           | Not run; verification workflow defined locally; no repository pushed                                                         |
| Service image builds       | Not run; Dockerfile supplied, executable JAR/native startup verified                                                         |
| Optional LocalStack        | Not run; SQS/S3 profile is configuration for future milestones                                                               |

Java tests: AccessTest (4), OnboardingIntegrationTest (2), CustomerIntegrationTest (3), StatusTest (3), WorkOrderIntegrationTest (2). These cover tenant/branch/role checks, missing role denial, onboarding persistence and passwords, customer/vehicle isolation and ownership, input validation, state transitions, rework, stale versions and audit consistency. The Work Order integration test uses an explicitly test-only downstream HTTP fixture. The separate HTTP suite tests actual service-to-service authorization and history retrieval.

The real HTTP suite verifies foreign-tenant vehicle/history denial, same-brand cross-branch history, invalid transitions, foreign branch selection, unauthenticated access, tampered/expired/wrong-audience JWT rejection, mechanic shared-history access and operational/write restrictions, and customer denial on staff APIs. Two synthetic fixture brands each have two branches, a customer, vehicle, completed work order and active work order. No external notifications are sent.

Browser tests verify onboarding → sign-in → customer → vehicle → work order → check-in → new branch → sign-out/sign-in → branch switching. They also verify cross-branch history rendering, Escape dismissal, dark/light themes, mobile page overflow, unauthenticated API rejection, cross-origin rejection and oversized-request rejection. Screenshots are under docs/previews.

Commands executed from repository root:

```text
npm install
docker compose up -d --wait postgres
mvn -B verify                 # workspace Maven in initial runs
npm run dev                   # final run bootstrapped scripts/maven.ps1 verify
npm run typecheck
npm run build
npm run fixtures
node tests/integration/isolation.mjs
node scripts/export-openapi.mjs
npx playwright install chromium
npx playwright test
```

Initial issues corrected during verification: Windows bootstrap compatibility and shell-script line endings, Docker client API compatibility, resolver dependency conflict, onboarding JPA/JDBC flush ordering, and BFF origin validation when Next.js reconstructs the request URL.

Computer Use initialization and app inventory worked, but browser inspection was stopped by the plugin because it could not confidently determine the current browser URL. No further desktop input was issued. Browser verification used Playwright.

## Security and remaining work

Local authentication is opt-in and services bind to loopback. Use 127.0.0.1 consistently. BFF mutations validate against APP_ORIGIN, defaulting to http://127.0.0.1:3000. Set it explicitly for a changed origin. COOKIE_SECURE=false is only for local HTTP testing of a production build. Tokens remain in HttpOnly cookies, not localStorage. Secrets and fixture credentials are generated locally and ignored by Git and the source archive.

Production Cognito/OIDC, TLS, asymmetric keys, distributed throttling, complete RBAC, immediate revocation and RLS remain unfinished. Registration creates brand owners; invitations and per-branch staff administration are next. The UI is a workshop operations foundation, not a completed mechanic/customer portal. Audits cover work-order changes and sensitive history reads; broader customer/vehicle write audits remain future work.

Status names do not implement estimate approval, billing or inventory. Appointments, inspections, notification providers, event consumers/outbox, all five AI capabilities, Terraform, subscriptions, retention/export, later-module concurrency/performance testing and backup procedures are future milestones. No simulated AI or fake revenue is presented. Lists currently load the first 100 records, and API DTOs are maintained by hand alongside exported OpenAPI.

Recommended next milestone: production authentication and multi-branch staff management, including invitations, permissions, revocation and tenant-isolation defense in depth. See the preserved master brief, product scope and architecture decisions for the remaining roadmap.
