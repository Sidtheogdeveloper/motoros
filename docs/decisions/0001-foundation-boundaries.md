# ADR 0001 — Three deployable domain services and one UI/BFF

Accepted: 2026-10-24. Scope: Milestone 1, local development.

Tenant owns brands, branches and development staff identities. Customer owns brand-wide customers and vehicles. Work Order owns branch operations, state transitions, audit history and completed vehicle history. Each Spring Boot application has its own schema, database login, migration history and executable JAR. Services never read another service's schema. Work Order verifies vehicle ownership through the Customer HTTP API using the caller's bearer token, with bounded connect/read timeouts. Failure prevents creation rather than accepting an unverified reference.

Use one PostgreSQL instance locally, with separate service roles that own only their schemas. This reduces local resource use without sharing tables. A future split into separate databases does not change the HTTP boundary. The small shared Java module contains transport errors, identity validation and permission checks, with no workshop business logic.

Start with one Next.js App Router application serving role-aware foundations and a same-origin BFF. Splitting owner, mechanic and customer applications before their workflows exist adds deployment cost without useful separation. Do not create empty deployables for future services.

The UI uses live APIs and real persisted data. Synthetic fixtures are explicitly named and opt-in. Inventory, billing, messaging and AI are future milestones. No fake AI output or fabricated business revenue is delivered.

The future AWS network keeps ECS and RDS private behind an ALB. Service Connect supplies service discovery and communication within an ECS namespace; it does not replace per-service authentication or authorization. Reference: [AWS Service Connect](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html). Cloud provisioning and Terraform apply are outside current authorization.
