# Backup and recovery runbook

These are prepared procedures, not achieved recovery objectives. No AWS restore or destructive exercise has run. Preserve the source image/digest manifest, state versions, schema migration history, KMS access and prior secret versions as recovery dependencies.

| Failure                 | Recovery procedure                                                                                                                                                                   | Proposed objective, unverified                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| RDS failure/deletion    | Multi-AZ production failover for instance failures; otherwise restore PITR to a NEW private instance, validate schemas/counts/isolation, update reviewed endpoints and replace tasks | RPO <=5 minutes / RTO <=2 hours target; measure before making a commitment    |
| S3 object loss          | Restore the previous object version after tenant/resource ownership review; never make the bucket public                                                                             | RPO previous completed version; RTO <=4 hours target                          |
| Bad application release | Verify previous healthy task revisions; rollback images/config only; re-run smoke tests                                                                                              | RTO <=30 minutes target after a known-good deployment exists                  |
| Queue backlog           | Restore consumers/downstream service, inspect DLQs, authorize metadata-only redrive through existing validation/inbox checks                                                         | Recovery bounded by queue retention; no exactly-once claim                    |
| Secret rotation failure | Restore retained secret stage/compatible key, replace affected tasks and verify; keep encrypted-record keys until migration is proven                                                | RTO depends on key recovery; lost decryption keys can make data unrecoverable |
| Terraform error         | Acquire the native state lock, compare actual resources, recover a verified state object version and refresh under review; never blindly overwrite state                             | RTO <=4 hours target; no regional DR claim                                    |

RDS staging backups retain seven days; production prepares fourteen days, encryption, deletion protection and final snapshots. Snapshot retention does not replace restore verification. S3 versions and CloudTrail records are retained without an automatic destructive purge. Approve a legal/data-retention policy before enabling destructive cleanup. Rotated KMS keys and encrypted application records must remain recoverable throughout retention.

## Isolated staging restore exercise

After explicit approval for its additional charges, select a recent staging restore time and a NEW `motoros-staging-restore-*` identifier. Use the staging-only exercise tool to call PITR with private DB subnet/security groups and a small reviewed class. Wait for availability. Launch a private verification task against the restored endpoint with dynamically injected credentials and verified TLS; run Flyway validate, schema/record counts, all cross-schema denials and synthetic Apex/Precision reads. Record actual start/end timestamps, restore point, source/target identifiers and verification results without customer rows.

Do not repoint the live staging app until restored data is verified. Do not touch production. Keep the original database and backups. Cleanup of the temporary restored database requires separate explicit approval, an exact identifier check and retention review. Measure RPO/RTO from this exercise; replace the proposed objectives above with actual evidence only after execution.

During an unhealthy-image exercise, first verify a healthy deployed prior revision. Deploy a deliberately failing staging task revision, observe circuit-breaker failure and recovery, and compare the restored task ARN to the prior healthy ARN. Merely configuring rollback is not a successful rollback test. Database migrations are never reversed by an image rollback.

## Guarded exercise commands

These commands are disabled unless both the exact staging authorization and exercise marker are supplied through a separately approved recovery-role session:

```sh
MOTOROS_DEPLOY_AUTHORIZATION=staging MOTOROS_STAGING_EXERCISE=restore node infrastructure/scripts/staging-exercise.mjs restore infrastructure/staging.local.json .runtime/deployment.json .runtime/restore-evidence.json motoros-staging-restore-REVIEWED-IDENTIFIER
MOTOROS_DEPLOY_AUTHORIZATION=staging MOTOROS_STAGING_EXERCISE=bad-image node infrastructure/scripts/staging-exercise.mjs bad-image infrastructure/staging.local.json .runtime/deployment.json .runtime/rollback-evidence.json
```

Use a lowercase exact restore identifier matching the documented prefix. The restore phase requests a new private instance and records `RESTORING_UNVERIFIED`; it does not pretend that availability proves restored application correctness. The subsequent private SQL/Flyway and tenant-isolation verification remains an operator procedure described above. The bad-image phase records the prior healthy task, deliberately exits the staging BFF, and checks authoritative ECS recovery. Neither procedure deletes data or performs down-migrations. Both remain unexecuted; a separately reviewed recovery policy is required.
