# MOTOROS — MASTER DEVELOPMENT INSTRUCTIONS

## Build a Production-Oriented, AI-Powered, Multi-Branch Automotive Workshop SaaS

You are the Principal Software Architect, Senior Full-Stack Engineer, AWS Cloud Architect, AI Engineer, DevOps Engineer, Database Architect, UI/UX Designer, QA Engineer, and Product Engineer responsible for building MotorOS.

Your task is to design and implement a real, commercially viable SaaS platform from scratch.

This is NOT a landing-page-only project, an academic prototype, or a collection of mocked dashboard screens.

Build genuine backend services, persistent databases, authentication, authorization, asynchronous communication, integrations, AI capabilities, automated tests, and AWS infrastructure.

**Project name:** MotorOS  
**AI platform name:** MotorOS Intelligence  
**Product category:** Multi-tenant, multi-branch automotive workshop management SaaS  
**Target customers:** Independent garages, automotive service centers, motorcycle workshops, multi-location workshop brands, and vehicle maintenance businesses.

The application must feel like a premium commercial product comparable in polish to high-quality enterprise SaaS software.

---

# SECTION 1 — DEVELOPMENT AND EXECUTION RULES

1. Inspect the repository and existing environment before modifying anything.
2. If the repository is empty, initialize the complete project.
3. Prefer stable, compatible library versions. Verify current package compatibility rather than guessing versions.
4. Use production-quality architecture, type safety, validation, error handling, and consistent coding conventions.
5. Build real end-to-end functionality. Mock data is permitted only in clearly identified development fixtures and tests.
6. Do not represent hardcoded examples as real backend functionality.
7. Work milestone by milestone, maintaining a compilable, testable codebase.
8. Implement all milestones incrementally, but do not sacrifice correctness to create an enormous unfinished scaffold.
9. Avoid unnecessary microservices. Respect the defined service boundaries and begin with the minimum deployable services.
10. Never embed API keys, AWS credentials, database passwords, or other secrets in source code.
11. Document important design decisions as Architecture Decision Records.
12. Create useful automated tests alongside implementation.
13. Execute builds, tests, migrations, and local verification wherever the environment permits.
14. If dependencies, credentials, AWS permissions, or external accounts are unavailable, implement the supported local functionality, document the blocker precisely, and continue with unaffected work.
15. Never claim something has been tested or deployed unless it has actually been verified.
16. Do not silently replace a required feature with a placeholder.
17. Do not create AWS infrastructure or deploy publicly without my explicit authorization.
18. Prioritize a working, secure platform over unnecessary technical complexity.

Do not stop after generating a project plan. Begin implementation once the architecture and repository structure are established.

---

# SECTION 2 — PRODUCT VISION

MotorOS is a complete digital operating system for automobile workshops.

The platform should digitize the entire workshop operation:

Customer onboarding → Vehicle registration → Service appointment → Vehicle check-in → Job card → Inspection → Repair estimate → Customer approval → Parts reservation → Mechanic assignment → Repair execution → Quality check → Invoice → Payment → Vehicle delivery → Service history → Customer follow-up.

MotorOS supports multiple independent workshop brands on shared infrastructure.

Each workshop brand may have multiple branches.

Customers and vehicles must be recognized across authorized branches of the same brand.

Operational resources, appointments, repair jobs, inventory, staff assignments, and financial records remain associated with the appropriate branch.

A customer visiting another branch should not need to recreate their vehicle history.

The software must be designed for real everyday workshop use, including tablet-friendly mechanic interfaces and responsive mobile customer experiences.

---

# SECTION 3 — REQUIRED TECHNOLOGY STACK

## Frontend

- Next.js with App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui
- Lucide icons
- TanStack Query
- React Hook Form
- Zod
- Recharts or an equivalent accessible charting library
- Playwright for end-to-end tests

## Business Backend

- Java 21
- Spring Boot 3.x or a compatible newer stable release
- Spring Security
- Spring Data JPA
- Spring Validation
- Spring Actuator
- Springdoc OpenAPI
- Flyway
- Maven
- JUnit 5
- Mockito
- Testcontainers

## AI Backend

- Python 3.12+
- FastAPI
- Pydantic
- Boto3
- Amazon Bedrock
- Retrieval-Augmented Generation where appropriate
- Structured JSON generation and validation
- Pytest
- Model evaluation fixtures

## Data and Messaging

- PostgreSQL
- Redis where caching provides measurable benefit
- Amazon SQS for AWS asynchronous messaging
- LocalStack or an equivalent local SQS-compatible implementation
- Amazon S3 for documents and inspection attachments
- Local S3-compatible storage for development

## Infrastructure

- Docker
- Docker Compose
- AWS ECS Fargate
- Amazon ECR
- Amazon RDS PostgreSQL
- Amazon Cognito
- Amazon SQS
- Amazon S3
- Amazon Bedrock
- AWS CloudWatch
- AWS Secrets Manager
- AWS Application Load Balancer
- ECS Service Connect
- Terraform
- GitHub Actions

Primary AWS region: ap-south-1 (Mumbai), subject to service and model availability.

All deployment choices must be cost-aware.

---

# SECTION 4 — MICROSERVICE ARCHITECTURE

Create these logical backend service boundaries.

## 4.1 API Gateway / Backend-for-Frontend

Responsibilities:

- Expose frontend-facing APIs.
- Validate authenticated user identity.
- Resolve tenant and selected branch.
- Verify permissions.
- Route or aggregate backend requests.
- Apply appropriate request limits.
- Provide consistent error responses.
- Propagate correlation IDs.

The gateway must not be the sole authorization layer. Individual services must enforce authorization for their resources.

## 4.2 Tenant and Branch Service

Manage:

- Workshop brands
- Branch registration
- Branch configuration
- Opening hours
- Subscription entitlements
- Staff invitations
- Staff memberships
- Role assignments
- Branch permissions
- Regional management permissions

A brand is a tenant. Branches belong to that tenant.

## 4.3 Customer and Vehicle Service

Manage:

- Customer accounts
- Customer contacts
- Customer consent settings
- Multiple vehicles per customer
- Authorized vehicle ownership relationships
- Vehicle registration number
- VIN when available
- Manufacturer and model
- Fuel type
- Vehicle year
- Odometer history
- Relevant service preferences

Customer and vehicle identities are shared across the same authorized workshop brand.

Support controlled duplicate detection and merging.

Do not assume a phone number uniquely identifies a person or that a registration number can never change.

## 4.4 Booking Service

Manage:

- Service appointment bookings
- Branch availability
- Appointment rescheduling
- Cancellations
- Service categories
- Expected duration
- Mechanic availability
- Booking statuses
- Calendar views
- Conflict prevention

## 4.5 Work Order Service

Manage:

- Vehicle intake
- Job card generation
- Customer complaints
- Initial inspections
- Technician assignments
- Repair tasks
- Inspection checklists
- Required parts
- Repair approvals
- Job progress
- Quality checks
- Completion and delivery
- Service histories

Use an explicit work-order state machine.

Suggested states:

CREATED → CHECKED_IN → INSPECTION → ESTIMATE_PENDING → AWAITING_APPROVAL → APPROVED → IN_PROGRESS → QUALITY_CHECK → READY_FOR_DELIVERY → DELIVERED → CLOSED.

Support appropriate rejection, cancellation, and rework transitions.

Reject invalid transitions.

Maintain timestamped audit history of every meaningful change.

## 4.6 Inventory Service

Manage:

- Branch inventory
- Parts catalog
- SKU or part numbers
- Stock movements
- Reserved stock
- Parts consumption
- Low-stock thresholds
- Supplier references
- Inventory adjustments
- Inter-branch transfers

Inventory must be branch-specific.

Use transactional reservation logic to prevent concurrent overselling.

## 4.7 Billing Service

Manage:

- Repair estimate versions
- Line items
- Labor rates
- Parts prices
- Discounts
- Taxes
- Customer approvals
- Invoices
- Payment status
- Refund records where applicable

Use fixed-precision monetary types, explicit currencies, and deterministic calculations.

Do not let AI independently determine final monetary totals.

## 4.8 Notification Service

Manage:

- Email messages
- SMS integration
- WhatsApp Business integration
- Customer communication preferences
- Approved message templates
- Delivery records
- Retry handling
- Dead-letter processing
- Reminder scheduling

Support provider abstractions with development-mode adapters.

Never send actual customer messages from seed data or local tests.

## 4.9 Analytics Service

Manage:

- Branch-level KPIs
- Brand-wide KPIs
- Revenue summaries
- Service turnaround times
- Repeat visits
- Repair recurrence metrics
- Inventory utilization
- Technician workload
- Reporting data models
- Authorized analytics queries

Prefer maintained read models over expensive ad hoc queries spanning multiple production services.

---

# SECTION 5 — MULTI-TENANT AND MULTI-BRANCH ARCHITECTURE

This is a critical platform requirement.

Model the hierarchy as:

MotorOS Platform
→ Workshop Brand / Tenant
→ Branches
→ Staff, bookings, work orders, stock, invoices

Customers and vehicle records belong to the tenant, not to an individual branch.

Every tenant-owned record must have a clear tenant association.

Every branch-specific record must also have a branch association.

Use UUID identifiers unless there is a strong technical reason otherwise.

Implement tenant-scoped uniqueness constraints and indexes.

Use PostgreSQL Row-Level Security where appropriate, alongside application-level authorization.

Never trust arbitrary tenant IDs or branch IDs supplied by clients.

Determine authorized context from authenticated identity and verified memberships.

## Example

Apex Motorworks has three branches:

- Anna Nagar
- Velachery
- OMR

A customer services their car at Anna Nagar.

Later, the customer visits OMR.

Authorized OMR employees must be able to view the vehicle's prior repair history, previous parts replacements, completed services, and relevant recommendations.

However, an employee of an unrelated MotorOS tenant must receive access denied.

Implement automated integration tests proving this isolation.

## Staff roles

Define at least:

- MOTOROS_PLATFORM_ADMIN
- BRAND_OWNER
- REGIONAL_MANAGER
- BRANCH_MANAGER
- SERVICE_ADVISOR
- MECHANIC
- INVENTORY_MANAGER
- CUSTOMER

Enforce least-privilege permissions.

Mechanics can access relevant vehicle service history but must not automatically see confidential business financial reporting.

Customers can access only vehicles and transactions they are authorized to view.

Implement auditing for sensitive record access and changes.

---

# SECTION 6 — MOTOROS INTELLIGENCE

Implement a dedicated AI Orchestrator using Python and FastAPI.

Initially deploy one AI service containing five clearly separated modules.

Every AI request must:

1. Authenticate the requester.
2. Verify tenant and resource permissions.
3. Retrieve only authorized context.
4. Validate input schemas.
5. Invoke a configured model provider.
6. Validate structured outputs.
7. Record model and usage metadata.
8. Return source references where required.
9. Handle model timeouts and errors safely.
10. Never automatically execute unauthorized business operations.

Define an LLM provider interface.

Implement:

- Amazon Bedrock provider for AWS.
- Explicitly configured development provider for local testing.
- Deterministic fixture provider for automated tests.

The fixture provider must be visibly identified as simulated.

Do not fabricate AI responses and present them as live model output.

## AI FEATURE 1 — Cross-Branch Vehicle History Summarizer

### Objective

Create an intelligent vehicle service summary using records across authorized branches of the same brand.

### Inputs

- Tenant context
- Vehicle ID
- Completed work orders
- Customer complaints
- Technician notes
- Service dates
- Parts replaced
- Odometer records
- Outstanding recommendations

### Outputs

- Concise vehicle history
- Previous services
- Repeated complaints
- Relevant parts replacements
- Outstanding recommended inspections
- Supporting work-order references
- Missing-information warnings

### Requirements

Every factual historical claim must be traceable to a retrieved record.

Do not invent repairs or diagnose faults from incomplete information.

Cache summaries by tenant, vehicle and source-record version.

Invalidate affected summaries when relevant records change.

### API

POST /ai/vehicles/{vehicleId}/history-summary

Provide structured output and source references.

---

## AI FEATURE 2 — Mechanic Copilot

### Objective

Build an interactive AI assistant embedded within the mechanic workspace.

### Supported questions

- What repairs were previously performed on this vehicle?
- Has this customer reported this symptom before?
- What were the findings of the previous brake inspection?
- Summarize the previous job card.
- What diagnostic checklist is relevant to this reported symptom?
- What does this approved service manual say about the procedure?

### Knowledge sources

1. Authorized vehicle service records.
2. Approved internal workshop documentation.
3. Licensed technical manuals.
4. Approved maintenance procedures.

Use tenant-aware retrieval.

Use Amazon Bedrock and RAG where appropriate.

For structured vehicle history, prefer verified internal APIs over unnecessary vector retrieval.

Implement citation rendering in the frontend.

The assistant must distinguish:

- Confirmed historical facts
- General technical guidance
- Suggested inspection steps
- Unknown or insufficient evidence

Never represent speculative mechanical advice as a confirmed diagnosis.

### API

POST /ai/copilot/chat

Support sessions, contextual follow-ups, and conversation history.

Keep AI conversations tenant-scoped.

---

## AI FEATURE 3 — AI Repair Estimate Drafting

### Objective

Assist service advisors in preparing repair estimates.

### Inputs

- Work order
- Inspection findings
- Recommended services
- Parts catalog
- Available stock
- Verified parts prices
- Branch labor rate configuration
- Applicable tax rules
- Prior relevant repair records

### Outputs

- Suggested service grouping
- Suggested labor categories
- Customer-friendly descriptions
- Draft line-item explanations
- Missing parts or pricing warnings
- Required approval status

### Financial safety

All final pricing calculations must be deterministic and performed by Billing Service.

AI must not invent prices, parts, discounts or taxes.

AI may suggest candidate services only when clearly marked as recommendations requiring verification.

Every draft must be reviewed before customer submission.

Maintain version history for revised estimates.

### API

POST /ai/estimates/draft

---

## AI FEATURE 4 — Natural-Language Business Analytics

### Objective

Allow workshop owners and authorized managers to ask natural-language questions about their operations.

### Example questions

- Which branch generated the most revenue last month?
- Compare bookings across all branches.
- Which service category has the highest repeat repair frequency?
- What is the average repair turnaround time?
- Which spare parts are consumed most frequently?
- How many repeat customers did we have this quarter?
- Which branch has the greatest pending workload?

### Architecture

Do not grant the LLM unrestricted production database access.

Implement:

Natural-language question
→ Structured analytics intent
→ Allowed metric resolution
→ Authorization validation
→ Parameterized read-only query
→ Structured result
→ AI-generated explanation
→ Dashboard visualization.

Define an allowlist of supported metrics, filters, dimensions and aggregation operations.

Use tenant-scoped reporting datasets.

Use branch restrictions according to user permissions.

Provide the executed metric definition and date range alongside results.

If an unsupported metric is requested, return a clear response rather than generating fictional values.

### API

POST /ai/analytics/query

Support chart-ready results for the dashboard.

---

## AI FEATURE 5 — Customer Communication Assistant

### Objective

Assist workshop staff in drafting personalized customer messages.

### Supported use cases

- Appointment confirmation
- Appointment reminders
- Vehicle checked-in notification
- Inspection completed
- Estimate approval required
- Repair progress update
- Vehicle ready for collection
- Invoice availability
- Periodic maintenance reminder
- Post-service follow-up

### Requirements

Use verified customer, vehicle, appointment and work-order details.

Support English and Tamil initially.

Provide selectable tone:

- Professional
- Friendly
- Concise

Allow editing before sending.

Require staff authorization and appropriate customer communication preferences.

Implement approval workflow.

Integrate with Notification Service.

Do not automatically send AI-generated messages without an explicitly configured, authorized workflow.

### API

POST /ai/communications/draft

---

# SECTION 7 — EVENT-DRIVEN ARCHITECTURE

Use REST for operations requiring immediate responses.

Use asynchronous messaging for background processing and workflow events.

Define versioned event contracts.

Example events:

- TenantCreated
- BranchCreated
- CustomerRegistered
- VehicleRegistered
- AppointmentBooked
- VehicleCheckedIn
- WorkOrderCreated
- WorkOrderUpdated
- EstimateCreated
- EstimateApproved
- PartsReserved
- PartsReservationFailed
- WorkOrderCompleted
- InvoiceIssued
- PaymentRecorded
- VehicleDelivered
- CustomerMessageRequested

Every event should contain:

- eventId
- eventType
- eventVersion
- tenantId
- branchId when applicable
- aggregateId
- occurredAt
- correlationId
- payload

Implement the transactional outbox pattern for reliable publication of business events.

Consumers must be idempotent.

Use unique constraints or event-processing records to prevent duplicate effects.

Support retries, exponential backoff and dead-letter queues.

Do not assume exactly-once delivery.

Implement tests for worker crashes, duplicate events, and delayed messages.

---

# SECTION 8 — DATABASE DESIGN

Use PostgreSQL.

Each microservice owns its database schema and credentials.

Sharing a single PostgreSQL server for cost efficiency is acceptable, but services must not directly query tables owned by another service.

Use Flyway migrations.

Create explicit referential constraints within service-owned schemas.

Define at minimum the logical entities needed for:

Tenant Service:

- tenants
- branches
- staff_memberships
- roles
- branch_permissions
- subscription_entitlements

Customer Service:

- customers
- customer_contacts
- vehicles
- vehicle_customer_relationships
- odometer_readings

Booking Service:

- appointments
- service_categories
- availability_slots

Work Order Service:

- work_orders
- work_order_tasks
- inspections
- technician_assignments
- service_records
- repair_approvals
- work_order_audit

Inventory Service:

- parts
- branch_stock
- inventory_movements
- stock_reservations
- transfer_requests

Billing Service:

- estimates
- estimate_items
- invoices
- invoice_items
- payment_records

Notification Service:

- message_templates
- notification_requests
- notification_deliveries
- communication_preferences

AI Service:

- ai_requests
- ai_conversations
- ai_history_summaries
- ai_estimate_drafts
- ai_message_drafts
- ai_feedback
- ai_usage

Add appropriate indexes, audit timestamps, uniqueness constraints and tenant isolation safeguards.

Use optimistic locking or database-level concurrency controls where appropriate.

---

# SECTION 9 — UI/UX DESIGN REQUIREMENTS

MotorOS must look and feel like a premium SaaS application.

Design inspiration:

- Linear: clean layouts and precision
- Vercel: modern typography and spacing
- Stripe Dashboard: professional information hierarchy
- High-quality automotive interfaces: strong identity and controlled visual accents

Do not copy proprietary designs.

## Design direction

Use a premium automotive-inspired design system:

- Deep charcoal
- Near-black
- Graphite
- Off-white
- Controlled amber or orange accents
- Minimal borders
- Subtle shadows
- Clear status indicators
- Smooth, purposeful animations

Support light and dark themes.

Prioritize accessibility, usability, legibility and responsiveness.

Avoid excessive gradients, huge empty dashboard cards and decorative animations that impair workflows.

Use convincing product polish without sacrificing practical business functionality.

## Essential screens

### Authentication

- Login
- Registration
- Password recovery
- Invitation acceptance
- Workshop creation

### Brand Owner

- Executive dashboard
- All-branch overview
- Branch management
- Revenue analytics
- AI analytics assistant
- Staff management
- Subscription management
- Consolidated customer history

### Branch Manager

- Operational dashboard
- Booking calendar
- Vehicle intake
- Job cards
- Mechanic assignment board
- Inventory
- Estimates
- Billing
- Customer communications

### Mechanic

- Assigned jobs
- Digital inspection checklist
- Repair notes
- Vehicle timeline
- Mechanic Copilot
- Parts requests
- Job completion

### Customer

- Vehicle garage
- Appointment booking
- Service tracking
- Service history
- Estimate approval
- Invoices
- Notification preferences

### AI Interfaces

- Vehicle history intelligence panel
- Mechanic Copilot chat
- AI estimate draft editor
- Natural-language analytics workspace
- AI customer message composer

## Multi-branch navigation

Provide an intuitive branch selector.

Owners can select:

- All branches
- Specific branch
- Authorized regional group

Managers see their authorized branches.

Mechanics operate within their assigned branch but can access permitted cross-branch vehicle history.

Branch context changes must refresh all dependent data safely.

Do not leak stale information between tenants when switching accounts.

---

# SECTION 10 — API DESIGN

Use REST APIs with OpenAPI documentation.

Use consistent response conventions.

Support:

- Pagination
- Sorting
- Search
- Filtering
- Validation errors
- Authentication failures
- Authorization failures
- Resource not found
- Conflict errors
- Idempotency keys
- Correlation IDs

Suggested endpoints:

POST /api/tenants
GET /api/tenants/current

POST /api/branches
GET /api/branches
GET /api/branches/{id}

POST /api/customers
GET /api/customers
GET /api/customers/{id}

POST /api/vehicles
GET /api/vehicles/{id}
GET /api/vehicles/{id}/history

POST /api/appointments
GET /api/appointments

POST /api/work-orders
GET /api/work-orders
GET /api/work-orders/{id}
PATCH /api/work-orders/{id}/status

GET /api/inventory
POST /api/inventory/reservations

POST /api/estimates
POST /api/estimates/{id}/approve

GET /api/analytics/overview

POST /api/ai/vehicles/{vehicleId}/history-summary
POST /api/ai/copilot/chat
POST /api/ai/estimates/draft
POST /api/ai/analytics/query
POST /api/ai/communications/draft

Exact internal routes may differ, but document the public API contract.

Generate or maintain typed frontend API clients based on contracts.

---

# SECTION 11 — AWS INFRASTRUCTURE

Target a secure, cost-aware architecture deployed in AWS Mumbai.

Use Terraform modules.

Required infrastructure components:

- VPC
- Public subnets across two Availability Zones
- Private application subnets
- Private database subnets
- Security groups
- Internet-facing ALB
- ECS cluster
- ECS Fargate task definitions
- ECS services
- ECS Service Connect
- ECR repositories
- RDS PostgreSQL
- S3 storage
- SQS queues and dead-letter queues
- Cognito user pool
- CloudWatch logs and alarms
- IAM roles and policies
- Secrets Manager
- HTTPS certificate integration
- DNS configuration when a domain is provided

Keep ECS workloads private.

Do not expose databases publicly.

Use least-privilege IAM.

Do not place application secrets in Terraform source files.

Avoid exposing sensitive Terraform outputs.

Support independently configured environments:

- Local
- Development
- Staging
- Production

Do not automatically create expensive resources.

Provide estimated costs and deployment commands before applying Terraform.

Require my approval before provisioning cloud resources.

Avoid fixed infrastructure assumptions that cause unnecessary continuous AWS charges.

---

# SECTION 12 — CI/CD

Create GitHub Actions pipelines for:

1. Code linting and formatting
2. Unit testing
3. Integration testing
4. Frontend testing
5. AI evaluation tests
6. Docker image builds
7. Security scanning
8. Image publishing to ECR
9. Deployment to staging
10. Smoke tests
11. Manual approval for production deployment

Use GitHub OIDC for AWS access.

Do not require long-lived AWS access keys in GitHub secrets.

Use immutable container image identifiers.

Support health checks and deployment rollback.

Never deploy untested code automatically to production.

---

# SECTION 13 — OBSERVABILITY AND RELIABILITY

Implement:

- Structured JSON logs
- Correlation IDs
- OpenTelemetry instrumentation
- Spring Boot Actuator
- CloudWatch dashboards
- Distributed tracing where supported
- Error rate monitoring
- API latency monitoring
- Queue depth monitoring
- Dead-letter queue alarms
- AI inference latency monitoring
- AI request cost accounting
- Database connection monitoring
- Service health endpoints

Use timeouts and bounded retries.

Define resilience behavior for unavailable downstream services.

Core workshop operations must remain usable when AI inference is unavailable.

Provide a clear fallback UI when AI features fail.

---

# SECTION 14 — SECURITY REQUIREMENTS

Implement security from the first milestone.

Mandatory controls:

- Secure authentication
- JWT validation
- Tenant isolation
- Branch authorization
- Role-based permissions
- Input validation
- Secure file uploads
- Encrypted communication
- Audit trails
- Rate limiting
- Secure secret handling
- Customer data access controls
- Configurable data retention
- Sensitive log redaction
- Safe AI tool execution
- Protection against prompt injection
- AI retrieval isolation
- Explicit customer communication consent

Follow OWASP guidance.

Do not allow LLM-generated instructions to bypass authorization or execute arbitrary SQL.

Do not let AI finalize invoices, approve purchases, or make safety-critical mechanical decisions.

Require human review.

---

# SECTION 15 — TESTING STRATEGY

Build meaningful automated tests.

## Unit tests

Test domain rules, validation, calculations, state transitions and authorization decisions.

## Integration tests

Use Testcontainers for PostgreSQL and required supporting services.

Test transactional behavior, persistence and inter-service contracts.

## Multi-tenant security tests

Verify:

- Tenant A cannot read Tenant B customer records.
- Tenant A cannot access Tenant B vehicle history.
- Branch A and Branch B under the same tenant can access authorized shared history.
- Unauthorized staff cannot access confidential financial data.
- AI requests cannot retrieve cross-tenant content.

## Concurrency tests

Verify:

- Simultaneous inventory requests do not oversell.
- Duplicate payment events do not duplicate payment records.
- Duplicate invoice events do not generate duplicate invoices.
- Conflicting appointment requests are handled correctly.

## AI evaluation tests

Create grounded datasets and expected outputs for all five AI features.

Evaluate:

- Historical factual accuracy
- Source attribution
- Unsupported claim frequency
- Tenant isolation
- Correct handling of unknown information
- Estimate pricing consistency
- Analytics query correctness
- Communication factual consistency

## E2E tests

Use Playwright to cover the complete vehicle workflow.

Example:

Create brand → Create branches → Register customer → Add vehicle → Book appointment → Check in → Inspect → Create estimate → Approve → Reserve parts → Complete repair → Issue invoice → Deliver vehicle → Open cross-branch history.

---

# SECTION 16 — MONOREPO STRUCTURE

Use a monorepo with independently buildable services.

Suggested structure:

motoros/
apps/
owner-dashboard/
workshop-dashboard/
technician-portal/
customer-portal/

services/
api-bff/
tenant-service/
customer-service/
booking-service/
workorder-service/
inventory-service/
billing-service/
notification-service/
analytics-service/

intelligence/
ai-orchestrator/
vehicle_history/
mechanic_copilot/
estimate_assistant/
analytics_assistant/
communication_assistant/
retrieval/
workers/
evaluation/

packages/
api-contracts/
event-contracts/
design-system/

infrastructure/
terraform/
modules/
environments/
dev/
staging/
prod/
docker/

tests/
integration/
contract/
e2e/
performance/
security/

docs/
product/
architecture/
api/
decisions/
deployment/

.github/
workflows/

docker-compose.yml
README.md

Keep services independently testable and deployable.

Avoid coupling them through shared database access or shared business logic.

---

# SECTION 17 — DEVELOPMENT MILESTONES

Implement the platform incrementally.

## MILESTONE 1 — Foundation and Architecture

Deliver:

- Project repository
- Monorepo structure
- Product requirements documentation
- Architecture documentation
- Initial data models
- Docker Compose
- PostgreSQL
- Shared API contracts
- Initial Next.js application
- Initial Spring Boot microservices
- Health endpoints
- Automated test setup
- Development README

Implement working Tenant, Customer, and Work Order service foundations.

## MILESTONE 2 — Authentication and Multi-Branch Management

Deliver:

- Authentication
- Tenant onboarding
- Branch creation
- Staff invitations
- Roles and permissions
- Branch switching
- Tenant isolation
- Branch isolation tests

## MILESTONE 3 — Customer and Vehicle Management

Deliver:

- Customer profiles
- Vehicle registration
- Search and filtering
- Duplicate detection
- Customer-to-vehicle relationships
- Cross-branch service history
- Vehicle timeline UI

## MILESTONE 4 — Booking and Work Orders

Deliver:

- Booking calendar
- Vehicle check-in
- Job cards
- Inspection forms
- Mechanic assignment
- Job status workflow
- Repair task management
- Repair history

## MILESTONE 5 — Inventory and Billing

Deliver:

- Parts catalog
- Branch stock
- Reservation controls
- Inventory transfers
- Repair estimates
- Customer approval
- Invoice generation
- Payment tracking

## MILESTONE 6 — Messaging and Events

Deliver:

- SQS-compatible local messaging
- Event contracts
- Transactional outbox
- Retry-safe consumers
- Notification service
- Message delivery status
- Dead-letter handling

## MILESTONE 7 — AWS Deployment

Deliver:

- Terraform modules
- ECS task definitions
- Service Connect
- RDS
- S3
- SQS
- ALB
- ECR
- Staging CI/CD
- Monitoring setup
- Deployment documentation

Prepare deployment configuration, but obtain my approval before provisioning AWS resources.

## MILESTONE 8 — AI History Summarizer

Deliver:

- AI Orchestrator
- Bedrock provider adapter
- Authorized history retrieval
- Structured summaries
- Source citations
- Summary caching
- AI evaluation tests

## MILESTONE 9 — Mechanic Copilot

Deliver:

- Conversational interface
- Vehicle-aware context
- RAG for approved technical documents
- Source references
- Conversation persistence
- Prompt-injection resistance
- Mechanic workflow integration

## MILESTONE 10 — AI Repair Estimates

Deliver:

- Estimate assistant
- Pricing data integration
- Draft generation
- Human approval
- Draft revisions
- Invoice integration
- Pricing consistency tests

## MILESTONE 11 — AI Business Analytics

Deliver:

- Analytics query interpreter
- Metric catalog
- Authorized query executor
- Chart-ready outputs
- Conversational analytics UI
- Reporting validation tests

## MILESTONE 12 — AI Customer Communication

Deliver:

- Message drafting
- English and Tamil support
- Message templates
- Staff review
- Consent handling
- Notification integration
- Delivery logs

## MILESTONE 13 — Production Hardening

Deliver:

- Performance tests
- Security tests
- Concurrency tests
- Distributed failure tests
- AI evaluations
- Observability
- Backup and restore procedures
- Accessibility checks
- Documentation

## MILESTONE 14 — Commercial Readiness

Deliver:

- SaaS subscription architecture
- Subscription entitlements
- Workshop onboarding
- AI usage quotas
- Support workflows
- Customer data export
- Branding configuration
- Operational documentation
- Pilot-ready release

---

# SECTION 18 — IMMEDIATE EXECUTION INSTRUCTIONS

Start working on Milestone 1 now.

Do not attempt to generate all fourteen milestones as disconnected placeholders.

First:

1. Inspect the working directory.
2. Identify installed development tools.
3. Create the monorepo.
4. Configure root-level project tooling.
5. Create Docker Compose for PostgreSQL and local dependencies.
6. Implement the Tenant Service using Spring Boot.
7. Implement the Customer Service foundation.
8. Implement the Work Order Service foundation.
9. Use service-owned database schemas.
10. Add Flyway migrations.
11. Add initial APIs with proper validation.
12. Create the Next.js application shell.
13. Build the initial premium MotorOS design system.
14. Add the login, tenant setup, and dashboard foundations.
15. Implement development-safe authentication and tenant authorization.
16. Add unit and integration tests.
17. Write meaningful sample fixtures for two workshop brands with multiple branches.
18. Implement one cross-branch service-history access integration test.
19. Run the services and tests.
20. Document setup, verification results, and remaining blockers.

Use a consistent local development configuration.

Make the project runnable with documented commands.

Wherever practical, provide a single root command to start local development.

Do not require AWS credentials for the local MVP.

Make the initial UI operational against real local APIs rather than displaying fake business statistics.

At the end of Milestone 1, report:

- Files created
- Services implemented
- Working features
- Test results
- Commands used
- Known limitations
- Security considerations
- Recommended next milestone

Continue building logically and preserve working functionality throughout.

---

# SECTION 19 — QUALITY BAR

MotorOS must meet these engineering expectations:

- No unauthorized cross-tenant data exposure.
- No hardcoded credentials.
- No misleading mock AI outputs.
- No duplicate financial operations on event retries.
- No inventory overselling under tested concurrency conditions.
- No unrestricted AI database access.
- No direct cross-service database queries.
- No broken navigation or placeholder action buttons in delivered features.
- No unhandled server exceptions exposed as raw stack traces.
- No public AWS deployment without approval.
- No claims of production readiness before relevant tests pass.

Ensure the platform remains maintainable, modular, and extensible.

Build it like a real SaaS product expected to serve paying customers—not merely to impress someone in a demo.

---

# SECTION 20 — FINAL DIRECTION

MotorOS should deliver an exceptional combination of:

1. Premium automotive SaaS user experience.
2. Multi-tenant and multi-branch management.
3. Shared customer and vehicle history across branches.
4. Reliable microservice architecture.
5. Real-world inventory, repair, billing and communication workflows.
6. Five genuinely integrated AI capabilities.
7. Cost-aware AWS cloud deployment.
8. Strong security, testing, observability and CI/CD.
9. Commercial subscription readiness.
10. Practical business value for automotive workshops.

Make technically sound decisions independently where reasonable.

Prioritize security, correctness, usability, and observable results.

**Begin implementing Milestone 1 immediately. Do not stop at planning or scaffold generation.**
