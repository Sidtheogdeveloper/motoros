# MotorOS Milestone 7 engineering report

Date: 2026-10-25 (Asia/Calcutta). Status: locally validated deployment preparation; AWS release gates remain open. No AWS resources, ECR publications, real notifications or AI services have been created. Milestone 8 has not started.

## Audit and baseline

Inspected AGENTS.md, Next.js self-hosting/proxy documentation, architecture/identity/commercial/event contracts, Milestones 1–6 reports, all eight services, service-owned migrations, current Terraform, Docker images, CI and the actual Redis-backed BFF session flow. Existing Cognito/messaging modules were extended. No business service was recreated.

Repeated baseline: Java verification passed 83 tests; Node passed 8; frontend type/build passed; Milestones 2–5 APIs passed 377 checks; M6 integration passed 46 and controlled recovery 22. Fresh Compose applied 52 migrations with eight health checks and 56 privilege denials; eight non-root service images passed container smoke. Browser baseline passed 19/20: the M5 test confused estimate approval display with the asynchronously updated job state. The test now waits for authoritative job state. A subsequent edit exposed an encoding-dependent label selector, corrected without changing product authorization.

## Implemented locally

- Nine independently deployable application images, including the real standalone Next.js frontend/BFF; one-off private initialization/migration tooling, no extra business monolith.
- Cloud profiles, bounded pools, verified database TLS/CA bundle, graceful shutdown and health probes; automatic Flyway disabled on app replicas. Migration-only launch never starts HTTP/schedulers and restricts runtime Flyway history access to SELECT.
- Cognito generated-client mapping and claim tests; TLS/IAM session credentials with renewal; runtime CSP/upload origin; secure callback/logout configuration and public platform-route denial.
- Reusable Terraform environment composition, separate staging/production roots/state, bootstrap state/KMS/native locks, VPC/private subnets/SGs/default-SG closure, ECR, ECS/Service Connect TLS, RDS, Valkey, private S3, existing SNS/SQS/DLQs, Cognito and scoped roles/secrets.
- Runtime/migration/operator/execution/publication/deployment/plan/read-only responsibilities; private metadata, exact environment checks, protected OIDC subjects, scoped PassRole and plan-hash authorization.
- Manually authorized build/publish/plan/apply/promote/deploy workflows, image digest manifests, serial migration evidence, known-healthy rollback checks, circuit-breaker outcome verification and source-linked production promotion.
- CloudWatch bounded application metrics, structured encrypted logs, dashboards/alarms, CloudTrail, VPC flow logs and redacted BFF ingress logs, production WAF, configurable budget alerts and staging task schedules.
- Current-price snapshots/reproducible cost scenarios, security review, setup/configuration/deployment/troubleshooting/recovery runbooks and prepared cloud smoke tests.

## Validation

| Check                                                 | Result                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Java reactor / JUnit / Testcontainers                 | Build passed; 87 tests, no failures                                                                                                                                                                                                                                            |
| Node unit tests                                       | 15 passed, including release-artifact token rejection, TLS cache configuration, 15-minute IAM signing and immutable release/environment guards                                                                                                                                 |
| Frontend                                              | TypeScript and production build passed; standalone image built                                                                                                                                                                                                                 |
| Browser regression                                    | 20/20 passed, including OIDC, cross-tenant denial, private upload, workshop, inventory, approval, payment and notifications                                                                                                                                                    |
| Milestones 2–5 live APIs                              | 72 + 91 + 105 + 109 checks passed; final M5 rerun explicitly enabled both async-approval assertions                                                                                                                                                                            |
| Milestone 6 integration                               | 46 passed                                                                                                                                                                                                                                                                      |
| Controlled local broker/consumer/provider recovery    | 22 passed                                                                                                                                                                                                                                                                      |
| Fresh local infrastructure baseline                   | Compose started; 52 migrations, 8 health checks and 56 cross-schema privilege denials passed                                                                                                                                                                                   |
| Cloud migration-only mode against isolated PostgreSQL | 52 migrations, 16 migration-only launches, 24 read-only validation launches and 72 privilege denials passed; no application context started                                                                                                                                    |
| Backend images                                        | All 8 built and passed non-root/read-only container smoke at 0.5 vCPU/1 GiB local limits, real delegated APIs and private history/documents                                                                                                                                    |
| Frontend image runtime                                | Same image passed two runtime origins, non-root/read-only 896-MiB limit, health/HSTS/CSP, private-route denial and redacted logs                                                                                                                                               |
| Operator image                                        | Built; AWS CLI and PostgreSQL client execute as non-root; no cloud initialization run                                                                                                                                                                                          |
| Terraform                                             | All 6 local roots/modules validate; formatting and 8 mocked-provider/security tests pass; TFLint passes                                                                                                                                                                        |
| Security / CI                                         | Checkov: initial scan 492 passed / 0 failed / 36 resource-specific exceptions; populated task scan 414 passed / 0 failed / 18 exceptions; actionlint passes; 10 final images have zero unexcepted HIGH/CRITICAL findings; source/reachable-history secret scan has no findings |

Runtime-only validation also rejected changed migration checksums and accepted a synthetic future migration during rolling-version compatibility tests.

The existing browser test was made repeatable by selecting capacity through the real availability API, in addition to waiting for authoritative async approval. Invalid capacity was never bypassed. Trivy 0.76.1, Checkov 3.3.30, TFLint 0.59.1 and actionlint 1.7.7 were used locally. OpenVEX non-applicability is limited to two exact Spring advisories and expires on 2026-11-25; library-level matches are not claimed patched. Local results do not demonstrate AWS IAM, Service Connect or ElastiCache handshake behavior.

Source secret checks scan reachable Git history as well as current files. No credential bundle, Terraform state/plan, object content, session, screenshot or raw private trace is committed. Existing MIT licensing is preserved.

## Security findings and decisions

Removed five high frontend image findings by excluding unused npm tooling. Backend scans prompted compatible OS/Jackson/Netty/Tomcat/HTTP Core/PostgreSQL JDBC patches and AWS SDK version alignment. Exact-version OpenVEX records two non-applicable Spring MVC view/SSE cases, with vendor references and a feature/expiry gate. These remain library-level matches, not patched-library claims. Per-resource Checkov exceptions document deliberate staging/retention/rotation/KMS/access-log/DR decisions; they are not a blanket scanner bypass. See security-review.md for details and production concerns.

## AWS API validation versus deployment

Read-only STS authentication succeeded. ECR inventory succeeded and listed no repositories in Mumbai. ECS/RDS/Cognito/ACM/ElastiCache inventory failed with account-subscription/activation errors. Pricing API queries succeeded for documented regional products. The reported connected identity was root; deployment tooling refuses it. These facts do not demonstrate working IAM runtime policies, ECS, databases, login or messaging in AWS.

Successfully deployed to staging: **No**. AWS staging smoke, SES delivery, ElastiCache IAM handshake, Service Connect certificate rotation, KMS enforcement, circuit-breaker rollback, restore/RPO/RTO, real load/soak and production security are **not yet tested**. No Terraform apply or paid resource creation was attempted.

## Required inputs and remaining release gates

Resolve account activation; configure a real short-lived role, exact domain/ACM/DNS, verified SES credentials/recipients, approved state/policy references, protected GitHub environments, synthetic Cognito test accounts and budget contacts. The provisioning policy is an explicitly reviewed input, not an automatically attached administrative baseline. Manual coordinated application-key rotation, private administrator access, cross-region recovery decisions, operational retention/privacy and earlier financial/object-validation limits remain production-review items.

Readiness: the source and local deployment tooling are ready for infrastructure/security review, **not approved for AWS deployment or production**. The prepared AWS smoke includes synthetic tenant/branch checks and real token-expiry refresh; it has not run. Restore request and bad-image tooling exist, but isolated restored-data verification remains a private operator procedure, with no measured RPO/RTO. The AWS X-Ray/ADOT exporter is not configured; existing spans/correlation and CloudWatch metric configuration are not a verified cloud tracing installation. Load/soak, Service Connect proxy headroom and live connection-budget measurements remain required.

Dated Mumbai planning totals are $598.42/month always-on staging, $373.56/month weekday staging and $1,338.12/month production baseline, including explicitly unpriced reserves of $60/$60/$100. Persistent resources remain chargeable during task scale-down. These are assumptions-based estimates, not approved budgets or spending caps; see the reproducible cost report and AWS rate snapshots.

Milestone 8 remains unstarted. No bootstrap, Terraform apply, ECR push, SES message or AWS recovery exercise was performed.

The implementation/report are intended for the existing MotorOS repository; the final handoff records the pushed commit. Remote Actions success is not implied by local checks. Production deployment needs a separate review and authorization.

## GitHub CI follow-up — 2026-10-25

The initial push (`56b9ae3`) produced ten failed checks: eight backend image scanners, infrastructure validation and the regression workflow. Java builds, TypeScript, Node tests, the frontend build and frontend image checks passed remotely. Local success did not cover these three CI configuration differences:

- The provider lockfiles contained the Windows `h1` checksum but omitted Linux's unpacked-package checksum. With `-lockfile=readonly`, Linux initialization could not add it and subsequent validation rejected the cached provider. Official Terraform `providers lock` output now supplies both platform checksums to every root/module.
- Trivy's YAML setting is `vulnerability.vex`, not a top-level `vex`. CI therefore reported the same two previously reviewed Spring advisories. The corrected configuration is tested through the actual CLI configuration path; the feature/expiry applicability guard remains active and no severity gate is disabled.
- The fresh-schema harness starts only PostgreSQL. Spring's SMTP health contributor was still enabled even though test mail delivery was disabled, so clean runners without SMTP reported unhealthy. Only this schema harness now excludes SMTP health; full application/provider checks and actual registration verification email remain enabled. The harness passed with SMTP explicitly unreachable.

Shared scanner-policy changes now select all nine application images for validation, with a regression test for changed-service detection. Security workflows fetch complete Git history. Follow-up unit checks pass 16 tests. Remote workflow outcomes must be checked on the corrective commit; none of these changes authorize AWS deployment.
