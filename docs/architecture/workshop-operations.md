# Workshop operations (Milestone 4)

Booking is an independent Spring Boot service on 8084 with `booking_app` owning the `booking` schema. Tenant owns branch calendars, closures, capacity, staff membership, qualifications and availability. Customer owns identity, current and historical vehicle ownership, odometers and customer documents. Work Order owns intake, job cards, repair tasks, observations, private workshop photos, assignments, parts requests and quality review. No operational query joins another service's schema. Each service builds independently with `mvn -pl services/<name>-service -am package` and the common service Dockerfile accepts `--build-arg SERVICE=booking`.

## Trust and permissions

Browser requests use the existing opaque Redis BFF session, expected-tenant header and same-origin checks. Each backend validates the original OIDC identity and resolves current Tenant membership. Delegated calls additionally require an allowlisted machine client with the internal scope and the original signed user token. Client-supplied tenant and branch identifiers never establish authority. Assigned technicians can update their job/task; assignment, advisor details, financial simulation and QC remain separate permissions. Cross-branch completed history is read-only and tenant scoped; it grants no permission to edit the originating branch.

Tenant adds WORKORDER_INSPECT, WORKORDER_INSPECTION_REVIEW, WORKORDER_QUALITY_CHECK, WORKORDER_DEV_APPROVAL and WORKORDER_PHOTO_WRITE. Managers explicitly attest a different employee's review competence. Attestation does not independently grant a role permission. Deactivated staff, inactive branches, unauthorized assignments and unavailable employees fail Tenant validation. By default QC reviewers must differ from the job and completed-task technicians. Safety-related attention findings and high-severity observations require a separate qualified human review. No AI or digital checklist certifies roadworthiness.

## Booking and concurrency

Times are UTC instants. Opening-hour, overnight-window and closure checks use the branch's IANA timezone. Duration is 15–480 minutes; capacity is 1–100 and defaults to the configured service bays. Interval sweep counting permits multiple simultaneous appointments and treats touching interval boundaries as non-conflicting. Branch advisory transaction locks serialize capacity decisions; an additional tenant/technician lock protects technicians across multiple branches. Availability is advisory until the booking transaction commits. A version check protects rescheduling and appointment updates. Cancelled and no-show appointments release reservations. Checked-in visits retain their reservation until the explicit reconciliation endpoint verifies delivered/closed Work Order state.

## Check-in coordination and recovery

1. Booking saves the immutable intake request and its stable key in PENDING state, then releases its transaction.
2. Work Order validates current customer/vehicle ownership, active branch and advisor through authorized APIs. It writes the Customer-owned odometer using a deterministic external-reference UUID, so an acknowledged remote write is safe to repeat after a local rollback.
3. Work Order atomically writes its intake, job, audit and operation key. Appointment-linked intake has a unique tenant/appointment constraint. Human job card numbers use a branch counter and full branch UUID to avoid collisions.
4. Booking records the returned intake/job identifiers and CHECKED_IN state. A timeout or rejection leaves RETRY_REQUIRED; `/appointments/{id}/reconcile` retries the saved request and key. It never guesses that a remote write failed.

The frontend retains a request key across unchanged intake retries. Domain creation, task creation, checklist creation and photo grants require stable Idempotency-Key headers. Reuse with changed input is a conflict. Operations use local transactions; no distributed database transaction is claimed. Odometer external references make compensation unnecessary for an acknowledged reading; a failed intake can leave an auditable reading without a local intake until retry succeeds. A permanently invalid saved appointment intake currently needs an operator-assisted correction; no unsafe reset endpoint is provided. Reconciliation is explicit, not a background event consumer.

## Lifecycle and approval boundary

The status enum has explicit transitions; controller gates apply equally to the legacy `/status` route. Inspection must complete before estimate preparation. Approvals and QC cannot be entered through a raw transition. QC requires completed tasks and inspection. Rejection records reviewer/time/reason, returns IN_PROGRESS and creates a high-priority rework task. Pass records the checklist and sign-off before READY_FOR_DELIVERY. Tasks have their own legal transitions, versions and audit history.

Billing approval is not implemented. `/development-approval` requires manager permission, a reason, an enabled flag, the `local` Spring profile and the exact loopback development issuer. It writes DEVELOPMENT_SIMULATION, visibly labels the UI and is unavailable to production identities. Rejection/revision returns to estimate preparation. Production repair entry remains blocked until Milestone 5 provides an authenticated approval contract. Local runners explicitly enable this simulation; deployed services default it off.

## Photos and history

Customer's proven S3 implementation is extracted to `packages/object-storage`; the Customer adapter preserves its existing public API and tests. Workshop metadata belongs only to Work Order. PNG/JPEG uploads are bounded at 10 MB, safe-named and signed for five minutes with declared type, size and SHA-256. Completion checks bytes/checksum/type and publishes to a different private key, preventing reuse of a staging URL to alter published content. Every download reauthorizes tenant/job/branch and grants a 60-second URL. Local SeaweedFS is credentialed and private. This is not a malware scanning pipeline or an image transcoding service.

Completed history reuses the Customer → Work Order delegation chain, adding Work Order-owned completed repairs, recorded parts, technical notes, intake odometer and recorded recommendations with source identifiers. It does not copy the whole history into a second database. Recorded recommendations are observations, not an assertion that a later repair remains outstanding. Production privacy/retention policies and malware scanning remain release work.

## Future events

`packages/api-contracts/events/workshop-v1.schema.json` defines versioned source references and payloads for the requested eleven event types. There is no fire-and-forget publisher, queue transport or pretend outbox. Milestone 6 must persist domain changes and outbox records atomically, then deliver with consumer deduplication and replay. Correlation IDs already traverse HTTP and mutation audits.

## UI and local verification

Routes: `/appointments` (paginated list/day calendar/today/filter/reschedule), `/check-in` (appointment or walk-in intake and receipt), `/jobs` and `/jobs/{id}` (job details/tasks/parts/notes/photos/inspection/QC/history/audit), `/operations` (paginated Kanban), `/mechanic` (my jobs), `/workload` (actual tasks/counts/remaining duration, qualification attestation and availability). Existing charcoal/orange UI primitives and protected layouts are reused. Estimates are explicitly approximate task sums; historical task duration currently measures elapsed wall time from first start, including blocked intervals.

Use `npm run infra`, `npm run storage:configure`, build the Maven reactor, start `node scripts/run-services.mjs` and `node scripts/frontend.mjs`. All four services expose authenticated OpenAPI contracts exported by `npm run export:openapi`. Existing M2/M3 fixtures are preserved. Fresh fixture generation follows the real inspection, development approval, task and separate-reviewer QC APIs. `npm run test:api:m4` creates invited OMR staff using existing Apex/Precision fixtures, configures synthetic branch schedules and records credentials only in ignored `.runtime/m4-fixtures.json`. Run API fixtures before the M4 browser suite.
