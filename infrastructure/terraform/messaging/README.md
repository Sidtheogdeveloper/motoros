# SNS/SQS deployment target (unapplied)

This module prepares seven producer topics, three independent standard subscription queues and their DLQs, encryption references, source-scoped subscription policies, and configurable backlog/age alarms. No AWS resources have been provisioned. Supply an existing customer-managed key ARN, account ID and an explicitly configured AWS provider/region. Review its key policy and workload roles before planning deployment; validation does not prove permissions or delivery in an AWS account.

Production services use `MESSAGING_ENABLED=true`, an empty `MESSAGING_ENDPOINT`, the real `MESSAGING_ACCOUNT`, region/prefix and workload credentials. `MESSAGING_BOOTSTRAP` must remain false. Consumer queues are separate copies; the Work Order subscription does not share Notification's copy. Source topics contain no email addresses or approval tokens. TLS is required at the queues. Runtime workloads must not receive topic/queue creation or account-wide replay permissions.

Policy generation is based on Java SDK source analysis. IAM Policy Autopilot 0.3.0 was available and the broker adapter was analyzed locally. The adapter also contains local-only bootstrap, diagnostic and recovery calls, so its combined baseline is **not a production runtime-role policy**. Do not attach it unchanged. Generate and review deployment-specific policies with concrete account/region/resource context, separating bootstrap/operator permissions from publishing and each consumer. The command never uploads policies:

```powershell
$brokerSource = (Resolve-Path packages/service-foundation/src/main/java/com/motoros/foundation/events/EventBroker.java).Path
$env:DISABLE_IAM_POLICY_AUTOPILOT_TELEMETRY = 'true'
uvx iam-policy-autopilot@latest generate-policies $brokerSource --region ap-south-1 --account <deployment-account-id> --service-hints sns sqs --tf-dir (Resolve-Path infrastructure/terraform/messaging).Path --pretty
```

The existing object-storage adapter has a separate storage policy boundary; include its runtime source when analyzing storage roles. Neither AI nor ordinary workshop roles should receive bus credentials. Limit each producer to its own topic; scope each consumer to its own queue/DLQ and required key use. Platform replay APIs still check live Tenant authority and audit actions; IAM access is not a substitute for that check.

The default queue-age threshold (300 seconds) and two-period nonempty-DLQ alarm are initial operational settings, not an AWS service guarantee. Change them for workload latency objectives. Configure alarm actions explicitly; an empty list creates no notification destination. Define application alarms for outbox age/backlog, repeated publication failure, consumer errors, provider failure and service health using the metrics described in the event reliability architecture. An idle queue's missing age metric is not evidence of a service outage; monitor service availability separately.

References: [SNS to SQS subscription policies](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html), [SNS envelope versus raw delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html), [SQS monitoring metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html).
