# Commercial operations architecture — Milestone 5

## Ownership and local topology

| Service | Port | Schema / database role | Authoritative records |
|---|---:|---|---|
| Tenant | 8081 | tenant / tenant_app | Live memberships, roles, branches, qualifications |
| Customer | 8082 | customer / customer_app | Customer/contact data, vehicles, ownership, documents |
| Work Order | 8083 | workorder / workorder_app | Intake, tasks, inspections, quality decisions, repair approval references |
| Booking | 8084 | booking / booking_app | Appointments, capacity and coordination state |
| Inventory | 8085 | inventory / inventory_app | Catalog, suppliers, stock, reservations, transfers, movement ledger |
| Billing | 8086 | billing / billing_app | Commercial settings, estimate revisions/decisions, invoices, payments/credits/refunds |

Only owned tables are queried. External UUIDs are service references, never foreign keys into another schema. Each service is independently packaged by Maven (`-pl services/inventory-service -am package` or the Billing equivalent) and uses the common parameterized service Dockerfile. Existing applied migrations are preserved. Tenant V5 grants commercial permissions; Work Order V5–V8 stores approval/rework provenance; Inventory V1–V2 and Billing V1–V2 establish their owned schemas.

## Stock transaction model

`on_hand` includes reserved physical stock. Available = on_hand − reserved. Database checks require 0 ≤ reserved ≤ on_hand and nonnegative reorder thresholds. Stock commands hold row locks; multi-line transfer commands lock part IDs in a stable order. Each successful mutation writes the corresponding movement and outbox row before committing. Mechanic parts requests accept three decimal places and retain one request on unchanged retries. An explicit fulfillment command links a consumed reservation to the same job and exact requested quantity; a unique source constraint prevents double fulfillment. Commercial QC rejects unresolved requests, and history uses the installed Inventory record without duplicating fulfilled request notes. Stable idempotency keys bind tenant, user, operation and the canonical input hash; changed input cannot reuse an operation key.

Reservations do not subtract on-hand. Consumption subtracts on-hand and reserved together. A per-job/part transaction lock prevents multiple reservations from cumulatively consuming more than the current approved estimate quantity. Billing approval ID and revision are recorded on consumed reservations. Insufficient reservations produce a durable failure command and `PartReservationFailed` event in a committed transaction while returning 409. Retrying that failed operation retains its outcome; replenishment requires a new operation key. Release is permitted after job cancellation/closure, provided the employee still has branch authority.

Transfers move REQUESTED → APPROVED (source reservation) → DISPATCHED (source deduction) → IN_TRANSIT / PARTIALLY_RECEIVED → COMPLETED. An employee assigned to either endpoint can request a transfer using minimal same-tenant branch references. This reference API exposes names/codes/status, not another branch's stock, staff or finances. Source-authorized staff approve/dispatch; destination-authorized staff receive. A requester may withdraw their own unapproved incoming request; approved stock can be released only by source authority. Cancellation releases an approved source reservation; dispatched stock cannot be cancelled away. Usable receipts credit only the destination. Damaged or explicitly missing quantities require adjustment authority and evidence, remain separately recorded, and never become usable stock. Unresolved quantities stay in transit. Receipt conservation is enforced by PostgreSQL. Inventory supports reasoned corrections, damage, loss, supplier returns and customer returns without rewriting ledger entries.

## Monetary authority and consent

Only Billing computes financial totals. PART prices are fetched from Inventory with a catalog version reference; LABOR rates and configured tax come from Billing's branch settings. Other line prices require estimate-creation authority. HTTP decimals are serialized as strings and displayed using integer/string formatting, preserving large amounts. Stored JSON and service responses retain BigDecimal precision, including PDF snapshots. Quantity and money are BigDecimal; gross, discount and tax round per line HALF_UP to two decimal places, then totals sum those rounded lines. The initial supported currencies are INR, USD, EUR and GBP; no conversion or jurisdictional compliance is claimed.

Submitted estimate lines, financial snapshots and issued invoice records are protected by database triggers. Revisions create a new immutable version and supersede the old one. Submission captures the work-order task scope, so adding a task later cannot quietly expand approval. Revisions invalidate old pending links. Cancelled, expired and superseded versions cannot receive new decisions.

Customer decisions require all of: a live CUSTOMER membership in the selected tenant, an OIDC verified email matching the intended recipient, a cryptographically random 256-bit token delivered to the recorded customer email, the exact estimate/customer/vehicle/work-order binding and an unexpired pending version. Staff financial permissions do not confer customer consent. Tokens are hashed in the approval table, encrypted in the transactional SMTP mail queue, and excluded from audit/outbox payloads. An expiry worker atomically records elapsed draft/pending estimates as EXPIRED, revokes their pending links and writes audit/outbox rows. Its deterministic system actor is distinct from customer consent. Links last at most 24 hours and never outlive the estimate. The browser receives the token as a URL fragment, removes it from the visible URL, and retains it only for the approval session/login continuation. JWTs remain in the existing encrypted server session, never browser storage.

## Workshop coordination

Work Order's commercial-approval command independently calls Billing with authenticated service delegation and the original user identity. It stores the verified estimate/revision and records an audit event. Repair transitions and task updates recheck the current approval. New optional tasks not in the approved scope fail with 409. Rework tasks generated by an actual failed quality check carry an owned quality-check reference and can continue within the original repair contract; merely labeling a new task REWORK does not grant an exception.

Inventory validates job tenant/branch through Work Order. Consumption additionally requires an in-progress job and the approved part scope from Billing. Invoice issue requires a matching Work Order approval reference, completed quality sign-off and Inventory proof that the approved parts were installed. A passed commercial QC remains in QUALITY_CHECK while financial readiness is pending. An explicit manager command checks the issued invoice and branch payment policy before READY_FOR_DELIVERY. Delivery rechecks readiness to detect later refunds or outstanding balances.

No distributed transaction is used. These are synchronous, retry-safe commands with local commit boundaries and explicit readiness reconciliation. A verification failure leaves the local operational state unchanged. Service-side internal context reads intentionally do not acquire a Work Order mutation lock: this prevents deadlocks when Billing calls back during a Work Order command. Approval references describe the version verified at the operation boundary; this is not a claim of atomic global revocation across in-flight requests.

Legacy local development approvals remain explicitly labeled, enabled only for the local profile and loopback issuer. They do not satisfy Billing's invoice-issue contract. Production financial repair paths require actual customer decisions.

## Invoices, payments and documents

Invoice drafts copy the approved estimate and customer/workshop/vehicle snapshots. Issuing obtains a transactional tenant/branch/year counter and freezes the number, lines and snapshot. Corrections are separately audited credits; refunds reference original payment records. Concurrent payment/refund commands serialize on the invoice, enforce remaining balances and use unique tenant-scoped receipt references. A different authorized employee reconciles payments. Manually entered UPI/card/bank records are never labeled provider-verified and no card credentials are accepted by the request contract.

Generated PDFs are private objects in the existing storage abstraction. Authorization is checked before each 60-second signed download. Object keys include tenant, invoice and content digest; retries regenerate identical content and cannot overwrite another invoice. PDF generation consumes only stored bounded text, without HTML, arbitrary network fetching or executable content. The current compact PDF renderer supports ASCII text; non-ASCII typography is a documented release limitation. Issued PDFs retain their issue-time snapshot; subsequent credits/payments are separate ledger records.

## Authorized history and future integrations

Completed commercial vehicle history reads consumed-part references from Inventory through an internal service API. Inventory verifies the completed same-tenant Work Order through its own API. History access requires an authorized branch of that tenant and VEHICLE_HISTORY_READ; operating another branch's job still requires that branch's permissions. The returned part history contains operational details and source references, never purchase costs or invoice administration data. There is no copied whole-vehicle history table.

Inventory and Billing maintain transactional outbox envelopes with event ID/type/version, tenant/branch/aggregate, occurred-at time, correlation ID, actor and structured payload. The business mutation and outbox insert share the same database transaction. Rows remain PENDING; no SQS dispatcher, fire-and-forget transport or exactly-once claim is included. Milestone 6 will own transport/retry/delivery. Future AI tools can consume authorized structured source APIs; they must not infer approval, availability, accounting settlement or safety certification.

## Security and operating boundaries

Every staff endpoint performs backend permission and tenant/branch checks using the live Tenant Service mechanism. Database schema grants form a separate ownership boundary. Idempotency, optimistic versions and database uniqueness protect retries and simultaneous updates. Sensitive changes have actor/correlation audit records. Runtime credentials, approval mail bodies, fixture accounts and signed URLs do not belong in source control. Normal application launchers strip operator and sibling credentials; each backend receives its own database/client credentials and only its needed storage/mail secrets. Frontend processes receive only their session/provider credentials. Unit tests verify this boundary.

Local Compose/OIDC/private storage are development verification tools. Production SMTP, key rotation, retention, backup/restore, cloud policy validation, deployment/scaling, gateway settlement and regulatory review require separate release work. No paid cloud resources or AWS deployment are created by this milestone.
