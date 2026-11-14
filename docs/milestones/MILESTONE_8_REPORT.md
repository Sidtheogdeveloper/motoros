# Milestone 8 — Vehicle history intelligence

**Status:** Milestone 8 passed local acceptance with live NVIDIA inference and two synthetic tenants.

## Implementation

The Next.js vehicle profile includes an Intelligence tab for users with vehicle history permission. Its server routes use the existing session, enforce the expected tenant and check the exact Origin for generation. FastAPI checks the gateway credential and delegates the original user bearer to the fixed Customer and Tenant APIs. The Customer timeline delegates to Work Order using its existing live branch and tenant authorization. Each summary read, including a cache hit, passes through these checks.

The model ranks numbered evidence. MotorOS validates the returned selection and renders the source text itself. It distinguishes reported complaints, completed repairs, recorded part use, observations, intake odometer readings and recommendations. A received part is excluded from recorded part use. Repeated exact-normalized complaints and decreasing dated intake odometer readings have deterministic checks. Claims link to the completed service records. The response groups evidence by topic, presents recorded concerns for technician review, and displays missing data and coverage limits. Service notes are untrusted and may contain personal information, so provider approval must cover this data.

## API and persistence

- `POST /api/ai/vehicles/{id}/history-summary?branchId=...` generates or reuses the current summary.
- `GET /api/ai/vehicles/{id}/history-summaries?branchId=...` returns the current eligible cached summary when present.
- `POST /api/ai/vehicles/{id}/history-feedback` records or updates the signed-in staff member's vote for the current summary. Stale summaries reject feedback with 409.
- `GET /healthz` provides process liveness. Both summary routes have typed FastAPI responses and an offline OpenAPI schema via `app.openapi()`.
- Alembic revision `0001_history` creates a version-aware cache and monthly usage ledger in AI-owned PostgreSQL. Cached selections contain evidence IDs. A tenant, branch, vehicle, source-content hash, prompt version and model identify the cached result. Expired entries are excluded from reads and can be removed by the maintenance command. Revision `0002_history_feedback` adds per-staff votes and the event watermark for each tenant and vehicle.

The dedicated SQS queue accepts notifications from the Customer and Work Order SNS topics. Vehicle updates, work-order completion, and relevant work-order status changes advance the cache watermark. Duplicate and older events leave it unchanged. The live source hash remains part of the cache key. If an event arrives during inference, the orchestrator rechecks the authorized source snapshot before saving or discarding the result.

## Verification and remaining work

The live Chromium scenario used the production Next.js build, Keycloak sessions, the real MotorOS APIs, PostgreSQL, LocalStack and NVIDIA Nemotron. A Velachery mechanic obtained cited visits from Anna Nagar and OMR. The test verified cache reuse, saved feedback, denial for an unauthorized branch and Precision Auto Care, invalidation through a real color-only vehicle edit, and rejection of feedback on the invalidated summary. The browser opened a cited service record successfully. The three existing vehicle registry browser tests also passed in the same run.

Twenty Python tests cover provider failure, invalid citations, empty history, conflicting odometer readings, branch and tenant scope, feedback isolation, duplicate and out-of-order events, and event arrival during inference. The final AI image built and exposed the feedback contract as a non-root process. Compose configuration and the secret scan passed. See the [integration report](MOTOROS_INTELLIGENCE_INTEGRATION_REPORT.md) and [local setup guide](../../intelligence/README.md).

Summaries disclose a limit of 50 recent completed visits and a context budget. The timeline currently supplies inspection findings that require attention. Mileage conflicts are detected directly. Broad free-text conflicts and the current resolution status of older recommendations require technician review. AWS deployment, Bedrock inference, per-plan quotas, cost accounting and an exported telemetry backend remain outside local acceptance.
