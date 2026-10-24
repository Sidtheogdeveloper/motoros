# MotorOS Milestone 3 engineering report

Date: 24 October 2026. Scope: the existing MotorOS repository, real local OIDC/Redis/PostgreSQL, three Spring services, production-built Next.js frontend and private S3-compatible storage. **No AWS resources were provisioned. Milestone 4 was not started.**

## Verdict

The mandatory local acceptance scenario and critical registry/security tests pass. Apex Motorworks has Anna Nagar, Velachery and OMR; Precision Auto Care has an independent branch. A verified Velachery employee finds the vehicle registered at Anna Nagar, reads its completed Anna Nagar service with source references and accesses permitted technical documents. Precision employees cannot retrieve that Apex vehicle profile, documents or history. Ownership transfer retains historical relationships and service records. Duplicate attempts and unauthorized branch operations are rejected.

This is ready for Milestone 4 **development**, with the limitations below tracked. It is not approval for public production deployment; malware scanning, cloud storage/identity validation, deployment security and operational recovery remain prerequisites.

## Audit and baseline

Inspected AGENTS instructions, M2 report, ADRs/architecture, service-owned schemas/migrations, actual service controllers/security, BFF/session handling, UI components, contracts and development runners. The implementation extends the existing modules; it does not create replacement services or an AI Orchestrator.

Baseline: **26 Java tests, five Node tests and 72 live API checks passed**. The initial browser run passed eight of nine tests and timed out waiting for local invitation email under concurrent verification load; its focused retry passed. Final verification runs all nine inherited browser tests successfully alongside the three new registry tests. The M2 source checkpoint and existing data remain preserved.

## Implemented functionality

- Customer directory/profile with backend pagination, name/email/phone search, primary and additional contacts, address/city/country, status, versioned edits and soft contact deactivation.
- Duplicate detection using normalized contact details. Shared contacts require explicit separate-person review; reasons are retained. Edits that leave contact identity unchanged preserve review and do not demand another review. No automatic merges exist.
- Vehicle registry/detail with normalized registration, tenant-local VIN uniqueness, make/model/year/fuel/color/status and registration branch. Vehicle search covers registration, VIN and make/model. Technical responses redact current owner identifiers when CUSTOMER_READ is absent.
- Transactional ownership transfer with acting branch, optimistic version, reason, actor and historical relationships. Previous ownership and vehicle service history remain intact. Ordinary vehicle edits cannot change owner.
- Append-only odometer records with server timestamps, actor/branch/note, pagination and non-decreasing kilometer validation. Missing readings and unauthorized acting branches fail.
- Private customer/vehicle documents with metadata authorization, technical versus customer-private visibility, five-minute signed upload grants, size/hash/file-signature verification and separate publication keys. Sixty-second download grants require fresh authorization; archive stops new grants and preserves retention data.
- Authorized cross-branch completed-service timeline. Customer delegates to Work Order using authenticated machine identity and the original signed user token; Work Order independently rechecks tenant, active acting branch, history permission and vehicle access. Results are paginated and include stable source references. Customer never queries Work Order tables.
- Audit events and correlated service access. Inactive vehicles retain readable history but cannot create new work-order intake.

## Database changes

| Owner / migration                    | Changes                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer V2 — unified registry       | Customer profile/status/version fields and generated normalized contacts; secondary contacts; vehicle identity/details/status/version/conflict flags; tenant-scoped registration/VIN indexes; historical ownership/current-owner uniqueness; odometer records; private document metadata; registry audits |
| Customer V3 — identifier constraints | VIN format constraint and retained secondary-contact review reasons                                                                                                                                                                                                                                       |
| Tenant V3 — registry permissions     | VEHICLE_OWNERSHIP_READ, VEHICLE_OWNERSHIP_WRITE, VEHICLE_ODOMETER_WRITE, DOCUMENT_READ, DOCUMENT_WRITE and explicit role grants                                                                                                                                                                           |
| Work Order V2 — audit correlation    | Persisted correlation IDs for new work-order and sensitive history-access events                                                                                                                                                                                                                          |

Existing migrations were retained. Customer/vehicle rows survive upgrades. A dedicated migration test starts at V1 with two colliding normalized registrations and verifies both records survive, both are flagged for review, and both receive preserved ownership relationships. No unsafe merge or fabricated ownership is performed. Correcting a collision to a genuinely unique registration clears its flag after validation.

UUID keys, composite tenant ownership foreign keys, current-owner/vehicle identity uniqueness, status/size/format constraints, timestamps, tenant-scoped indexes and optimistic versions protect the model. Tenant advisory transaction locks serialize duplicate/transfer/odometer decisions across service instances. A concurrency test proves two simultaneous registrations produce one success and one conflict. Branch references are externally owned by Tenant Service and validated through live authorization rather than cross-schema foreign keys.

All **eight** migrations pass on a fresh temporary Compose volume. Separate tenant_app/customer_app/workorder_app roles own their schemas; six cross-schema privilege denials pass. **PostgreSQL tenant RLS remains unimplemented**, as documented in M2; application predicates and ownership constraints enforce current isolation.

## Endpoints and contracts

[API documentation](../api/README.md) lists complete contracts. Customer Service now provides:

- GET/POST /api/customers; GET/PATCH /api/customers/{id}; GET /api/customers/duplicates.
- GET/POST /api/customers/{id}/contacts; POST /api/customers/{id}/contacts/{contactId}/deactivate.
- GET/POST /api/vehicles; GET/PATCH /api/vehicles/{id}.
- GET/POST /api/vehicles/{id}/ownership and /odometer.
- GET /api/vehicles/{id}/timeline?branchId=&page=&size=.
- GET /api/{customers|vehicles}/{id}/documents; POST .../documents/uploads.
- POST /api/documents/{id}/complete, /download and /archive.
- GET /api/{customers|vehicles}/{id}/audit.

Work Order owns the corresponding paginated `/api/vehicles/{id}/timeline` producer API. It returns delivered/closed same-brand records with source service/resource/path, branch, status and timestamps. Dependencies fail closed; unavailable history returns an error rather than fabricated records. Source references identify evidence without granting operational access to another branch.

Exported OpenAPI snapshots for all three services were regenerated from running APIs. Live contracts now declare JWT bearer authentication and the selected-tenant header. Shared TypeScript contracts describe registry fields, ownership/odometer/document metadata and source references. Browser traffic uses the existing same-origin BFF; tenant selectors are authorized, not treated as proof of membership.

## Frontend screens

The existing design system now includes Customer Directory, Customer Profile, Vehicle Registry, Vehicle Detail and a dedicated Cross-Branch Service Timeline route. Profile sections expose contacts/current vehicles, ownership, odometer, documents and service history according to current permissions.

Search/filter/pagination, create/edit forms, explicit duplicate review, ownership confirmation, odometer validation and real S3 upload/download are connected to backend endpoints. Loading, empty, validation, transport and denied-access states are implemented. The longer record forms use scrollable dialogs; sensitive deactivation/transfer/archive actions require confirmation. Owner selection is searchable instead of hardcoded. Brand selection and existing live membership/session guards remain in effect.

Registry components are separated into shared context/data handling, directory/editor, detail/ownership/odometer, documents and timeline modules. Queries abort superseded requests and partition by the active authorized brand; a changed authority/context triggers workspace reload. Responsive styles retain the existing dark/amber design. Desktop workflows and a 390px vehicle profile/document layout were exercised and visually inspected; a full browser/device accessibility matrix was not performed.

## Storage and security controls

The existing LocalStack emulator was probed before adopting it for documents. An unsigned read of a nominally private object returned **200**, so it was rejected for this feature. It remains optional messaging infrastructure and is not the document store.

Local documents use credential-enforced **SeaweedFS 4.48**, a persistent named volume and loopback-only S3 port 8333. Generated access/secret keys remain in ignored .env. Local setup verifies unsigned object reads return **403**. SeaweedFS does not implement the AWS public-access-block management API; this limitation is explicit, and actual access denial is tested independently. Storage restart testing confirmed an existing document persisted and remained private.

Upload metadata is bound to a random tenant/document staging key, allowed PDF/PNG/JPEG type, safe ASCII filename, maximum 10 MB, SHA-256 checksum and short expiry. Completion reauthorizes, locks/version-checks metadata, verifies actual byte length/hash/magic and writes verified bytes to a separate final key. An upload-URL replay cannot replace the published file. Invalid or incomplete uploads cannot be downloaded. Pending staging objects have lifecycle expiry.

Download authorization rechecks live tenant permissions and visibility before signing a 60-second attachment GET. Lists expose neither object keys nor hashes. The browser fetches upload/download objects with credentials omitted; a browser test verifies application cookies are not forwarded to storage. Archived documents cannot obtain new grants. Already issued grants remain bearer capabilities for their short remaining lifetime.

Mechanics see technical vehicle/document/history data, not customer profiles, owner identifiers, ownership lists or customer-private documents. Privileged staff still require explicit ownership/document permissions and assigned active branches for mutations. Tenant A cannot use a Tenant B parent/document ID, branch selector, URL or request body to cross the boundary. Administrative audits retain actor, tenant, applicable branch, target, action, outcome, timestamp and correlation; raw contacts, passwords, bearer tokens and signed URL queries are excluded from access logs.

[Registry architecture](../architecture/customer-vehicle-registry.md) documents local versus AWS configuration. AWS SDK default credentials/task roles and native S3 endpoints are supported configuration paths; **actual AWS S3/Cognito execution remains unverified and no cloud resources were created**.

## Final test results

| Verification                          | Result                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Java 21 Maven verification            | **34 passed**, zero failures/errors/skips across shared security and all three services                                                                                                      |
| Node unit suite                       | **5 passed**                                                                                                                                                                                 |
| TypeScript / Next.js production build | Passed                                                                                                                                                                                       |
| Production-mode Playwright            | **12 passed**: nine inherited identity/workshop flows plus three new registry/security workflows                                                                                             |
| M2 live API suite                     | **72 checks passed**                                                                                                                                                                         |
| M3 live API suite                     | **91 checks passed**, including mandatory cross-branch/tenant scenario, duplicate review, transfer, edits/versions, odometer, private files, signatures, wrong file type and inactive intake |
| Fresh PostgreSQL / Compose            | Eight migrations, three schema owners/health endpoints and six privilege denials passed                                                                                                      |
| Upgrade preservation                  | V1 ambiguous vehicle identities retained/flagged, ownership backfilled; tested with Testcontainers                                                                                           |
| Concurrent registration               | One success / one conflict; no duplicate identity persisted                                                                                                                                  |
| Private storage                       | Signed upload/download succeed; anonymous and tampered-signature reads fail; staging replay leaves published bytes unchanged                                                                 |
| Storage restart                       | Existing object persists; authorized download succeeds and unsigned download remains 403                                                                                                     |
| Runtime images                        | Three non-root images built; container-to-container timeline delegation and private document download pass                                                                                   |
| OpenAPI                               | Three authenticated live service contracts exported                                                                                                                                          |
| Source/secrets                        | No findings in current-source/generated-secret scan; runtime/config/credential files excluded                                                                                                |
| npm production audit                  | Zero reported vulnerabilities at verification time                                                                                                                                           |

Evidence is recorded in [sanitized test results](../milestone-3-evidence/results.json), with separate source-change/secrets evidence. Raw local credentials, callback traces and signed URLs remain outside the delivered source archive.

JUnit persistence/migration tests use real PostgreSQL Testcontainers. Some service tests deliberately mock authority/userinfo or S3 and use a test-only Customer HTTP fixture; those tests alone are not claimed to prove real OIDC/storage delegation. The live API and browser suites use actual Keycloak PKCE, Tenant membership authority, all services, real object bytes and private S3 signatures. The Apex/Precision fixtures and completed service are created through real APIs, not UI mocks. The final customer-edit regression specifically protects unchanged shared contacts; backend and browser flows now verify it.

## Development fixtures and operation

Run the existing app with `npm run dev`. It starts health-checked local infrastructure, builds/verifies services, configures private local storage and starts the services/frontend. Independent startup instructions are in the root README. With the app running, explicitly enable MOTOROS_DEV_FIXTURES=1, run `npm run fixtures`, then `npm run fixtures:m3`. Generated credentials are stored only in ignored `.runtime/m3-fixtures.json`.

The M3 manifest contains Apex (Anna Nagar, Velachery, OMR), Precision (independent branch), owners and invited employees, customer/vehicle, a completed Anna Nagar record and a private technical document. Fixtures use example.test mail and synthetic records; no real email, production deletion or AWS access is required. Re-running retains the manifest. CI was updated to build/configure local storage and run both milestone suites; **remote GitHub execution was not performed**.

## Known limitations and remaining risks

1. Public production deployment is not approved. Actual AWS S3/Cognito, production IAM/public-access-block/TLS/CORS/encryption policy, private networking, backups/restore, HA, monitoring and operational retention/reconciliation need approved staging verification. Local object storage is not a production security recommendation or an at-rest encryption claim.
2. File checks enforce metadata, length, checksum and magic bytes. They are **not** deep format validation, content sanitization, classification or antivirus scanning. Production uploads need scanner/quarantine integration. Visibility is assigned by authorized staff; free-text service summaries and technical attachments may contain human-entered sensitive content.
3. Presigned URLs are short-lived bearer capabilities. Download grants remain usable for up to 60 seconds after revocation/archive; pending uploads can reach staging until expiry, but publishing still requires current authorization. Do not log or distribute grants unnecessarily.
4. Pending lifecycle cleanup exists; unreachable publication objects can remain after a database failure. Production reconciliation, retention/deletion policy and failure-injection testing remain work. General POST idempotency and distributed domain events are not implemented.
5. Ownership changes are effective now. Backdated/corrective ownership, odometer rollover/correction and automated or operator-assisted merges are not implemented. Records are preserved rather than silently rewritten.
6. No customer self-service portal or external identity-to-person ownership linkage is added. CUSTOMER remains reserved without staff access. Contact/ownership visibility follows the documented staff permission matrix.
7. PostgreSQL tenant RLS remains deferred. Explicit tenant predicates, live permission checks and ownership constraints must remain mandatory, including for future AI callers.
8. No load/chaos test, full Java/image vulnerability assessment or broad browser/device matrix was performed. Search uses bounded tenant-scoped queries; large-volume substring search, high-offset paging and service fan-out need measurement before scale rollout. Branch pickers retain the inherited first-100 branch bound; old dashboard inline lists remain limited, while the new registry directories paginate properly.
9. Document filenames are deliberately ASCII and types limited to PDF/PNG/JPEG. VIN format validates modern 17-character syntax rather than all historical/manufacturer/check-digit rules. International phone-country configuration needs correct input; no global identity-sharing model is inferred.
10. The inherited repository has no commits/tracked source. Current working source and generated local secrets were scanned; history-based guarantees and a pushed CI result cannot be claimed. No commit identity or remote result was fabricated.

## Readiness for Milestone 4

No known critical failure remains in the verified local Milestone 3 workflows. Customer/vehicle ownership, private documents and cross-branch history have functioning APIs, UI, migrations, fixtures and automated security coverage. The repository is ready for Milestone 4 development with the production/scale limitations tracked above. **Milestone 4 has not been started.**
