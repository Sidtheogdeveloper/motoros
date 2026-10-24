# Milestone 1 acceptance and scope

MotorOS is a multi-tenant, multi-branch operating system for workshops. A brand owns customer and vehicle identities; a branch owns the work performed. The foundation supports a brand owner creating their workshop, registering customers and vehicles, opening work orders, applying valid state transitions and viewing completed service history from another authorized branch.

Delivered service models: tenant, branch, local staff identity, customer, vehicle, work order, transition audit and sensitive history-access audit. UUIDs identify resources. Vehicle registration and phone numbers are indexed/searchable attributes rather than immutable globally unique identities. Current ownership supports one customer per vehicle; multiple owners and ownership changes belong to Milestone 3.

The work-order lifecycle is a foundation state machine. Estimate and approval status names do not implement billing, customer consent or invoice issuance. Those operations must be integrated and guarded in Milestones 4–5 before commercial use. Current completion records contain the intake complaint, lifecycle and audit note; structured inspections, repair notes, replaced parts and odometer history are not yet modeled.

Milestone 2 priorities: Cognito/OIDC integration, invitations, per-branch staff memberships, complete role permission matrix, password recovery and account lifecycle, immediate permission revocation strategy, regional access and PostgreSQL RLS defense in depth.

Subsequent milestones follow the master brief. Keep every milestone buildable and validate working features before expanding scope. AI provider calls and cloud infrastructure do not belong in this foundation release.
