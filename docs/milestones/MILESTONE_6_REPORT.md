# MotorOS Milestone 6 engineering report

Review date: 2026-10-25, Asia/Calcutta.

**Status: local Milestone 6 acceptance passed.** No AWS deployment, paid resources, real SMS/WhatsApp or AI execution has been performed. Milestone 7 has not been started. Production release limitations are listed below.

## Audit, baseline and plan

Inspected the actual six services, shared security/foundation/storage code, service-owned migrations, synchronous reference/financial checks, event contract drafts, commercial outbox writes, previous milestone reports, README and frontend AGENTS.md. Notification and Analytics implementations did not exist. Inventory/Billing outbox records existed without dispatch or inbox processing. The plan is [milestone-6-plan.md](milestone-6-plan.md); operational contracts and limitations are detailed in [event-reliability.md](../architecture/event-reliability.md).

Before changes: Maven verification passed 63 Java tests; Node passed 8; TypeScript and the production frontend build passed; the existing APIs passed 375 checks. Browser baseline passed 15 of 16: the older M4 booking test assumed its new appointment appeared on the first accumulated-fixture page. It now uses real registration/status filtering. No booking authorization was relaxed.

## Implemented services and workflows

- All six existing services retain their REST APIs and owned databases. Their lifecycle mutations now participate in durable event capture. Existing applied migrations were preserved.
- Notification Service (8087) owns encrypted requests, provider attempts, English/Tamil templates, schedule history, receipt storage and audits. Mailpit captures local email. SMS/WhatsApp adapters are explicit local sinks; nonlocal unconfigured channels fail closed.
- Analytics Service (8088) owns idempotent versioned projections and checkpoints. Branch views separate issued invoice values from manually recorded net payment collections, group currencies, and expose freshness/eventual consistency.
- Seven producer topics fan out to independent Notification and Analytics queues. A separate Billing subscription belongs to the Work Order approval consumer. Every subscription has a DLQ. No per-event infrastructure service was added.
- Business state and outbox records commit together. The publisher uses bounded claims, SKIP LOCKED, expiring fenced tokens, broker acknowledgment, persistent attempts and exponential retry/jitter.
- Consumers validate strict envelopes, expected topic/producer and a committed source proof. Side effects and the durable inbox commit together; acknowledgment follows commit. Changed-content or cross-tenant reuse of an event ID is denied.
- Customer Service owns versioned channel, operational/optional, language and consent preferences. Authorized source/customer resolution prevents arbitrary recipient lookups. Opt-outs and current resource state are rechecked before send.
- Booking confirmation/reschedule/cancellation, intake, inspection, repair progress/completion, readiness, delivery, estimate submission/approval, invoices and payments produce real notification workflows. Completion does not imply quality sign-off, payment or collection readiness.
- EstimateApproved resolves current Billing authority and matching tenant/customer/vehicle/job references before updating an eligible Work Order. Existing repair/task/stock financial validation remains mandatory.
- Booking owns durable appointment timer jobs and AppointmentReminderDue. Notification owns other persistent reminders and checks cancellation, rescheduling, current readiness, expiry, balance and consent. No thread is created per reminder.
- Analytics rejects older snapshots, tolerates sequence gaps through source snapshots, and reconciles bounded source-owned current-record fingerprints and authenticated feeds. Backfill/reconciliation snapshots are not published as old customer notices.
- A local-only producer journal detects recreated emulator queues and replays recent published business events through unchanged inbox/source validation. This recovers already-published but unconsumed events without a paid emulator persistence feature.
- Platform administration provides safe outbox/failure metadata, retry counts/categories, audited redrive/resolve, terminal outbox retry and consumer pause/resume. Workshop roles cannot inspect infrastructure diagnostics or raw payloads.

## Database changes

The repository now contains 52 Flyway migrations across eight service schemas: Tenant 8, Customer 8, Work Order 11, Booking 6, Inventory 5, Billing 5, Notification 5 and Analytics 4.

Owned common additions include extended outbox delivery/claim/trace metadata, aggregate event sequences, processed events, failures, projection version metadata, platform action audit, reconciliation fingerprints and local broker-generation state. Trigger functions have fixed owned search paths, without SECURITY DEFINER.

Customer adds communication preferences and consent audit. Booking adds durable appointment reminder jobs. Notification adds requests, attempts, templates, schedules, receipts and audit history. Analytics adds aggregate projections/checkpoints and reporting views. External resource IDs remain service references; no foreign key or application SQL joins across service schemas were introduced. Monetary/quantity event payloads remain exact decimal strings.

Legacy M5 outbox rows lacking a reliable historical sequence are retained for explicit reconciliation. Reconciliation snapshots are also held off transport under the documented legacy/reconciliation status. Audit-only auxiliary writes without a supported source snapshot are not silently advertised as published events. Historical notifications are not fabricated.

## Contracts and APIs

The complete envelope schema is `packages/api-contracts/events/envelope-v1.schema.json`. It documents UUIDs, producer/type/version, aggregate sequence, UTC time, correlation/causation and minimal typed payloads. Existing legacy contract drafts remain historical references.

New user APIs:

- Customer: `GET/PUT /api/communication-preferences/{customerId}`.
- Notification: `GET /api/notifications` (branch/status/customer/page), `GET /api/notifications/{id}/attempts`, `POST /api/notifications/{id}/retry|cancel`, `GET /api/notifications/templates`, `GET/POST /api/notifications/schedules`, `POST /api/notifications/schedules/{id}/cancel`.
- Analytics: `GET /api/analytics/branch`, `GET /api/analytics/projections`, both with live tenant/branch authority.
- Platform: `GET /api/platform/messaging/health|outbox|failures`, `POST /api/platform/messaging/failures/{id}/redrive|resolve`, `POST /api/platform/messaging/outbox/{id}/retry`, `POST /api/platform/messaging/consumer/pause|resume`. Mutations require an audit reason and current platform authority.

Narrow machine APIs: committed event proofs and reconciliation feeds under `/api/automation`, event-linked Customer communication context, and delegated platform-authority lookup. They do not accept public user identities as machine authority. All eight OpenAPI contracts are exported from running services in final verification.

## Frontend

- `/notifications`: branch history, status filters, delivery attempts, authorized retry/cancel, English/Tamil templates, persistent reminder queue/cancellation and customer preference editing.
- `/reporting`: source-derived branch bookings, completion/turnaround, invoice issuance, separate collections, pending approvals, parts and notification outcomes, with freshness and an explicit eventual-consistency label.
- `/platform/operations`: separate platform gate, service/queue connectivity, backlog, safe failed-event metadata, redrive/resolve and terminal outbox retry. Payloads and credentials are not exposed.

All screens use actual APIs, selected tenant/branch scope, pagination, errors/loading and the existing graphite/orange system. Source/permission denials remain authoritative. Accessible selectors were tightened after the first browser run exposed exact-label ambiguity. Screenshots are kept in ignored runtime evidence, not committed with customer/session data.

## Security and guarantees

OIDC and live Tenant authority remain in effect. Customer preference editing, notifications and branch reporting have explicit permission checks; platform checks use the current Tenant platform-admin record. Queue policy preparation uses exact source topic/account constraints and TLS; target topics/queues use a required customer-managed encryption key reference. Runtime policy generation is prepared through source analysis; it has not been attached or tested in AWS.

Events exclude contact details, complaints, approval tokens and signed URLs. Approval bodies are disclosed only to the Notification machine for the correct current customer/estimate and are encrypted at rest in delivery requests. Local SMTP refuses real non-fixture recipients. Sensitive content is cleared after acceptance/cancellation. Failure logs contain safe identifiers/categories rather than recipients or bodies.

Transport is at least once. Durable inboxes and resource checks make database effects idempotent; no exactly-once broker or external-delivery claim is made. SMTP acceptance is not a delivery/read receipt and retains a possible crash-window duplicate. Stable Message-ID is diagnostic, not provider idempotency. Future real provider callbacks must be authenticated before recording receipts.

## Verification results

| Verification                                 | Result                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Maven verification, all eight services       | 83 Java tests passed; zero failures, errors or skips                                      |
| Runtime tooling                              | 8 Node tests passed                                                                       |
| Frontend                                     | TypeScript check and production build passed                                              |
| Existing Milestones 2–5 live APIs            | 377 checks passed, including asynchronous estimate approval                               |
| Milestone 6 live integration                 | 46 checks passed                                                                          |
| Controlled reliability scenarios             | 22 checks passed                                                                          |
| Browser regression and Milestone 6 workflows | 20 tests passed; 4 Milestone 6 tests rerun successfully for final screenshot verification |
| Fresh isolated Compose infrastructure        | 52 migrations, 8 healthy services and 56 cross-schema access denials verified             |
| Production service images                    | All 8 images built; all 8 non-root containers passed live smoke checks                    |
| OpenAPI                                      | All 8 contracts exported from running services                                            |
| Messaging infrastructure preparation         | Terraform format, initialization and validation passed; not applied                       |
| Public-source safety                         | Source and reachable Git-history secret checks passed with zero findings                  |

Local evidence is retained in ignored `.runtime` results and workspace verification logs. It includes `m6-api-results.json`, `m6-reliability-results.json`, `m6-container-results.json` and the infrastructure/security review results. No credentials or customer/session screenshots are committed as evidence. Desktop and mobile preference screens were visually reviewed.

The live scenarios use Apex Motorworks (Anna Nagar, OMR, Velachery) and independent Precision Auto Care, real OIDC, PostgreSQL, LocalStack SNS/SQS, Mailpit and private object storage. JUnit uses actual PostgreSQL and focused test doubles for referenced service/provider boundaries; live suites exercise the actual service chain.

Controlled failure evidence records exactly what was done: an independent receiving subprocess exited without acknowledging while the normal consumer was paused; visibility expiry/resumption applied one request; SMTP was stopped and restarted around a durable request; the broker was stopped while a reviewed development work-order workflow committed; restart recovered both the new completion event and an earlier published/unconsumed message through the local journal. Actual commercial event replays did not create extra invoices, payments or inventory movements. Production financial consent still uses the real customer-bound workflow; the explicitly labeled development job was used only for the outage simulation.

## Issues fixed during verification

- Preserved original event timestamp precision and canonical payload ordering for duplicate proof comparisons.
- Prevented queue reinitialization from failing on semantically identical redrive-policy JSON; existing queues are retrieved and attributes updated without deletion.
- Deferred local topology initialization during broker outage so service history/APIs can start independently.
- Recovered the free emulator's lost queue state through source-owned local replay; inboxes remain unchanged.
- Corrected Windows stale bind-handle initialization by feeding the checked script directly, and verified new role authentication.
- Scoped PostgreSQL event trigger search paths and retained source correlation/causation and OpenTelemetry trace propagation.
- Kept manual provider retry attempt numbering monotonic.
- Revalidated recipients, preferences and source state before delivery; denied mismatched customer resolution.
- Preserved existing APIs/tests and corrected fixture/picker assumptions without loosening authorization.

## Remaining limits and production release concerns

1. No AWS deployment, KMS/key-policy/IAM runtime validation, ECS failure test, production identity/SMTP configuration or centralized CloudWatch/X-Ray export was run. Terraform validation is not deployment validation. The source-analysis policy baseline includes local-only/operator calls and must not be attached unchanged to production roles.
2. LocalStack is not proof of AWS durability, IAM enforcement or encryption behavior. The free emulator's restart recovery is application-assisted, with a fourteen-day local replay window. AWS mode does not create topology or run that recovery poll.
3. Real SMS/WhatsApp providers, verified delivery/read callbacks and production provider idempotency remain unconfigured. Email has an unavoidable acceptance/recording duplicate window. The UI identifies acceptance/capture honestly.
4. Existing customer operational-email defaults require deployment policy/consent review before enabling real sends. Optional follow-ups remain disabled without consent; built-in templates are deployment-managed rather than a tenant template editor.
5. Reconciliation/backfill is bounded and eventual, not a real-time completeness guarantee. High-volume throughput, fairness across very large tenants, exhaustive process-kill/network-partition/soak, backup/restore and disaster recovery remain untested.
6. Source proof/inbox/schedule retention and cleanup require an approved deployment policy. No automatic destructive purge is enabled; source proofs must cover the supported one-year schedule horizon and inboxes must outlive all permitted replays. Failure inspection exposes retry counts/latest categories; durable notification attempts provide individual delivery history.
7. Database role isolation and predicates remain the tenant boundary; database RLS is not claimed. Normal application roles cannot access another service's schema. Earlier milestone tax/manual-payment/PDF/inspection limitations still apply.

## Readiness and GitHub

The implemented local event, notification, reconciliation and recovery workflows meet the exercised Milestone 6 acceptance checks. No critical local test failure remains. This is readiness for review and planning of Milestone 7, not authorization or evidence for a production deployment. The provider, cloud security, retention and scale concerns above remain production release gates.

No work has proceeded to Milestone 7. The Milestone 6 changes include source, README, the existing MIT license, migrations, contracts, tests and this report for the existing public MotorOS repository. GitHub CI configuration is updated; local checks do not imply a successful remote Actions run. The associated source commit identifies this reviewed implementation.
