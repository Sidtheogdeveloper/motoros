# CI, release evidence and rollback

The original verification workflow still runs the full Java, Node, browser, API, migration and messaging recovery suites. Platform CI adds Terraform validation, mocked plans, security/lint checks, source/history secret scanning and actual image builds. Changed-service detection includes shared Java foundations and object-storage dependencies. Pull requests receive no AWS credentials and cannot execute privileged deployment workflows.

Cloud workflows are manual, main-branch-only and protected by environment-specific GitHub OIDC roles. Image publication builds commit-SHA images, scans them, pushes immutable tags and records registry digests. Deployment consumes release evidence; production promotes the verified staging content using digest-preserving registry copying, without rebuilding. Configure cross-account ECR source-read permissions separately if accounts differ.

The reviewed Terraform model owns task configuration. `prepare-release` copies only approved task-definition fields, substitutes the reviewed image digest, adds release tags and registers immutable application/migration revisions. Migration evidence records the actual task revision. All eight migration processes must exit successfully before any new application service is rolled out.

After each service stabilizes, the deployment tool verifies that its PRIMARY deployment still points to the requested revision. A circuit-breaker rollback is a failed release, even if ECS has become stable again. A release manifest contains the source SHA, nine image digests, migration task results, prior task definitions and verification times. The first deployment has no known-good rollback target. `rollback` refuses fabricated/empty previous-health evidence and never runs database down-migrations.

Private Terraform plans go to the restricted KMS-encrypted state bucket; only the plan hash is printed. Do not upload state, plans, secret bundles, browser sessions or arbitrary logs as public Actions artifacts. Public release artifacts contain digests and safe deployment identifiers only. Update environment metadata after infrastructure changes; never mix staging authorization with production metadata.

Before enabling workflows, configure reviewer protection, branch restrictions, OIDC provider, exact role ARNs, state/policy inputs and approved synthetic smoke references. Merely naming a GitHub environment does not configure its protection rules. The production evidence gate reads required-reviewer configuration and refuses missing staging evidence. Remote workflow success is not implied by local syntax validation.

## Useful operator commands

```sh
node infrastructure/scripts/cloud.mjs validate
node infrastructure/scripts/cloud.mjs build
node infrastructure/scripts/cloud.mjs preflight infrastructure/staging.local.json
node infrastructure/scripts/cloud.mjs plan infrastructure/staging.local.json .runtime/review.tfplan
# After explicit approval, protected workflow authorization and exact plan-hash review:
node infrastructure/scripts/cloud.mjs apply infrastructure/staging.local.json .runtime/review.tfplan
node infrastructure/scripts/cloud.mjs initialize infrastructure/staging.local.json .runtime/deployment.json
node infrastructure/scripts/cloud.mjs prepare-release infrastructure/staging.local.json .runtime/deployment.json .runtime/release.json .runtime/release-deployment.json
node infrastructure/scripts/cloud.mjs migrate infrastructure/staging.local.json .runtime/release-deployment.json .runtime/migrations.json
node infrastructure/scripts/cloud.mjs deploy infrastructure/staging.local.json .runtime/release-deployment.json .runtime/release.json .runtime/migrations.json
```

These commands are executable tooling, not authorization to provision. Mutations require `MOTOROS_DEPLOY_AUTHORIZATION` for the exact environment and a short-lived target-account role; infrastructure apply additionally requires the approved plan SHA256.

`bootstrap.yml` and `initialize.yml` are independently protected manual operations. Bootstrap uses existing private review storage; initialization runs the reviewed private operator while application desired counts remain zero. Publishing produces the nine application digests and a separate operator digest. See aws-setup.md for protected runner/resolver prerequisites. A named GitHub environment or runner label alone does not establish those protections.

Prepared cloud smoke requires isolated synthetic Apex owner, authorized Velachery employee and Precision employee contexts, existing customer/vehicle/job/document IDs, an unauthorized branch ID and valid booking input. It covers login, a real five-minute access-token expiry/refresh, logout, cross-branch reads and tenant/branch denials. It does not record tokens/screenshots/traces. AWS smoke, isolated restore data verification and bad-image rollback must actually pass before claiming staging readiness.
