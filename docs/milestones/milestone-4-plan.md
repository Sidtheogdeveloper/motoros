# Milestone 4 implementation plan

## Audit/baseline

Extend the existing Tenant/Customer/Work Order/BFF; no Booking scaffold exists. M3 baseline: 34 Java, five Node, 163 live API checks pass; 11/12 initial browser checks pass, inherited invitation-mail timeout recorded. Run baseline Maven/Next builds before code changes. Existing private object protocol, registry pages, context guards and completed-service timeline are reused.

## Modules and data

- Independent Booking Service :8084 / booking_app / booking schema. Appointments, status history, scheduling snapshots and capacity reservations. External customer/vehicle/staff references are validated via authenticated APIs, never cross-schema joins. Explicit states and optimistic versions.
- Tenant exposes branch operations configuration (timezone, hours, closed dates, parallel appointment capacity), minimal eligible technician directory, unavailable intervals and audited workshop qualification attestations. Appointment capacity is distinct from a single slot; branch advisory locks and an interval sweep enforce concurrency.
- Work Order extends job cards with customer/appointment/advisor/technician references, unique branch-safe numbers and lifecycle timestamps; owned intake, tasks/history, assignments, inspections/templates/findings/reviews, quality checks, private photos, audit/status history, approval-contract records and idempotency results.
- Extract the existing S3 abstraction to a small shared infrastructure package used by Customer and Work Order; keep metadata and authorization service-owned. No shared domain database tables.

## APIs / coordination

Implement requested appointment, check-in, job/task/assignment, inspection, QC/workload and board APIs. Booking check-in reserves CHECK_IN_PENDING, calls idempotent Work Order intake, then commits CHECKED_IN. Retrying uses the same operation key and reconciliation record; no distributed DB transaction or fire-and-forget publication. Odometer submission uses an externally keyed idempotent Customer API. Appointment completion is reconciled through verified Work Order status rather than fabricated events.

States are explicit. Mechanic mutations require the assigned job/task plus active branch authority. Eligibility is re-read from Tenant on assignment, qualification review and QC. Safety-related inspection findings require a separately qualified human review. QC requires completed work and inspection, records reviewer/checklist/decision/time, and creates a rework task on rejection.

Financial approval is NOT implemented as billing. Production approval-dependent transitions remain blocked until M5 integration. Local-only, manager-permitted development approval is enabled solely for the local profile and loopback Keycloak issuer, records simulation identity/reason and is visibly labeled. Legacy status endpoints use the same guard. M1–M3 fixture lifecycle helpers will execute actual M4 inspection/approval/QC APIs.

Prepare versioned event schemas only; no unreliable event transport. M6 outbox/SQS remains deferred.

## Frontend and verification

Use the existing graphite/amber design, guarded registry shell, modal and controls. Add booking calendar/list/detail/reschedule; intake/receipt; job board/directory/detail with tasks, assignment, inspection/photos/QC/history; mechanic workload/my-jobs views. Every action uses APIs with version/idempotency conflict handling, branch timezone and responsive states.

Tests: JUnit/Testcontainers scheduling/state/capacity/idempotency/assignment/inspection/QC and upgrade preservation; real OIDC/API/storage checks and Playwright complete lifecycle. Use Apex Anna Nagar/Velachery/OMR and Precision denial fixtures. Preserve M1–M3 coverage, rebuild all four services, regenerate OpenAPI, test fresh Compose and non-root containers. Record verified/incomplete behavior in MILESTONE_4_REPORT.md. No M5 implementation or AWS provisioning.
