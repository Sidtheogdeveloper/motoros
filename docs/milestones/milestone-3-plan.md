# Milestone 3 implementation plan

1. Inspect existing service ownership, migrations, security and UI contracts; record M2 baseline (26 Java, five Node, 72 API; eight of nine initial browser tests passed, invitation mail timeout to investigate).
2. Extend Customer schema without rewriting V1: normalized contact/vehicle identifiers, explicit duplicate review, customer/vehicle edits with versions, ownership history, odometer readings, private document metadata and audits. Retain old records; flag pre-existing ambiguous identifiers instead of merging.
3. Add reusable permissions and tenant/branch/resource checks. Mechanics see technical vehicle data, not owner contacts or private documents. Transfer ownership transactionally and retain historical relationships.
4. Implement S3-compatible private local storage, short-lived signed uploads bound to checksum/type/size metadata, backend completion validation and authorized downloads. Do not provision AWS.
5. Add a paginated Work Order-owned timeline with structured source references; aggregate through authenticated dual-identity delegation rather than cross-schema queries.
6. Build real customer/vehicle directory/detail/forms, ownership, odometer, documents and timeline UI using existing design. Run React quality review and responsive checks.
7. Create Apex (Anna Nagar, Velachery, OMR) and Precision fixtures; verify mandatory authorized cross-branch and denied cross-tenant scenarios, duplicate attempts, transfer and invalid branch permissions with JUnit/Testcontainers, live API and Playwright. Regenerate OpenAPI and document verified results/limits. No M4 or AWS deployment.
