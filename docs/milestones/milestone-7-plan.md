# Milestone 7 implementation record

Approved scope: deployment preparation in ap-south-1, nine existing application workloads, Terraform, private data/task networking, short-lived identity, reliable M6 messaging, controlled migrations, image/digest workflows, observability, cost controls and recovery tooling. No AWS creation, ECR publication, real messaging or Milestone 8 work is authorized in this phase.

Decisions: preserve the SSR Next.js BFF; add private TLS/IAM Valkey because login depends on Redis; reuse Cognito/messaging Terraform; map generated OAuth IDs explicitly; separate runtime/migration roles; keep services stopped until migrations succeed; use Service Connect TLS and native S3 state locks; retain service-owned schemas and M6 inbox/outbox semantics. Staging is lean/synthetic; production prepares redundancy separately. Account, HTTPS domain, SES configuration, protected GitHub environments, policy/budget inputs and cloud verification remain deployment prerequisites.

Baseline and final evidence, fixes, scanner exceptions and readiness are recorded in MILESTONE_7_REPORT.md. Complete local checks before commit/push. The prepared staging suite and restore/rollback exercises must be executed only after explicit AWS authorization; their existence is not a successful cloud test.
