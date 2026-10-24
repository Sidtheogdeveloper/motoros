# MotorOS Milestone 5 engineering report

Review date: 2026-10-25 (Asia/Calcutta).

**Status: Milestone 5 local engineering acceptance passed.** The final API, browser, container, build, migration and source-secret checks passed. Production release limits are documented below. Milestone 6 has not been started. No AWS deployment or paid cloud resources were created.

## Scope and baseline

The actual Tenant, Customer, Work Order and Booking implementations, authorization library, architecture documents, previous milestone reports, frontend components and Flyway migrations were reviewed. The existing services were extended rather than recreated. Inventory and Billing did not have existing service implementations.

Before changes, the Maven reactor passed 46 Java tests, the live suites passed 268 API checks, and Playwright passed 14 browser tests. An initial Node-check request was blocked by an account approval-review usage limit; it was not counted as an executed test. That limitation subsequently cleared and Node/frontend checks executed successfully.

The implementation plan is [milestone-5-plan.md](milestone-5-plan.md). The final ownership, transaction and coordination decisions are documented in [commercial-operations.md](../architecture/commercial-operations.md).

## Implemented functionality

### Inventory and branch transfers

- Independently packaged Inventory Service on port 8085, using its own PostgreSQL schema and login role.
- Tenant-owned catalog with normalized unique SKUs, OEM/manufacturer/category metadata, supplier references, staff-reviewed compatibility notes, selling/purchase prices, currency, optimistic versions and soft archiving.
- Supplier creation, paginated lookup and catalog selection.
- Branch on-hand, reserved, available and reorder balances, low-stock filtering, receipts and an immutable movement ledger.
- Authorized corrections, damage, loss, supplier returns and customer returns. Adjustment direction and remaining available stock are validated.
- Retry-safe work-order reservations, release and consumption. Closed/cancelled jobs can release outstanding reservations; they cannot consume more stock.
- Consumption requires an in-progress job, a current customer-approved estimate and an aggregate consumed quantity within the approved part scope. The verified approval ID/revision is retained with consumption.
- Transfer requests, source approval/reservation, source dispatch, transit, partial receipt, completion, rejection and pre-dispatch cancellation.
- Employees assigned to either endpoint may request a same-tenant transfer using a restricted branch-reference API. This grants no authority to operate the other branch's stock. Source approval/dispatch and destination receipt retain their separate branch checks.
- Damaged and explicitly missing quantities require adjustment authority and evidence. They never enter usable destination stock. Unresolved quantities remain in transit.
- Transactional row locks, deterministic multi-part locking, database balance/conservation constraints, versions and input-bound idempotency keys protect simultaneous operations.

### Estimates and customer consent

- Independently packaged Billing Service on port 8086, using its own PostgreSQL schema and login role.
- Branch labor rates, currency, workshop identity, configured tax labels/rates and payment-before-delivery policy.
- PART, LABOR, INSPECTION, SERVICE and MISC estimate lines. Catalog part prices and branch labor rates are fetched/selected by the backend; client totals are never trusted.
- Decimal arithmetic with explicit per-line HALF_UP rounding; submitted snapshots retain their exact financial values. Commercial HTTP decimals are strings, and the UI formats them without floating-point conversion.
- Draft editing, submission, approval/rejection, explicit revisions, superseding, cancellation and expiry. Submitted line/snapshot immutability is enforced by PostgreSQL triggers.
- Submission freezes the job's repair-task scope. New optional tasks cannot silently inherit a previous approval.
- A recipient-bound link is delivered through an encrypted, transactional local SMTP queue. Tokens are random, hashed in the decision table, expire within 24 hours and never outlive the estimate.
- Decisions require the selected tenant's live CUSTOMER membership, the provider-verified intended email, the correct token, the exact estimate version and a pending state. Staff estimate permissions do not constitute customer consent.
- Approval links use URL fragments and are excluded from server request paths, audit payloads and exported source artifacts. JWTs remain in the existing encrypted server session.
- An expiry worker commits state, token revocation, audit and outbox records together. It does not expire an already accepted contract merely because its acceptance window later ends.

### Workshop, invoice and payment integration

- Work Order independently verifies Billing's approval and retains the authoritative estimate/revision reference. Repair/task updates recheck current approval; unapproved optional work is rejected.
- Mechanic parts requests now accept three decimal places and stable retry keys. A fulfillment command verifies an installed reservation belongs to the same tenant, branch and job, matches the requested quantity and has not already fulfilled another request.
- Commercial QC rejects unresolved parts requests. Genuine recorded QC rework is distinguished from new optional work.
- Commercial QC sign-off remains pending financial readiness. A manager command verifies the issued invoice and branch payment policy before ready-for-delivery; delivery rechecks readiness.
- Invoice drafts copy the approved estimate and customer/workshop/vehicle snapshots. Issuing requires matching approval, quality sign-off and Inventory proof that approved parts were installed.
- Transactional tenant/branch/year counters and database uniqueness protect invoice numbering. Issued invoice snapshots and lines cannot be edited; separate credit adjustments and refunds preserve the original document.
- Private, deterministic, paginated invoice PDFs, authorized 60-second download URLs and content-digest metadata. Existing issued PDFs retain their original snapshot.
- Manual cash/UPI/card/bank/other payment recording, partial balances, outstanding-invoice filtering, duplicate receipt-reference protection, original-payment refunds, credit/refund-due calculations and separately authorized reconciliation.
- Recorded digital payments and refunds are ledger entries, not claims of gateway verification or bank disbursement. There are no structured card-number, expiry or security-code fields.
- Completed cross-branch vehicle history reads actual consumed parts from Inventory through authenticated service APIs. Fulfilled request notes are not counted again as separate installed stock.

## Database ownership and migrations

There are six service-owned schemas and roles. No new cross-service database joins, cross-service foreign keys or distributed database transactions were introduced.

| Service    | Migration changes                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant     | V5 commercial permissions; restricted transfer branch-reference APIs use existing owned data                                                                                                                     |
| Customer   | Existing V1-V4 preserved                                                                                                                                                                                         |
| Work Order | V5 approval/readiness references; V6 repair/rework provenance; V7 verified stock fulfillment; V8 fractional parts requests                                                                                       |
| Booking    | Existing V1-V2 preserved                                                                                                                                                                                         |
| Inventory  | V1 catalog, suppliers, balances, movements, reservations, failures, transfers, history, operation keys and outbox; V2 consumption approval and discrepancy provenance                                            |
| Billing    | V1 settings, versioned estimates/items/decisions, encrypted mail queue, invoices/items/counters, private document metadata, payments/refunds/credits, audit, operation keys and outbox; V2 lookup/expiry indexes |

Fresh initialization comprises **23 successful versioned migrations**. Balance constraints enforce nonnegative stock and `reserved <= on_hand`; receipt constraints enforce dispatched-quantity conservation. Owned composite foreign keys include tenant identity. Mutable aggregates have versions/timestamps; immutable ledgers and snapshots are append-only or trigger-protected.

## API contract summary

All staff routes enforce live server-side permissions and tenant/branch scope. Retry-sensitive mutations require stable `Idempotency-Key` headers. Versions detect stale updates. Errors use the existing consistent problem response and correlation ID.

| Area                    | Implemented routes                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog                 | GET/POST `/api/parts`; GET/PATCH `/api/parts/{id}`; GET/POST `/api/suppliers`                                                                                                       |
| Stock                   | GET/PATCH `/api/inventory/stock`; POST `/api/inventory/receipts`, `/adjustments`; GET `/api/inventory/movements`                                                                    |
| Reservations            | GET/POST `/api/inventory/reservations`; GET `/{id}`; POST `/{id}/release`, `/{id}/consume`                                                                                          |
| Transfers               | GET/POST `/api/inventory/transfers`; GET `/{id}`; POST `/{id}/approve`, `/reject`, `/cancel`, `/dispatch`, `/in-transit`, `/receive`                                                |
| Branch references       | GET `/api/stock-transfer/branches` and `/{id}` in Tenant Service; minimal same-tenant metadata, not operational branch access                                                       |
| Commercial settings     | GET/PUT `/api/billing/settings`                                                                                                                                                     |
| Estimates               | GET/POST `/api/estimates`; GET/PATCH `/{id}`; POST `/{id}/submit`, `/revise`, `/cancel`, `/approval-preview`, `/approve`, `/reject`                                                 |
| Invoices                | GET/POST `/api/invoices`; GET `/{id}`; POST `/{id}/issue`; GET `/{id}/pdf`, `/{id}/payments`; POST `/{id}/adjustments`                                                              |
| Payments                | POST `/api/payments`, `/api/payments/refunds`, `/api/payments/{id}/reconcile`                                                                                                       |
| Workshop contracts      | POST `/api/work-orders/{id}/commercial-approval`, `/ready-for-delivery`, `/parts`, `/parts/{partId}/fulfill`                                                                        |
| Internal read contracts | Work-order context/history, authoritative approval/readiness, installed quantities and completed consumed-part history; trusted service bearer plus original user identity required |

Runtime-exported contracts reside in [packages/api-contracts/openapi](../../packages/api-contracts/openapi). Exact-decimal and versioned commercial-event schemas are included alongside them. Core request bodies are typed; several operational response shapes still use generic maps and should be tightened before public SDK generation.

## Frontend screens

The existing graphite/orange design system, account/tenant guards, accessible dialogs, branch controls and command helpers were extended:

- `/inventory`: catalog, suppliers, branch stock, thresholds/low stock, receipts/adjustments, movement ledger, job reservations and installation recording.
- `/transfers`: requests in either direction, source approval/dispatch, destination receipt, discrepancies and history.
- `/estimates` and `/estimates/{id}`: pricing configuration, multi-line drafts, immutable revisions, submission and decision state.
- `/approval`: secure customer review and version-bound approval/rejection.
- `/invoices` and `/invoices/{id}`: outstanding queue, issue, private PDF, payments, reconciliation, credits and recorded refunds.
- Job detail: commercial context, approval verification, installed-stock fulfillment and financial readiness.

Actions call real APIs. Lists have pagination/filtering, loading/errors, denied-access behavior and stable retry keys. Pagination controls inside forms do not submit the form. Transfer receiving uses actual SKU/name data rather than internal identifiers.

## Security controls

- Original OIDC issuer/subject identities and live Tenant Service membership/permissions remain authoritative; client role/branch claims are not trusted.
- Database roles separate service schemas; application predicates and owned constraints enforce tenant isolation. Database RLS is not claimed.
- Separate inventory-cost, stock reservation/transfer/adjustment, estimate, invoice and payment permissions were added. Mechanics do not receive financial administration or purchase-cost access.
- Source and destination transfer permissions are checked at the authoritative steps. Reference metadata does not grant operational access.
- Customer approval is independent of staff authority and bound to recipient, tenant, customer, vehicle, work order, version, expiry and state.
- Invoice issue cannot use the development approval simulation. Legacy development fixtures remain explicitly labeled and local-only.
- Sensitive mutations retain actor, source references, timestamps and correlation/audit records. Approval tokens and signed object URLs are not audit payloads.
- Normal application launchers remove operator/sibling credentials; backends receive their own database/client credentials and only needed storage/mail secrets. Frontend processes receive their session/provider credentials.
- Private objects remain private without their short-lived signed URLs. No production credentials are embedded in images or source.

## Transactional outbox and Milestone 6 boundary

Inventory and Billing commit business mutations and versioned outbox records in the same local transaction. Required events include PartReserved/ReservationFailed/Consumed/ReservationReleased, transfer Requested/Approved/Dispatched/Received, EstimateCreated/Submitted/Approved/Rejected, InvoiceIssued and PaymentRecorded/Reconciled.

Envelopes retain event ID/type/version, tenant, branch, aggregate, occurrence time, correlation and structured payload. Rows remain PENDING. There is no SQS dispatcher, fire-and-forget publication, exactly-once claim or AI Orchestrator. Financial authority remains deterministic and permission-controlled.

## Verification results

| Verification                                 | Result                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Java reactor build and JUnit/Testcontainers  | Passed: 63 tests, zero failures/errors/skips. Focused Inventory verification repeated after the final receiving-label query change.                                                                                                                                             |
| Node unit checks                             | Passed: 8 tests, including process credential scoping and exact decimal display.                                                                                                                                                                                                |
| Next.js TypeScript and production build      | Passed.                                                                                                                                                                                                                                                                         |
| Live API regression/acceptance               | Passed: 375 checks (M2: 72, M3: 91, M4: 105, M5: 107).                                                                                                                                                                                                                          |
| Browser regression/acceptance                | Passed: all 16 tests in the final complete rerun, including the booking-to-delivery commercial workflow.                                                                                                                                                                        |
| Fresh Docker Compose database/infrastructure | Passed: 23 Flyway migrations, six health endpoints and 30 cross-schema privilege denials.                                                                                                                                                                                       |
| Service container images                     | Six non-root images built and smoke-tested successfully: six health endpoints, real OIDC/JWKS, delegated authorization, cross-branch history, private documents/photos/invoice PDF, booking references and disabled-by-default development approval.                            |
| OpenAPI export                               | All six running service contracts exported successfully.                                                                                                                                                                                                                        |
| Invoice PDF                                  | New issued private PDF downloaded with authorization; exact 708.00 total and 108.00 tax verified by PDF extraction. Render visually reviewed: complete identifiers, readable line amounts, margins and footer. Desktop invoice and mobile inspection screenshots also reviewed. |
| Source secret scan                           | Passed: 354 source files and 33 generated secret values checked, zero findings. No tracked files or commits exist; Git history verification is therefore vacuous. Ignored local runtime secrets are excluded from the source package.                                           |

The final API run is recorded in `.runtime/m5-api-results.json`. Local verification logs are in the workspace `work/` directory; generated credentials and test evidence remain ignored. The browser harness was corrected to search/filter the new booking instead of assuming it appears on the first page of accumulated fixtures. A separate local Chromium `ERR_NO_BUFFER_SPACE` navigation failure was observed; the final complete rerun passed. The extra six-container smoke fleet initially exhausted shared local PostgreSQL connection slots, so the harness now explicitly uses a three-connection maximum/one idle connection per test service. Container readiness requests have a five-second timeout and consume response bodies, with startup logs saved on failure. Production connection budgets must be sized for the deployed replica count. No application authorization was weakened to resolve test failures.

JUnit/Testcontainers use real PostgreSQL for migrations, constraints, locking, ledger behavior, persistence and isolation. Referenced service contracts are explicitly stubbed in those focused tests. The live API and Playwright suites exercise the actual six-service/OIDC/private-storage chain.

The mandatory development scenario uses Apex Motorworks with Anna Nagar, OMR and Velachery, plus independent Precision Auto Care. It registers the vehicle at Anna Nagar, services it at OMR, obtains real customer consent, installs reserved stock, completes qualified QC, issues/pays the invoice and exposes completed service/part history to an authorized Velachery employee. Precision employees and an independently authorized Precision owner cannot access Apex records. Additional checks cover retry/duplicate attempts, fractional requests, additional-work denial, scoped incoming transfers, partial receipts, credits/refunds and private documents.

## Issues found and resolved

- Added the missing secure PUT proxy method required by commercial settings.
- Corrected closed-job reservation release while retaining closed-job consumption denial.
- Made consumed parts visible through authorized cross-branch history APIs.
- Bound optional repair work and part consumption to actual customer-approved scope.
- Prevented invoice issue before verified quality sign-off and recorded installation.
- Closed mechanic requests through verified Inventory references, preventing duplicate fulfillment and unresolved-request QC.
- Added branch-only transfer request references without broadening stock-operation permissions.
- Preserved fractional quantities and idempotency for mechanic requests.
- Eliminated generic JSON decimal precision loss and floating-point display of commercial amounts.
- Corrected invoice PDF wrapping/decimal presentation and receiving-screen part identification.
- Removed inherited operator/sibling credentials from normal app processes.
- Corrected test fixtures to respect existing customer/manager scopes; no authorization checks were loosened to make a test pass.

## Remaining limits and release concerns

1. The compact PDF renderer supports ASCII text with accent normalization. Embedded Unicode fonts are required before multilingual invoice rollout; database/UI customer text remains Unicode.
2. Tax is a configured branch rate/label, not a complete jurisdictional tax engine or certified GST/e-invoice implementation. Legal/accounting review remains necessary before live billing.
3. Payments/refunds are manually recorded. Gateway verification, automated bank settlement and actual electronic disbursement are outside this milestone.
4. Customer self-service is limited to recipient-bound estimate decisions. An expired link currently requires an explicit revised estimate rather than a same-version resend workflow.
5. Load/soak testing, disaster recovery, production SMTP/identity-provider configuration, cloud IAM/secrets/network validation and AWS deployment were not performed. Local concurrency/regression results do not establish production-scale readiness.
6. Outbox delivery/retries/consumer coordination are intentionally deferred to Milestone 6. Event transport must not be enabled by assuming pending rows were already delivered.

## Readiness

Critical Milestone 5 local acceptance tests pass, and Milestones 1–4 regressions remain operational. The repository is ready for Milestone 6 implementation planning around the versioned transactional outbox contracts. This is not approval to enable event transport or deploy: resolve the applicable production release concerns above before live financial operation, and size connection budgets across all service replicas. The full source package excludes generated credentials, database data, dependencies, compiled artifacts and test-session evidence.

No work has proceeded to Milestone 6. No paid AWS resources, deployment, AI execution or payment-gateway transactions were created.
