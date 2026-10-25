# Milestone 7 security review

Review date: 2026-10-25. Scope: source, local applications, images and unapplied Terraform. AWS IAM enforcement, KMS behavior, private routing, Cognito login, SES sending and cloud rollback have not been exercised in a deployed account.

## Implemented controls

- Only frontend/BFF ingress is public. Tasks/RDS/cache are private, with restricted service groups, no task public IP, a closed default security group and VPC flow logs. HTTP only redirects to HTTPS. Internal service traffic uses Service Connect TLS with the required ECS-managed CA tag and scoped encryption permissions.
- Runtime credentials are service-owned DML credentials. Separate migration credentials own schemas; runtime cannot change Flyway history or create tables. Cross-service database grants are absent.
- Cognito authenticates; Tenant database memberships authorize. Generated client IDs map explicitly to logical machine identities. Provider groups do not grant business permissions; legacy Keycloak identities are not linked by matching email.
- Objects are private/versioned/KMS-encrypted. Server-owned namespaces restrict service access; existing authorization, content/checksum checks and five-minute URLs remain mandatory. Public CloudFront origins are not used for private documents.
- State and plans are encrypted, versioned, access-restricted and absent from Git. S3 native lock files protect concurrent Terraform runs. Execution, application, migration, initialization, publication and deployment permissions are separated. Secret values are not Terraform outputs or public artifacts.
- CloudTrail, encrypted logs, WAF production rules, redacted WAF request fields, alert policies and audited application operations provide layered evidence. WAF samples are disabled. Platform messaging routes are disabled on public ingress; additional private administrator access must be configured separately. AWS operations use scoped protected roles, not workshop staff roles.

## Findings and remediation

The initial frontend image scan found five high findings in unused globally installed npm packages. The standalone runtime removes package-manager tooling; the revised image is rescanned rather than ignored. Backend scans identified patchable OS/Jackson/Netty/Tomcat/HTTP Core/PostgreSQL JDBC dependencies. Compatible security patches are selected from available artifacts; Tomcat 10.1.58 was named by an advisory but absent from Maven Central, so the available 10.1.61 release is used. AWS SDK modules align through BOM 2.57.3.

Two Spring MVC advisories remain library-level scanner matches for 6.2.19. MotorOS has neither XSLT rendering nor SSE view fragments. The exact-version OpenVEX statements document non-applicability and vendor references; `check-vex.mjs` fails on relevant feature additions or after 2026-11-25. This is not a patched-library claim or an unrestricted CVE ignore. Spring's own advisories classify these cases MEDIUM/LOW while the scanner reports CRITICAL; record both rather than hiding the difference. References: [XSLT advisory](https://spring.io/security/cve-2026-47884/), [SSE advisory](https://spring.io/security/cve-2026-47890/).

## Explicit scanner exceptions

Exceptions are attached to specific resources in generated HCL and retained in the structured source. They cover staging's approved single-AZ database/cache, shorter operational log retention, deliberate HTTP redirect ingress, KMS resource-policy wildcard semantics, and coordinated application-secret rotation. SSE-S3 is used only for access-log destinations that require it; customer documents, state and CloudTrail use KMS. Cross-region replication is not silently provisioned: it needs a separate region/cost/restore review. Scan counts and exact remaining findings are recorded in the milestone report.

## Rotation and production gates

RDS manages the operator password. Service DB passwords and confidential OAuth client secrets require coordinated rotation and task replacement: pause affected writers, retain previous secret versions, create/test the new credential, update only the owned runtime secret, replace tasks, confirm successful connections, then revoke the old credential. Existing sessions may need reauthentication when the BFF encryption key changes.

Do not blindly rotate invitation, approval or notification AES keys: existing ciphertext must first be decrypted with the retained old key and re-encrypted in a controlled, backed-up maintenance operation. The current application is not a multi-key keyring. This is a production rotation/recovery concern, not an excuse to attach automatic random rotation that would destroy access to pending records. Rotation exercises remain unperformed in AWS.

Infrastructure provisioning permissions are generated from the actual reviewed plan and supplied as an explicit policy input; an empty policy leaves the provisioning role unusable. Regional metadata reads are broader where AWS cannot resource-scope Describe/List operations. Customer-object reads, application-secret reads and database SQL access are not granted to general operational metadata roles. Review every supplied policy and its permission boundary before enabling the account. Validate policies with IAM Access Analyzer when account access is available.

The private ALB-to-BFF target hop is HTTP after edge TLS termination; do not claim end-to-end TLS on that hop. Database RLS, object malware scanning, a private admin frontend, workload/load tests and all earlier financial/legal limitations are not newly claimed by this milestone. Production release requires separate review of those applicable concerns.

## Request-log privacy

ALB access logs and private-object S3 server-access logs are deliberately disabled: their raw request URIs can retain OAuth authorization codes or presigned bearer URLs. The BFF emits generated correlation IDs, methods and allowlisted route categories, omitting raw paths, query strings, headers and bodies. Existing backend mutation audits, encrypted application logs, ALB/S3 aggregate metrics, VPC flow logs and management-event CloudTrail remain available. Resource-specific scanner exceptions record this privacy decision. Do not enable raw URL capture without a reviewed redaction design.

The initial one-off operator image used an older Debian base with unresolved scanner findings. It was replaced with an updated Alpine base and rescanned; unused runtime package managers are removed. The initializer is not a persistent business service and must still pass its publication scan.
