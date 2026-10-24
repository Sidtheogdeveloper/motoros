# MotorOS — Milestone 4 engineering report

Reviewed and implemented locally on 24 October 2026 (Asia/Kolkata).

## Result and readiness

Core Milestone 4 workflows are implemented and the mandatory local acceptance scenario passes. The final verification covers 46 Java tests, five Node tests, 268 live API checks and 14 browser tests against the production Next.js build. Four service Docker images build and pass local non-root runtime smoke checks. Fresh Compose initializes all four service schemas, applies 14 migrations and denies all 12 directed cross-schema access attempts.

Milestone 4 is ready for review and subsequent Milestone 5 engineering under the limitations below. No Milestone 5 implementation, AI Orchestrator, AWS deployment, registry push or paid cloud resource creation was performed. This report does not certify production release readiness. Production estimate approval remains deliberately blocked pending a real Billing contract.

Machine-readable verification summary: [milestone4-results.json](evidence/milestone4-results.json). Implementation decisions: [milestone-4-plan.md](milestone-4-plan.md) and [workshop operations architecture](../architecture/workshop-operations.md).

## Audit and preserved baseline

Read the repository instructions, actual Tenant/Customer/Work Order implementations, existing API contracts, service-owned migrations, architecture and milestone reports before implementation. No Booking Service scaffold existed. Reused the OIDC/BFF session model, live Tenant authorization, private object protocol, registry/history APIs, UI primitives, source-reference conventions and local process runners.

Baseline: 34 Java tests, five Node tests and all 163 M2/M3 API checks passed. Maven and Next.js production builds passed. Eleven of 12 baseline browser tests passed; the existing invitation test timed out waiting 20 seconds for an SMTP retry scheduled after 30 seconds. Recipient-specific Mailpit search and a polling window covering that retry corrected the test. The final browser run passes all original 12 tests plus both M4 tests.

The existing quick CREATED → CHECKED_IN → INSPECTION actions remain functional; later overview actions open the guarded job workflow. Legacy job creation remains supported for compatibility. Complete intake data is captured by `/check-in` and `/api/check-ins`; a legacy minimal job card is not retrospectively represented as a full intake record. Old completed records and all prior migrations remain intact.

## Implemented functionality

- Independent Booking Service: create/view/update/reschedule/confirm/cancel/no-show; paginated upcoming or bounded date lists, today, branch/category/status/search filters and a day calendar. UTC storage and branch-timezone display/validation. Explicit status history and versions.
- Scheduling: opening hours including overnight windows, closure/holiday dates, bounded service duration, configured parallel capacity, assigned-technician booking conflicts and staff unavailable intervals. Branch and technician advisory transaction locks prevent concurrent overbooking across branches.
- Intake: appointment or walk-in, current vehicle/customer ownership verification, odometer, complaint, service request, damage, fuel, accessories, server timestamp and advisor identity. Receipt links to the persisted job. Appointment-linked check-in saves PENDING / RETRY_REQUIRED / COMPLETE coordination state and stable request keys.
- Job cards: tenant/branch-safe database-unique numbers, priority, permitted detail edits, versioned assignments, lifecycle timestamps, explicit transitions, task priorities/assignees/statuses/duration, technical/additional-work notes and required-part requests/received/used records. Cancelled jobs also cancel unfinished tasks with history.
- Technician operations: active authorized staff lookup, unavailable periods, qualification attestation, actual assigned tasks/counts/remaining estimates, branch manager workload view and mechanic-specific jobs. Individual task assignments also include the job in the mechanic's list. Counts follow backend filters, not fabricated UI statistics.
- Inspection: seeded 11-category general template, configurable tenant-owned templates, per-visit snapshots, conditions/severity/notes/private photo references, progress, recommendations and completion gates. Safety-related attention/high-severity observations require separate qualified staff review.
- Quality control: reviewer assignment, completed-work/inspection gates, separate-reviewer policy, checklist, signed decision, reviewer/time/notes, explicit failed-QC rework task and READY_FOR_DELIVERY only after authorized approval.
- Private workshop photos: PNG/JPEG, safe names, size/type/checksum validation, five-minute staged upload grants, backend byte verification, immutable published keys and 60-second authorized downloads. Customer documents retain their own service-owned metadata and existing APIs.
- Authorized cross-branch history: existing Customer → Work Order REST delegation, augmented with completed repairs, recorded parts, technical notes, intake odometer and recorded recommendations. Source identifiers are retained; no duplicated history database or cross-schema join.

## Database changes

| Service | New migrations | Owned changes |
|---|---|---|
| Tenant | V4 operations authority | Five permissions, staff review capabilities/attestations, unavailable intervals and lookups |
| Customer | V4 intake odometer references | Tenant-unique external UUID for retry-safe odometer submission |
| Work Order | V3 workshop operations; V4 query indexes | Extended work orders, counters, intake, operation keys, tasks/history, assignments, notes, parts, templates/items/findings, inspections, QC, development decisions, status/audit records, private photo metadata; tenant-scoped detail/history indexes and status constraints |
| Booking | V1 booking operations; V2 coordination integrity | Categories, appointments, capacity reservations, schedule snapshots, status history, operation keys; coordination/duration constraints and tenant-scoped reference/audit indexes |

All customer/vehicle/appointment/staff references across services are external UUIDs validated through authorized APIs. Foreign keys are confined to a service's own schema. Versions and row/transaction locks protect mutations. Four executable JARs and Docker images are independently buildable through the Maven reactor/common service Dockerfile.

## Endpoint contracts

Authenticated exports are under `packages/api-contracts/openapi/{tenant,customer,workorder,booking}.json`. Public contract exports mark retry-sensitive Idempotency-Key headers as required, although controller binding accepts absence so the domain can return a consistent error. Values must be stable 16–100 character keys; changed input with a committed key is rejected.

| Area | Endpoints |
|---|---|
| Appointments | POST/GET `/api/appointments`; GET/PATCH `/{id}`; POST `/{id}/confirm`, `/reschedule`, `/cancel`, `/no-show`; GET `/api/appointments/availability`; GET `/api/service-categories` |
| Coordination | POST `/api/appointments/{id}/check-in`, `/{id}/reconcile`; POST `/api/check-ins`; GET `/api/check-ins/{id}` |
| Jobs | POST/GET `/api/work-orders`; GET/PATCH `/{id}`; POST `/{id}/transition`; compatible PATCH `/{id}/status`; GET `/{id}/audit`; GET `/api/work-orders/board` |
| Tasks | POST `/{id}/tasks`; PATCH `/{id}/tasks/{taskId}`; POST `/{id}/tasks/{taskId}/start`, `/complete` |
| Staff | POST `/api/work-orders/{id}/assign`; GET `/api/technicians/workload`; Tenant branch operations/technicians and staff eligibility APIs; qualification and unavailable-period mutations |
| Inspection | GET/POST `/api/inspection-templates`; GET/POST `/api/work-orders/{id}/inspections`; GET/PATCH `/api/inspections/{id}`; POST `/{id}/complete` |
| QC | POST `/api/work-orders/{id}/quality-check`, `/quality-check/approve`, `/quality-check/reject` |
| Notes/parts/photos | POST `/{id}/notes`, `/{id}/parts`; PATCH `/{id}/parts/{partId}`; POST `/{id}/photos`, `/{id}/photos/{photoId}/complete`; GET `/{id}/photos/{photoId}/download` |
| Local simulation | POST `/api/work-orders/{id}/development-approval` — manager permission, explicit reason, local profile/flag and loopback issuer only |

Versioned definitions for all eleven requested future events are in `packages/api-contracts/events/workshop-v1.schema.json`. No event transport or fire-and-forget publication is claimed; transactional outbox/SQS remains Milestone 6 work.

## Frontend screens

`/appointments`, `/check-in`, `/jobs`, `/jobs/{id}`, `/operations`, `/mechanic` and `/workload` use real backend APIs, existing graphite/amber controls, protected layouts, branch selection, pagination/filtering, accessible actions, loading/errors and record-version conflict responses. Job detail contains repair tasks, notes/parts, inspection, photos, QC, source history and status audit tabs. Staff workload permits manager qualification attestation and unavailability recording. The job board is paginated and uses authorized detail transitions rather than frontend-only status changes. Day calendar/list views are implemented; drag-and-drop and week/month calendars are not claimed.

Screenshots from the real fixture workflows: [desktop board](evidence/m4-board-desktop.png), [mobile job/inspection](evidence/m4-inspection-mobile.png).

## Security and coordination controls

- Original OIDC token signature/issuer/audience validation plus live trusted Tenant membership/permission checks on backend operations. Delegated calls additionally require an allowlisted service bearer; client-supplied branch or tenant IDs establish no authority.
- Mechanics can update only their assigned jobs/tasks, add technical notes/photos and request parts. They cannot reassign work or grant themselves approval/QC roles. The added regression test verifies notes/parts do not accidentally require job-creation authority while job creation remains denied.
- Assignment rejects inactive staff, unauthorized branches and unavailability; optimistic versions prevent lost updates. QC and safety review require both role permission and a manager-attested qualification. Self-attestation is denied. Target-role hierarchy and all assigned branches are checked for scoped managers, matching existing staff administration.
- Inspection and QC gates also cover legacy status APIs. Estimate rejection/revision is explicit. DEVELOPMENT_SIMULATION is persisted/audited and visibly labeled. Real production identities cannot use it, and ordinary container defaults disable it.
- Work Order commits intake/job/audit/key atomically. Customer odometer writes use the deterministic external UUID for safe retry after a local rollback. Booking never assumes an uncertain remote write failed: it persists the request/key and exposes reconciliation. Delivered/closed/cancelled job state is verified through Work Order before reservation release.
- Private object staging/publication separates mutable upload keys from published data. Every grant/download is reauthorized. Cross-tenant requests return denial/not-found; anonymous object reads are denied. Correlation IDs traverse BFF, delegated HTTP and committed audit records.
- Source scanning found no generated local secrets or credential patterns. `.env`, identities/session data and logs are ignored. The repository currently has zero tracked files and zero commits; a historical committed-secret check is therefore vacuous, not evidence of an audited remote Git history. No PR/CI execution is claimed.

## Verification results

| Verification | Result |
|---|---|
| Maven `verify` | 46 tests, zero failures/errors/skips; four executable service JARs built |
| Node unit tests | 5 passed, including owned-process failure/readiness handling |
| Next.js | Typecheck and optimized production build passed |
| Live M2/M3/M4 API suites | 72 + 91 + 105 = 268 checks passed |
| Playwright | All 14 tests passed against the production build |
| Fresh Compose/PostgreSQL | Four healthy services, 14 migrations, four service-owned schemas, 12 cross-schema privilege denials |
| Docker builds/runtime | Four non-root images; real JWKS/authority/delegation, cross-branch history, booking create/cancel, private photo/doc downloads and production-default simulation denial passed |
| Fresh fixture workflow helper | Real inspection → manager local simulation → repair → separate qualified QC → delivery → CLOSED passed |
| Secret/source scan | Zero findings; runtime configuration excluded |

Testcontainers uses actual PostgreSQL; external-service contract servers and mock authority are explicitly test-only in service integration tests. The 268 live checks and Playwright use actual OIDC, backend services, PostgreSQL and credentialed object storage. The dedicated recovery test injects an HTTP 503 and verifies persisted retry state, successful reconciliation, changed-input denial and cancellation release. This is not an exhaustive process-kill/network-partition test matrix.

The M4 live suite registered an Apex customer/vehicle at Anna Nagar, booked and serviced it at OMR, checked in twice with the same key without a duplicate job, rejected overbooking and simultaneous stale assignments, denied unauthorized/deactivated technicians, validated staff unavailability, uploaded/read private photos, required qualified review of a brake finding, denied mechanic financial approval, recorded parts, completed repairs, failed QC and performed rework, then passed QC and delivered/closed the job. An authorized Velachery mechanic saw the OMR completion. Precision Auto Care was denied the vehicle, job, photos and timeline. Browser automation separately exercised booking through delivery with advisor, mechanic and separate reviewer identities.

## Known limitations and release work

1. Production financial estimate approval is intentionally absent. Milestone 5 must provide a trusted, versioned approval contract before production repairs can enter approval-dependent states. Local simulation is not a substitute.
2. Booking reconciliation is an explicit authenticated operation, not an event/background worker. A permanently invalid saved intake request currently needs operator-assisted correction; the API does not allow an unsafe reset while a remote commit could be uncertain. A remote odometer reading may persist before a local intake rollback, then be reused on retry. Operational recovery tooling should precede production release.
3. Availability uses branch hours, closures, booking reservations and staff unavailable intervals. No optimization engine, bay-specific planning, manufacturer procedures, inventory stock control or automatic repair-duration scheduling is claimed. Workload duration is an estimate; actual task elapsed time includes blocked intervals.
4. Calendar UI is a day view/list; the board pages up to 100 cards. Workload returns a bounded recent task sample with separate authoritative counts. Template configuration is available through APIs; an advanced visual template builder is not included.
5. Photos/documents have metadata/checksum/signature controls, not malware scanning or transcoding. Orphan staging cleanup, retention, consent, backup/restore and production S3 policy/KMS/AV validation remain release work. Signed URLs remain bearer capabilities until their short expiry.
6. PostgreSQL service-role isolation and tenant predicates are verified; row-level security remains deferred. Distributed caches of permissions are not introduced. Production IdP/network/IAM/ECS behavior, disaster recovery, sustained load and hostile multi-process fault testing are unverified locally.
7. General inspection templates and digital sign-off are workshop records, not manufacturer-approved procedures or certified safety/roadworthiness assessments. Recorded history recommendations do not automatically establish that work is still outstanding after later repairs.
8. Legacy minimal job creation is preserved; use the new intake workflow when complete check-in evidence is required. No backfill invents odometer, fuel, photos or signatures for old visits.

No critical mandatory acceptance failure remains in the tested local workflow. Keep the production approval and operational-release gates explicit when planning Milestone 5; do not claim production deployment readiness from these local results.
