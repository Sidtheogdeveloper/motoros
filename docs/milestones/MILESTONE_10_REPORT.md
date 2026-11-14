# Milestone 10 — Repair estimate drafting

Milestone 10 adds an estimate assistant to the job card. A service advisor selects which catalog parts to include, confirms fitment and quantity, adds labor hours, and reviews missing information and source references. The assistant creates or replaces the lines of an editable Billing draft. The ordinary Billing page displays authoritative amounts, recalculates edited drafts, compares revisions, and submits a specific version for customer approval.

## Sources and pricing

- Work Order provides the current job, recorded parts requests and completed inspection findings. Unmatched requests are flagged for review. Inspection labels can suggest active catalog matches, but a technician's observation is not treated as a diagnosis.
- Inventory provides the tenant's active catalog and the job branch's current stock. Stock does not imply fitment or reservation. In the existing data model, part selling price is catalog-wide within the tenant.
- Booking categories provide service-scope hints where the signed-in advisor can read them. Booking categories have no sale price and are not converted automatically to billable lines.
- Customer provides previously completed visits when the advisor has history access. The proposal cites those visits and does not infer that past work should be repeated.
- Billing owns labor rates, part selling price verification, discounts, fixed-precision tax and total calculations, estimate revisions, the approval link, and the customer decision.

The provider can select only numbered candidates using match-strength and stock-presence signals. It receives no customer identifiers, workshop notes, catalog text, prices or work-order IDs for this feature. Fabricated IDs, duplicate choices and unexpected fields are rejected. The assistant can operate without a model or after provider failure by showing conservative evidence matches. It cannot issue an invoice, reserve stock, supply discounts or approve a repair.

## Contracts and data

| Route | Behavior |
| --- | --- |
| `POST /api/ai/estimates/draft` | Accepts `workOrderId` and a client-generated UUID `requestId`; returns a private proposal with candidates, review items, source references and recent estimate revisions. |
| `GET /api/ai/estimates/drafts/{id}` | Retrieves the caller's current proposal after rechecking work-order and branch access. Returns 404 for expired or inaccessible drafts. |
| `POST /api/ai/estimates/drafts/{id}/apply` | Accepts selected suggested parts and/or advisor-entered labor, positive decimal quantities and a note. Optional `estimateId` and `version` replace a linked Billing draft. The response is the ordinary Billing estimate. |

The frontend verifies the session, same-origin mutations and expected tenant. The orchestrator verifies the gateway key, staff identity, tenant permissions and the branch returned by Work Order. All service requests carry the original signed bearer and a correlation ID. Apply revalidates the job and delegates create/update to Billing with a stable idempotency key; repeated identical requests use the same Billing estimate. Revision checks, mutation audit records, and the rules protecting submitted estimates remain in Billing. A changed apply body requires a new proposal.

Alembic revision `0004_estimates` adds `ai_estimate_drafts` to the AI-owned database. Proposals are scoped to tenant and advisor, hidden after 24 hours, and pruned during generation or maintenance. No Java service migrations, cross-service database access or changes to customer approval were needed.

## Verification

- All 19 Node unit tests passed. The Python suite passed 32 cases. This includes Copilot regressions and estimate cases for catalog grounding, invalid model output, provider fallback, private proposals, live permission rechecks through mocked owner APIs, version forwarding and stable retry keys.
- The local Chromium Copilot scenario and AI navigation check passed using real authentication, synthetic records and an in-process inference fixture. The earlier NVIDIA-backed Copilot result remains documented in [Milestone 9](MILESTONE_9_REPORT.md).
- The estimate Playwright scenario passed twice: first with a network-free model fixture, then with inference disabled. It exercised actual catalog matching, pricing, identical-apply replay, editor recalculation, update of a linked draft, customer submission, denial of staff approval, cross-tenant denial, and comparison with a superseded revision.
- The Next.js production webpack build passed, including TypeScript. Fresh AI-owned PostgreSQL migrations ran through revision `0004_estimates` in the local acceptance stack. The AI image built and loaded the estimate API as a non-root user with networking disabled.
- The repository secret scan found no matches in the working tree or reachable Git history. The local stack was left in evidence-only mode for manual estimate testing.

The advisor owns the final scope. There is no vehicle fitment database or priced service catalog in this milestone. Taxes and totals are verified by Billing when saved; previewing or editing a proposal does not lock prices or inventory. Hosted-model quality for estimate ranking and deployed AWS behavior were not verified in this pass. Milestones 11 and 12 remain outside this change.
