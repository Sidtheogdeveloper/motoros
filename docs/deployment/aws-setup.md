# AWS setup and approval gates

No resources were provisioned during Milestone 7 preparation. Read-only STS authentication succeeded. Mumbai ECS, RDS, Cognito, ACM and ElastiCache inventory calls returned SubscriptionRequiredException/OptInRequired; ECR was readable and listed no repositories. The connection reported a root identity. It is not accepted by the deployment tools. Account activation, a working short-lived role and account permissions are prerequisites; changing account/billing settings is not part of this implementation.

## Required operator inputs

Copy `infrastructure/deployment.example.json` to an ignored `infrastructure/staging.local.json`. Supply the real account, exact HTTPS origin, issued ACM certificate ARN, owner/cost tags, verified SES identity/sender, supported PostgreSQL engine version, approved budget and alert email. The example intentionally fails validation. Do not enter secrets in this file. Production uses a different file, independent state and separate resource references.

Use IAM Identity Center/assumed roles for operators and GitHub OIDC for CI. Prepare the GitHub OIDC provider through an explicitly approved bootstrap operation or reference an existing verified provider. Configure protected GitHub environments for staging/production, `*-publish`, `*-plan`, `*-infrastructure`, `*-initialize` and operations. Production requires reviewers and main-branch restrictions. Export only nonsecret Terraform deployment metadata to `MOTOROS_DEPLOYMENT_JSON`; configure `AWS_ROLE_ARN` and `MOTOROS_CONFIG_JSON` separately for each protected environment.

## Approved execution sequence

1. Review current costs, security exceptions and a working non-root role. Obtain explicit approval for bootstrap before creating any state bucket, KMS key, OIDC provider or IAM role.
2. Initialize the separate Terraform bootstrap root. Supply real state-role ARNs, bucket name and region. Review its plan, apply only after approval, then move its initially local state into restricted encrypted storage. Local state is ignored by Git and must be protected before the move.
3. Initialize the chosen environment with the real bucket and an independent `motoros/<environment>/terraform.tfstate` key. Use `use_lockfile=true`; Terraform 1.13.5 supports native S3 locking. Do not add DynamoDB as a mandatory lock dependency.
4. Run read-only `cloud.mjs preflight`. Verify exact-domain ACM issuance, SES verification, region engine support, AWS role/account and configuration. DNS and certificate validation must be completed by an authorized DNS operator; no domain is invented by the code.
5. Generate a reviewed, resource-scoped Terraform provisioning policy using IAM Policy Autopilot against the actual saved plan. Provide it as `provisioning_policy_json`; the infrastructure role otherwise has no provisioning rights. Provide state bucket/key ARNs explicitly. Do not attach the broad source-analysis baseline unchanged. Validate proposed policies with IAM Access Analyzer before enabling the infrastructure workflow.
6. Create/review the environment plan with empty application images. The plan may create chargeable persistent infrastructure; obtain approval for that exact plan hash and cost review. Apply only through the protected workflow or an explicitly authorized operator session.
7. Build, scan and publish the nine application images and the one-off operator image through authorized ECR publication. Supply verified digest references in environment inputs. Never deploy `latest`. The operator repository is tooling, not a tenth business service.
8. Initialize the verified SES SMTP secret without displaying its values. Register the operator task using its digest and secret ARN. Run `cloud.mjs initialize`; applications must all be stopped. It generates owned DB/application secrets privately and maps Cognito client IDs. No real account is linked by email to a local Keycloak subject.
9. Materialize image-backed task templates through a reviewed plan while ECS services remain at desired count zero. Export updated nonsecret metadata. Run the authorized release workflow: evidence gates, task revision registration, eight serial migrations, rollout, steady-state verification and smoke tests.
10. Create fresh synthetic Apex/Precision identities and workshops through Cognito/UI/APIs using verified staging recipient addresses. Store their smoke context privately in Secrets Manager. Use an asm-exec reference, not pasted credentials. Execute AWS acceptance and recovery exercises only after separate authorization.

An account/subscription error, missing domain, missing policy, unverified sender, failed migration or absent digest is a blocking prerequisite. Do not replace it with loopback URLs, dummy ARNs, public databases, mock providers or development approval.

## Protected runner prerequisites

The bootstrap workflow requires a protected `motoros-bootstrap` Linux runner and a pre-existing organization-managed private KMS review bucket, different from the state bucket being created. It stores bootstrap state and reviewed plans there with native locking. If no such organization storage exists, perform the separately approved initial bootstrap from a secured operator environment and immediately migrate its state; the automated workflow deliberately refuses an unprotected circular bootstrap.

Deployment verification uses a protected ephemeral `motoros-deploy` Linux runner (or reviewed `MOTOROS_DEPLOY_RUNNERS` JSON labels). Install the trusted `asm-exec` runtime secret resolver and its authenticated backend outside this repository; no resolver, credentials or private fixtures are copied from a desktop plugin into the public source. Require AWS CLI, Node 24, Terraform 1.13.5, browser dependencies and access to the public application. The runner's smoke role needs only its synthetic fixture secret. Runner/environment protection and resolver installation are unconfigured prerequisites, not claimed working infrastructure. Initialization has its own `staging-initialize`/`production-initialize` role and manual workflow.

After authorized image publication, use `operator-release.json`'s immutable digest as `operator_image` in the reviewed environment plan. Export fresh deployment metadata after the operator task exists, then run the separate initialization workflow. No publication occurs in the preparation phase.
