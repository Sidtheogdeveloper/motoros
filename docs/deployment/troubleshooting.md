# Deployment troubleshooting

| Symptom                                             | Inspect and resolve                                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SubscriptionRequiredException / OptInRequired       | Resolve AWS account/service activation with the account owner; do not create replacement resources or claim deployment succeeded                                      |
| Preflight refuses account/identity                  | Use the intended short-lived assumed role; root and IAM-user credentials are refused                                                                                  |
| Private task cannot pull an image                   | Confirm ECR digest/repository, execution-role access, NAT routes/S3 endpoint and DNS; task has no public IP by design                                                 |
| Service Connect TLS fails                           | Check active short-lived CA, AmazonECSManaged=true tag, infrastructure role, CMK permission and proxy resources                                                       |
| Database startup failure                            | Check private routes, application group, verified CA chain, owned runtime secret and successful migration task; do not use the operator DB account for the app        |
| Flyway task exits unsuccessfully                    | Inspect restricted owned-service logs; stop rollout, correct the migration/configuration and retry; never enable Flyway on all replicas                               |
| Runtime cannot read Flyway history                  | Verify the migration task completed privilege finalization: runtime needs SELECT on its own history for startup validation, with no history writes or DDL             |
| Cognito authenticated but API rejects machine calls | Check actual generated client IDs, logical map, motoros/internal scope, issuer and JWKS; aliases are not a cloud identity                                             |
| Login/session fails                                 | Verify exact HTTPS callback/logout, Secure cookies, Redis TLS/IAM permissions and clock; keep session failures fail-closed                                            |
| S3 upload fails in browser                          | Compare exact runtime CSP/CORS origin, checksum/content headers, short URL expiry, service object namespace and live tenant permission                                |
| Notification not SENT                               | Check consent, current source state, verified SES sender/recipient sandbox rules, own secret and retry history; provider acceptance is not delivery/read confirmation |
| Deployment stable but old code runs                 | Compare PRIMARY task ARN to requested release; circuit-breaker rollback is a release failure                                                                          |
| Image scanner cannot download data                  | Retry official GHCR DB repositories; never convert a failed scan into a passing scan                                                                                  |

`cloud.mjs inspect` writes safe fleet metadata under a scoped role. Queue and outbox diagnostics remain in the protected application APIs/CloudWatch; public workshop routes do not expose raw payloads or credentials. Keep logs restricted and avoid TF_LOG, AWS CLI debug, callback query logging or public browser trace uploads.
