# Milestone 11 — Analytics Intelligence

The **Reporting** page includes a natural-language workspace for brand owners, regional managers and branch managers with reporting access. Users can ask a question, choose a branch and UTC date range, inspect a bar or monthly line chart, review exact values in a table, export CSV and revisit their private query history. Follow-ups such as “By month” or “What about last month?” reuse the previous authorized query.

## Execution and authorization

The same-origin frontend gateway passes the user's signed bearer and selected workshop to the orchestrator. The orchestrator turns supported wording into a metric, dimension, date range, currency filter and active branch scope. The Analytics Service independently rechecks both reporting permissions and every branch. It reads only its own PostgreSQL projections, using fixed SQL expressions and bound request values. Queries are read-only with a statement deadline, a 366-day range limit, a 100-branch scope limit and a 100-row result limit.

Questions, amounts, names and source records are not sent to the model for this feature. An optional model can choose between precomputed presentation summaries using the group type and row count. The answer, currency series, exact values and chart data all come from deterministic calculations. Unsupported wording returns a validation error. Authorization is rechecked after interpretation and when saved query specifications are read or reused. History is retained for 30 days per tenant and user and stores the question and specification, without result rows.

## Metric definitions

| Metric | Basis |
| --- | --- |
| Issued invoice value | Invoice face value by issue date, separately by currency. |
| Net collections | Recorded payments less refunds by ledger entry date. “Revenue” uses this interpretation and the answer discloses it. |
| Outstanding balance and unpaid invoices | Positive current projected balance on invoices issued in the selected period. Partial payments and refunds are included. |
| Appointment count and service mix | Appointments by latest scheduled start, including cancellations, grouped by service category when requested. |
| Completed repairs and turnaround | Recorded repair completion date and average minutes from check-in to completion. |
| Estimate approval rate | Approved revisions divided by approved plus rejected revisions by decision date. Superseded and undecided revisions are excluded. |
| Parts consumption | Consumed stock reservation quantity by consumption date. |
| Repeat customers | Distinct customers with a completed visit in the range and a preceding completion within six months in the queried branch scope. The rate divides by distinct customers completing visits in the range. |
| Average invoice value by service | Mean issued value for invoices linked to an appointment with a recorded category. |

Branch utilization is unsupported because the projections lack historical capacity and staffing data. Service grouping excludes unlinked invoices. Parts beyond the first ten displayed catalog lookups may show stable part IDs. The workspace identifies branches with no relevant projection update in 24 hours, which can also happen when a branch is quiet.

## Deployment and contracts

- Tenant migration `V9` grants the existing Analytics Intelligence permission to assigned regional and branch managers.
- Billing `V6`, Booking `V7` and Inventory `V6` add business dates or category identifiers to their owned event snapshots. Existing bounded reconciliation rebuilds older rows without sending historical notifications. Values requiring the new fields may be incomplete while reconciliation runs.
- Roll out consumers with the expanded event envelope before producers emit the new fields. Existing envelopes without those fields remain readable.
- The orchestrator uses Alembic revision `0005_analytics` for private history. The optional Compose stack resolves Analytics through `AI_ANALYTICS_URL`, defaulting to the host's port 8088.
- `POST /api/ai/analytics/query` accepts `question`, optional `branchIds`, paired `start`/`end` dates and optional `previousQueryId`. It returns the applied specification, answer, definition, exact rows, chart type, freshness and limitations.
- `GET /api/ai/analytics/query-history?offset=0` returns recent authorized specifications. The fixed metric data endpoint is `GET /api/analytics/metrics`.

## Verification

The Python suite passed 53 tests, including question interpretation, invalid filters and dates, unsupported SQL-shaped input, result preservation, history isolation and follow-ups. The Analytics Java suite passed 5 PostgreSQL tests, covering legacy projection behavior, exact ledger arithmetic, scope, stale data, repeat visits and category-linked invoice aggregation.

The installed Edge browser passed the end-to-end scenario using real authentication, APIs and synthetic PostgreSQL data. It checked owner branch comparisons, exact values against the metrics endpoint, chart inspection, CSV export, monthly follow-ups, private history, assigned manager scope, mechanic denial and cross-tenant denial. The estimate workflow and AI feature navigation browser regressions also passed.

The production frontend build, all 19 Node unit tests, Java packaging and the Analytics OpenAPI check passed. The Tenant, Booking, Billing and Inventory Flyway migrations ran on the existing isolated stack, and the AI store upgraded to Alembic revision 0005. The corresponding Java service regression suites passed. Three focused integration tests also confirmed that real service operations emit appointment category, invoice issue date, payment date, estimate decision date and parts consumption date into the producer outboxes. The repository secret scan reported no findings.

Local acceptance used inference disabled. Hosted model inference and AWS deployment remain unverified.
