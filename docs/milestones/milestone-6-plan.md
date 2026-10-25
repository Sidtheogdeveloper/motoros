# Milestone 6 implementation plan

Status (2026-10-25): implemented and locally verified. The following sections retain the audit and design decisions recorded before implementation. See [MILESTONE_6_REPORT.md](MILESTONE_6_REPORT.md) for actual results, resolved failures and production limitations. Milestone 7 has not started.

## Audit and baseline

The six implemented services, service-security/foundation libraries, owned Flyway migrations, synchronous reference validation, existing commercial outbox and versioned contract drafts were inspected. Notification and Analytics services do not exist yet. Inventory/Billing outbox rows currently have no publisher, claim lease, inbox or transport. Applied migrations will be preserved. Prior reports document production release limits; these are not erased by adding messaging.

Baseline commands: Maven verify; Node tests; TypeScript/production build; live Milestones 2–5 API suites; all browser suites. The API baseline passed 375 checks. The browser baseline exposed a repeat-run first-page assumption in the older booking workflow, which will be corrected using the actual search/filter controls. Final baseline build results will be recorded in the engineering report.

## Architecture and ownership

One SNS standard topic per producing service, not per event type. Notification and Analytics each have an independent SQS subscription queue and DLQ; Work Order has its own Billing approval subscription. AWS Java SDK v2 uses the same version family as existing object storage. LocalStack provides local SNS/SQS on loopback with emulator-only credentials; real AWS uses the default workload credential provider and encrypted resources. No cloud provisioning is authorized.

Producing services retain their own outbox. Database triggers for missing producers capture committed authoritative record changes in the same transaction, including legacy REST mutations. Existing Inventory/Billing writes are enriched into a uniform envelope rather than duplicated. A bounded publisher claims rows using SKIP LOCKED and an expiring lease, publishes outside the transaction, and marks success only after broker acknowledgement. Lease tokens fence stale workers. Retry delay is exponential with jitter; abandoned claims are reclaimed. Delivery is at least once, including the acknowledgement/commit crash window.

Envelopes contain UUID event/tenant/aggregate identifiers, type/version, aggregate version, producer, UTC occurrence time, correlation/causation and minimal typed payload. Customer contacts and approval tokens never enter the bus. Old commercial outbox records require explicit reconciliation instead of fabricating historical aggregate versions.

## Subscriptions, authority and ordering

Notification consumes supported appointment, repair and financial lifecycle events. Analytics consumes lifecycle snapshots for booking counts, completion/turnaround, issued invoice totals, payment collections, consumption and notification outcomes. Work Order consumes EstimateApproved, verifies the current authoritative Billing record and its own tenant/customer/vehicle links, then applies an eligible transition transactionally with its inbox entry. It never creates invoices, payments or inventory deductions from these events.

Consumers validate schema, expected producer/topic and an authoritative source event proof through narrowly scoped machine-authenticated APIs. Events are not authorization grants. Current context is resolved through the owning service; customer communication context is disclosed only for a verified source event/customer link. No cross-service SQL or stored user bearer tokens.

Durable inbox keys are (consumer,eventId), with payload identity checks. Side effects and inbox completion commit together; only then is SQS acknowledged. Projections accept only higher aggregate versions; snapshots tolerate gaps. Strict workflow actions fetch current authority. Standard queues are sufficient; FIFO would not remove inbox requirements.

## Notifications and reminders

New independently packaged Notification Service owns requests, attempts, templates, receipts and schedules. Customer Service owns consent/preferences (operational versus optional, email/SMS/WhatsApp, English/Tamil). Mailpit is the local SMTP provider. SMS/WhatsApp adapters are explicitly development sinks, never real sends. Recipient/content references are private; logs and staff APIs expose safe metadata. Existing approval-link protection is retained, with delivery ownership coordinated to avoid dual mailers.

Persistent scheduled jobs use transactional row claims, stable source/resource/template keys and current-state revalidation before enqueue and send. Cancelled/rescheduled appointments invalidate old reminders. External SMTP acceptance is not a delivery/read receipt and has an unavoidable duplicate-send window; stable Message-ID assists diagnostics, not an exactly-once guarantee.

## Failure handling, administration and observability

Queues use bounded receives, visibility delay, long polling and DLQs. Permanent schema/source/ownership failures are quarantined with safe categories; transient failures retry. Audited platform-admin APIs inspect metadata, resolve failures and redrive through the same validation/inbox path. Workshop users cannot inspect raw payloads or infrastructure credentials. Tenant/branch-scoped Notification and Analytics APIs back the UI, with pagination, filters and freshness.

Metrics cover outbox backlog/age/retries, queue depth/oldest age/DLQ, consumer failures/lag and notification outcomes. Correlation/event IDs and tracing span boundaries propagate through processing. CloudWatch/IAM/encryption/alert templates are preparation only; environment thresholds remain configurable.

## Verification

JUnit/Testcontainers exercise rollback, lease fencing/recovery, concurrent claims, inbox duplicates/changed identity, reordered versions, tenant mismatch and provider failure. Live tests run real LocalStack SNS fan-out, Mailpit delivery, stale reminder cancellation, opt-outs, approval synchronization, projection freshness, DLQ inspection/replay and cross-tenant denial. Controlled tests stop/restart the local broker and consumer and verify durable recovery without duplicate business effects. Playwright covers history, preferences, templates, reminders and authorized operations screens. Existing regressions, fresh migrations, private storage, build/type checks and secret scans remain required. Only verified results will be claimed. Commit and push the completed changes to the existing public GitHub repository after checks.
