# Milestone 5 implementation plan

Status: implemented; local engineering acceptance passed on 2026-10-25. See [the final report](MILESTONE_5_REPORT.md) for results and production release concerns. Milestone 6 remains unstarted.

## Audit and baseline

Actual Tenant, Customer, Work Order and Booking implementations, service-owned migrations, authorization library, OIDC configuration, frontend command helpers and Milestone 4 report were inspected. There is no Inventory or Billing scaffold. Preserve the existing four services and applied migrations.

The baseline Maven reactor build passed with 46 Java tests. Existing live API suites passed 268 checks and Playwright passed 14 tests. A separate Node/typecheck baseline invocation was not executed because automatic approval review hit an account usage limit. This is an execution limitation, not a test result.

## Modules and ownership

Add Inventory (8085, inventory schema/role) and Billing (8086, billing schema/role), independently packaged Spring Boot services using existing live membership authorization, correlation IDs and delegated user authentication. Neither may query another service's schema. All references to tenant, staff, customers, vehicles and work orders are authorized API references.

Inventory owns catalog, suppliers, branch stock, movements, reservations, stock transfers and their line-level receipt history. On-hand includes reserved stock; available = on-hand minus reserved. Every stock mutation locks affected stock rows in deterministic order, maintains nonnegative constraints and writes its movement, audit and outbox in the same transaction. Idempotency keys bind actor, operation and input. Dispatch removes source on-hand and reservation; only receipt credits destination. Damaged/missing quantities remain explicit discrepancies, never silently received.

Billing owns branch labor/tax settings, estimates and immutable submitted revisions, approval decisions, issued invoice snapshots, payments, refunds, reconciliation and private PDF metadata. BigDecimal arithmetic with explicit rounding computes totals server-side. Currency is fixed per document. Customer approval must bind a verified customer identity or expiring recipient-verified link to the exact immutable version. Staff estimate permissions do not confer customer consent. Issued invoices cannot be edited. Manual digital payment records do not imply provider settlement.

## Integration and coordination

Work Order verifies authoritative Billing approval before normal repair transitions, and financial readiness before delivery. Development-only approval remains visibly separate for legacy local fixtures and must not authorize production financial workflows. Inventory verifies work-order branch and ownership before reservations/consumption. Commands are retry-safe; no distributed transactions. Reconciliation states expose partial remote failures. Transactional outbox envelopes are durable local records; delivery transport is deferred to Milestone 6.

## Frontend

Reuse existing graphite/orange shell, selected tenant/branch guards, accessible forms, stable command keys and error handling. Add catalog/branch stock/movements/reservations, transfer lifecycle, estimate revisions/approval, invoice/PDF/payments and job commercial context. Mechanics receive operational stock/request information without financial administration privileges. All actions call real APIs.

## Verification and acceptance

Add JUnit/Testcontainers tests for arithmetic, row-lock races, idempotency, transfer conservation, immutable documents, customer-bound approvals and tenant/branch denial. Run migrations using isolated database roles, live API fixtures for Apex Anna Nagar/OMR/Velachery and Precision denials, and browser workflow through stock reservation, actual customer approval, repairs, QC, invoice and payment. Repeat Milestones 1–4 regression suites. Record unexecuted checks explicitly. No readiness claim until critical acceptance passes.
