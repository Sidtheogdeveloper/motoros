# MotorOS

Licensed under the [MIT License](LICENSE).

Milestone 6 adds reliable SNS/SQS event processing, transactional outbox/inbox workers, customer notifications and consent, durable reminders, versioned analytics and controlled fault recovery. The existing workshop, inventory and billing APIs remain in place. See [the Milestone 6 report](docs/milestones/MILESTONE_6_REPORT.md) for verified results and release limits, and [event reliability](docs/architecture/event-reliability.md) for the operational model. No AWS deployment, paid messaging providers or AI Orchestrator is included.

## AWS deployment preparation (Milestone 7)

Milestone 7 prepares Terraform, private ECS/Fargate deployments, Cognito/Valkey cloud identity, controlled migrations, digest-based GitHub releases, observability, security checks and cost/recovery runbooks. It preserves local Compose and all existing business services. **Nothing has been provisioned or deployed to AWS.** Account/domain/SES/policy/budget inputs and explicit authorization remain mandatory.

Start with [the Milestone 7 report](docs/milestones/MILESTONE_7_REPORT.md), [AWS setup](docs/deployment/aws-setup.md), [deployment architecture](docs/deployment/architecture.md), [CI/CD](docs/deployment/ci-cd.md), [security review](docs/deployment/security-review.md) and [cost estimates](docs/deployment/cost-estimation.md). Local checks and image builds require no AWS account. Do not run the local fixtures against cloud identities or substitute loopback defaults for missing cloud configuration.

## Run locally

Requirements: Node 24, Java 21 JDK, Docker Desktop/Linux containers, and Maven on Linux/macOS. AWS credentials are unnecessary. Use **127.0.0.1**, not localhost, for the browser: OIDC callbacks are exact URLs.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.12' # adjust
npm ci
npx playwright install chromium # only for automated browser tests / fixtures
npm run dev
```

The dev runner generates ignored random local credentials, preserves existing credentials/volumes, starts PostgreSQL, Keycloak, Redis, Mailpit, credential-enforced SeaweedFS and local SNS/SQS with health checks, configures OIDC clients, builds/tests the Java services, and starts eight services plus Next.js. Windows uses checksum-verified workspace-local Maven 3.9.11. First startup downloads dependencies/images. Ctrl+C stops app processes; infrastructure persists. `docker compose down` stops infrastructure without deleting its data. Never use `down -v` against a volume containing needed records.

| Component                                                      | Local endpoint                                           |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| Workshop / BFF                                                 | http://127.0.0.1:3000                                    |
| Tenant / Customer / Work Order / Booking / Inventory / Billing | 8081 / 8082 / 8083 / 8084 / 8085 / 8086 (loopback)       |
| Notification / Analytics                                       | 8087 / 8088 (loopback)                                   |
| SNS/SQS emulator                                               | http://127.0.0.1:4566                                    |
| PostgreSQL                                                     | 55432 (loopback)                                         |
| Keycloak                                                       | http://127.0.0.1:8180                                    |
| Mailpit                                                        | http://127.0.0.1:8025 (SMTP 1025)                        |
| Private S3-compatible documents                                | http://127.0.0.1:8333 (SeaweedFS, generated credentials) |
| Redis sessions                                                 | 16379 (loopback, generated password)                     |

Open the workshop, choose **Create account**, complete provider registration, open the verification email in Mailpit, then set a password. Keycloak verifies email before password enrollment. Select **Create workshop**, enter brand and primary branch details, and continue to your workspace. Owners can add branches, edit opening hours/settings, and invite staff from **Staff & invitations**. Invitation acceptance requires an explicit click while signed in as the verified intended recipient. Password recovery also uses real provider emails captured by Mailpit. Profile name/phone are application profile fields; verified email is controlled by the provider.

### Synthetic development accounts

With the app running, in a second terminal:

```powershell
$env:MOTOROS_DEV_FIXTURES = '1'
npm run fixtures
```

On a clean install this creates verified synthetic provider accounts and workshop/customer/vehicle/work-order records through real OIDC and APIs. On an upgraded M1 installation with ignored `fixture-logins.json`, the script maps only database-confirmed `[fixture]` workshops and `example.test` identities through an explicit operator action. Real legacy accounts remain `MIGRATION_REQUIRED`; an authenticated issuer/subject migration must be approved by an operator. There is no automatic email-based claim of a legacy account.

Generated account credentials are in ignored `.runtime/m2-fixtures.json`; there are no embedded default passwords. Two workshop owners and an additional brand exercise tenant isolation and multi-brand selection. A customer has a completed service at Anna Nagar and can be viewed from OMR by authorized staff. Tests create additional clearly synthetic identities, records and local emails. They never send real email or delete production records.

### Independent processes

`npm run infra` configures local infrastructure only. After a successful Maven package, `node scripts/run-services.mjs` starts Java services. `node scripts/frontend.mjs` starts Next development; add `--production` after `npm run build` to test the compiled frontend. Stop a running Java process before replacing its JAR on Windows.

The local runners explicitly permit insecure loopback OIDC and HTTP cookies. Production requires HTTPS and Secure cookies; never use the local Compose or fixture scripts as deployment scripts. See [identity configuration](docs/architecture/identity-and-authorization.md) and [Cognito templates](infrastructure/terraform/cognito/README.md).

## Verification

Run Maven verification with Docker available, then start the app and prepare fixtures for live checks:

```powershell
./scripts/maven.ps1 verify
npm run test:unit
npm run typecheck
npm run build
npm run test:api
npm run test:e2e
npm run test:secrets
npm run export:openapi
node tests/integration/fresh-compose.mjs
```

Local setup records the host UID for Keycloak so its generated realm stays private (mode 0600) and readable by the matching non-root container user on Linux. Use `npm run infra` to prepare local identity configuration.

Linux/macOS: use `mvn verify` instead of the PowerShell helper. `test:api` and Playwright require the running app, local OIDC/Mailpit/Redis and synthetic fixtures. Fresh Compose verification creates and removes only its uniquely named temporary project/volume; it preserves the primary database. Historical custom-password tests are retained under `tests/legacy/` and excluded from active test commands. GitHub CI runs the new OIDC suites on a clean database. No GitHub run or AWS deployment is implied by local validation.

## Repository boundaries

- `services/{tenant,customer,workorder,booking,inventory,billing,notification,analytics}-service`: independent Spring Boot APIs and owned Flyway migrations.
- `packages/service-security`: JWT/JWKS, verified service delegation and reusable permission checks.
- `packages/service-foundation`: owned-record helpers, strict event contracts, fenced publishers, source verification, inboxes and reconciliation workers.
- `apps/workshop-dashboard`: existing Next.js UI plus same-origin BFF; bearer/refresh tokens remain server-side.
- `packages/api-contracts`: shared frontend types and exported OpenAPI snapshots.
- `infrastructure/docker`: local schema/identity database setup and runtime image.
- `infrastructure/terraform/cognito`: validated, unapplied AWS identity templates.
- `tests`: unit, real provider/API, browser and fresh database verification.
- `docs/decisions`, `docs/architecture`, `docs/milestones`: design choices, permission matrix and evidence.

## Customer and vehicle registry

From the workspace sidebar, open **Customer directory** or **Vehicle registry**. These dedicated pages search and paginate on the backend. Customer profiles support edits, primary/secondary contacts and current vehicles. Vehicle profiles support edits, historical ownership, odometer readings, documents and the completed cross-branch timeline. Mechanics receive technical vehicle fields/documents and permitted history, without owner identifiers/contact profiles. Operational record actions use an active assigned branch.

Normalized email/phone matches require explicit separate-person review; registration/VIN collisions reject a new vehicle. No automatic merge exists. Ownership transfer requires a version, acting branch and recorded reason. Old ownership and vehicle service history remain intact. Odometer records are append-only and cannot decrease; correction/rollover needs a future reviewed process.

After starting the app, prepare M2 fixtures first, then the explicit M3 acceptance fixtures:

```powershell
$env:MOTOROS_DEV_FIXTURES = '1'
npm run fixtures
npm run fixtures:m3
```

`.runtime/m3-fixtures.json` holds generated credentials for Apex Motorworks (Anna Nagar, Velachery, OMR) and Precision Auto Care (independent branch), with invited employees, a customer/vehicle, a completed Anna Nagar service and a private technical attachment. Sign in as the Velachery employee to see same-brand history; Precision cannot retrieve it. Re-running retains the fixture manifest instead of modifying real accounts or deleting data.

SeaweedFS 4.48 stores private objects on `motoros-objects`; only its S3 port is published to loopback. `npm run dev` configures the bucket after building Customer Service. For independent processes run `npm run infra`, build the Java services, then `npm run storage:configure`. This command is hardwired to local storage and verifies anonymous object access is denied. LocalStack remains an optional messaging emulator and is **not used for documents** because its anonymous private-object behavior failed verification.

Uploads allow PDF/PNG/JPEG up to 10 MB, request a five-minute checksummed URL, then require backend size/hash/magic validation before publication to a separate key. Downloads require fresh authorization and expire after 60 seconds. A copied authorized URL remains usable until its short expiry; archival stops new grants. MIME signature checking is not antivirus scanning. See [registry architecture](docs/architecture/customer-vehicle-registry.md) for production storage/IAM/retention prerequisites.

Registry-specific checks: `node tests/integration/milestone3.mjs` and `npx playwright test tests/e2e/milestone3.spec.ts`. The aggregate API command runs Milestones 2–5; `test:api:m6` adds messaging checks and the browser command covers Milestones 2–6. Prepare the M2, M3, M4 and M5 fixture manifests in order with `fixtures`, `fixtures:m3`, `fixtures:m4` and `fixtures:m5`, with the explicit development flag enabled. Fresh database verification covers 52 Flyway migrations across eight services. AI orchestration remains future work.

## Milestone 4 workshop operations

Booking Service runs on 8084 with its own schema and service identity. Start all eight services using the existing runners. Visit `/appointments`, `/check-in`, `/jobs`, `/operations`, `/mechanic` and `/workload`. See [operations architecture](docs/architecture/workshop-operations.md) and [Milestone 4 report](docs/milestones/MILESTONE_4_REPORT.md) for the original workshop verification. Legacy local repair fixtures use an explicitly audited manager development simulation. Milestone 5 uses actual customer-bound Billing approval and invoice/payment readiness; see [commercial operations](docs/architecture/commercial-operations.md). No cloud resources are created.

## Milestone 6 communications and reliability

Visit `/notifications` for branch communication history, attempts, consent/preferences, English/Tamil templates and reminder queues. `/reporting` shows source-derived branch metrics with freshness. Platform administrators alone can open `/platform/operations` for queue/outbox/failure metadata and audited replay. Ordinary workshop staff cannot obtain platform authority through these screens.

Local runners enable messaging against LocalStack with generated service identities and no AWS credentials. Each consumer has its own SQS copy and DLQ. Billing's legacy approval mailer yields to Notification while messaging is enabled. Email goes to Mailpit; SMS/WhatsApp are explicitly labeled local captures. Provider acceptance is not a delivery/read receipt.

After preparing the existing fixtures, run:

```powershell
$env:MOTOROS_EXPECT_ASYNC_APPROVAL = '1'
npm run test:api
$env:MOTOROS_DEV_FIXTURES = '1'
npm run test:api:m6
$env:MOTOROS_FAILURE_TESTS = '1'
npm run test:reliability
npm run test:e2e
npm run export:openapi
```

The first M6 fixture run creates a separately named synthetic local platform administrator, recorded only in ignored `.runtime/m6-fixtures.json`. Normal registration/invitation APIs never grant platform administration. Failure tests stop/restart only named local Docker services and restore them in finally blocks. They are not production fault-injection tools.

The free emulator's ephemeral queues are recovered using each producer's local fourteen-day outbox journal and consumer inboxes; AWS mode does not run emulator bootstrap/recovery. Retain source proofs/inboxes for the documented scheduling/replay horizons. See [event reliability](docs/architecture/event-reliability.md) and the [unapplied SNS/SQS target](infrastructure/terraform/messaging/README.md) before deployment. Milestone 7 deployment preparation is documented above. No AWS apply, real provider delivery or centralized cloud telemetry deployment has been performed.
