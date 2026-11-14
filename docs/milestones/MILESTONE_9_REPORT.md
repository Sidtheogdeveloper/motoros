# Milestone 9 — Mechanic Copilot

The Copilot is available from the job card. It retrieves the current work order and completed inspections through the Work Order API and uses the Customer timeline for authorized vehicle history. It combines those records with passages from the brand's approved workshop library.

The retrieval step ranks sparse lexical features from the question, relevant preceding question, and source text. The provider returns only evidence identifiers. MotorOS validates those IDs and builds the answer from the cited excerpts. A question with no matching evidence abstains without calling the model. The answer links to job cards and authorized history and identifies document versions, pages and passages.

The same-origin gateway checks the active tenant and forwards the signed session bearer. The orchestrator rechecks live Tenant and Work Order permissions. Conversations are scoped to staff member, tenant and job. A second access check after inference protects against revoked access or edited evidence. Prior answers resolve their citations against current records, so removed or replaced material is excluded. There is no repair, approval, billing or delivery write path.

Brand owners can index, replace or remove approved PDF and UTF-8 documents. The upload caps size and parsed passages, extracts PDF text in a time-limited child process, and preserves page references. The database stores searchable passages and the current document version. The original uploaded file is not retained. PDF text extraction requires a text layer. [pypdf extraction documentation](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)

Alembic revision `0003_copilot` adds documents, conversations and turns. The API supports chat, paginated conversations and turns, archive, feedback and document management. The default retention is 30 days. Expired conversations are excluded from reads and removed by the existing maintenance command.

The live Chromium test used fictional MotorOS records, real session authentication, PostgreSQL and NVIDIA. It verified document upload, citation, staff and tenant isolation, and withdrawal of a citation after document removal. The existing Milestone 8 browser scenario, production frontend build and non-root AI image check also passed. The 24 Python tests include authorized history and completed inspection retrieval, fabricated citation rejection, insufficient evidence, provider failure, input bounds, PDF page attribution, document replacement and conversation isolation.

This release uses lexical retrieval. Semantic embeddings, OCR, incremental streaming and AWS deployment are outside the verified local release. Copilot delivers the answer after validating its citations. The [local guide](../../intelligence/README.md) explains setup and verification.

The Milestone 10 regression pass reran the Copilot tests and the browser document/citation/isolation scenario against real local services with a network-free test provider. Automatic approval review did not permit a new NVIDIA browser run because a hosted call could disclose workshop evidence. The previous hosted result and the new local regression result are separate.
