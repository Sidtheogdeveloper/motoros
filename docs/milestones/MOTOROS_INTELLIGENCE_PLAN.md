# MotorOS Intelligence implementation plan

## Baseline and boundaries

Start from 218f247. The monorepo has eight Spring Boot services, Next.js BFF, schema-owned persistence, live Tenant authorization and a locally exercised SNS/SQS implementation. Milestone 7 prepares AWS infrastructure without a deployed staging environment. No AI runtime or AI-owned persistence was present. The architecture and milestone reports define the existing boundaries.

Maven verification was attempted with both the default and workspace-local Maven caches. The default cache is inaccessible and Maven Central DNS resolution blocked the local-cache attempt. Browser and API baselines initially found no Chromium executable in the runner's default cache. The failure-injection runner requires its explicit opt-in and an isolated live stack. Record subsequent results in the implementation report.

## Implementation sequence

1. Add a private FastAPI orchestrator with explicit provider selection, bounded calls, fixed upstream APIs, structured output validation, AI-owned PostgreSQL and atomic tenant quotas. Forward the original user bearer from the same-origin BFF. Verify the BFF caller and use the authoritative domain APIs for live authorization.
2. Integrate cross-branch history. Read the authorized Customer timeline and minimal vehicle fields. Use extractive evidence selection so generated text cannot invent service facts. Reauthorize before every cache lookup and hash the current evidence, prompt, and provider configuration. Add event invalidation as an optimization, never as the sole freshness gate.
3. Implement Copilot after the history gate. Add private document ingestion, versioned authorized passage retrieval and per-user conversation sessions. Validate every citation against the exact evidence set.
4. Add estimate drafting with catalog references only. Billing resolves prices and totals and existing human approval stays authoritative.
5. Add analytics intent parsing with an allowlisted metric/query schema. Fetch authorized Analytics projections and render exact values from the API.
6. Add communication drafting with verified fact fields, a distinct approval and send flow, and Notification-owned recipient, consent and delivery validation.
7. Run integrated two-tenant, outage and human-approval scenarios. Prepare private ECS, scoped model IAM and model routing checks. Record implementation, fixture, live-local and AWS evidence separately.

Model calls remain opt-in. Tests use synthetic data and deterministic model fixtures. AWS provisioning, paid inference and public deployment require explicit authorization.
