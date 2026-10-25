import { readFileSync, writeFileSync } from 'node:fs';
const load = (file) => JSON.parse(readFileSync('docs/deployment/' + file, 'utf8')).products;
const base = load('pricing-snapshot.json'),
  storage = load('pricing-storage.json'),
  extra = load('pricing-addons.json'),
  remaining = load('pricing-remaining.json');
function price(rows, predicate = () => true, minimum = '0') {
  const row = rows.find(predicate);
  if (!row) throw new Error('Pricing product missing');
  const p = row.prices.find((p) => String(p.beginRange || '0') === minimum);
  if (!p) throw new Error('Pricing tier missing');
  return Number(p.USD ?? p.pricePerUnit.USD);
}
const cpu = price(base.fargate_cpu),
  memory = price(base.fargate_memory),
  nat = price(base.nat, (r) => r.attributes.usagetype === 'APS3-NatGateway-Hours'),
  natBytes = price(base.nat, (r) => r.attributes.usagetype === 'APS3-NatGateway-Bytes'),
  alb = price(
    base.alb,
    (r) =>
      r.attributes.usagetype === 'APS3-LoadBalancerUsage' &&
      r.attributes.operation === 'LoadBalancing:Application',
  ),
  lcu = price(
    base.alb,
    (r) =>
      r.attributes.usagetype === 'APS3-LCUUsage' &&
      r.attributes.operation === 'LoadBalancing:Application',
  );
const reports = [];
for (const [name, hours, replicas, production] of [
  ['staging-always-on', 730, 1, false],
  ['staging-weekdays', 220, 1, false],
  ['production-baseline', 730, 2, true],
]) {
  const rows = [];
  function add(item, quantity, rate, assumption) {
    rows.push({
      item,
      quantity,
      unitRateUSD: rate,
      costUSD: Number((quantity * rate).toFixed(4)),
      assumption,
    });
  }
  add(
    'Fargate vCPU-hours',
    9 * 0.5 * hours * replicas,
    cpu,
    'Nine application/BFF tasks; 0.5 vCPU each including Service Connect',
  );
  add(
    'Fargate GB-hours',
    9 * hours * replicas,
    memory,
    '1 GiB each; no Fargate Spot or commitments assumed',
  );
  add(
    'RDS instance-hours',
    730,
    production
      ? price(remaining.production_rds)
      : price(base.rds, (r) => r.attributes.usagetype === 'APS3-InstanceUsage:db.t4g.small'),
    production
      ? 'Multi-AZ db.m7g.large; does not imply tested capacity'
      : 'Single-AZ db.t4g.small remains on during app scale-down',
  );
  add(
    'RDS gp3 GB-month',
    20,
    price(
      storage.rds_storage,
      (r) =>
        r.attributes.usagetype ===
        (production ? 'APS3-RDS:Multi-AZ-GP3-Storage' : 'APS3-RDS:GP3-Storage'),
    ),
    '20 GiB initial allocation; autoscaling storage increases charges',
  );
  add(
    'Valkey node-hours',
    730 * replicas,
    price(base.cache),
    'Private node-based cache, one node staging / two production',
  );
  add(
    'NAT gateway-hours',
    730 * (production ? 2 : 1),
    nat,
    'Persistent egress gateways, not stopped with ECS',
  );
  add(
    'NAT data processing GB',
    10,
    natBytes,
    '10 GiB monthly egress-processing assumption, separate from transfer charges',
  );
  add('ALB hours', 730, alb, 'One internet-facing ALB spans two AZs');
  add('ALB LCU-hours', 730, lcu, 'One average LCU assumption');
  add(
    'Public IPv4 hours',
    730 * (production ? 4 : 3),
    price(storage.ip),
    'Two ALB addresses plus one/two NAT Elastic IPs; actual allocation may vary',
  );
  add(
    'Short-lived CA month',
    1,
    price(extra.pca, (r) => r.attributes.usagetype === 'APS3-ShortLivedCertificatePrivateCA'),
    'Private CA persists during scale-down; no trial assumed',
  );
  add(
    'TLS certificates',
    9 * 6,
    price(extra.pca, (r) => r.attributes.usagetype === 'APS3-ShortLivedCertificatesIssued'),
    'Six renewals per service/month; verify actual issuance with ECS',
  );
  add(
    'Secrets-month',
    29,
    price(extra.secrets, (r) => r.attributes.usagetype === 'APS3-AWSSecretsManager-Secrets'),
    '20 application/migrator/master/SMTP/smoke bundles plus nine assumed Service Connect TLS secrets',
  );
  add(
    'Secrets API calls',
    10000,
    price(extra.secrets, (r) => r.attributes.usagetype === 'APS3-AWSSecretsManagerAPIRequest'),
    '10,000 calls; generated TLS secret rotation is additional',
  );
  add(
    'Cognito M2M requests',
    7 * hours * 13 * replicas,
    price(extra.cognito, (r) => r.attributes.usagetype === 'APS3-CUPM2MTokenRequestsFull'),
    'Upper-bound steady activity of seven client caches refreshing up to 13 times/hour; no per-client registration fee',
  );
  add(
    'SNS publishes',
    100000,
    price(extra.sns, (r) => r.attributes.usagetype === 'APS3-Requests-Tier1', '1000000'),
    'Conservative paid-tier price without assuming free credits',
  );
  add(
    'SQS standard requests',
    production ? 10000000 : hours === 730 ? 5000000 : 1500000,
    price(extra.sqs, (r) => r.attributes.usagetype === 'APS3-Requests-Tier1'),
    'Includes idle polls, deliveries, deletes and retries; 64 KiB request billing applies',
  );
  add(
    'Private S3 GB-month',
    10,
    price(storage.s3_storage),
    '10 GiB including versioning/audit assumptions; version growth adds usage',
  );
  add('S3 PUT/LIST requests', 10000, price(storage.s3_put), 'Includes uploads and audit writes');
  add(
    'S3 GET requests',
    100000,
    price(storage.s3_get),
    'Includes authorized reads and operator artifacts',
  );
  add(
    'ECR GB-month',
    10,
    price(storage.ecr, (r) => r.attributes.usagetype === 'APS3-TimedStorage-ByteHrs'),
    'Nine apps, operator tool and retained rollback layers',
  );
  add(
    'CloudWatch ingested GB',
    5,
    price(storage.cloudwatch_logs),
    'Application, VPC and audit log-volume assumption',
  );
  add(
    'CloudWatch unique metrics',
    80,
    price(storage.cloudwatch_metrics),
    'Exporter filters unbounded/JVM route dimensions; verify series count after deployment',
  );
  add(
    'KMS active key versions',
    2,
    price(remaining.kms, (r) => r.attributes.usagetype === 'ap-south-1-KMS-Keys'),
    'One environment key plus one allocated bootstrap key share; rotations add active versions',
  );
  add(
    'KMS requests',
    100000,
    price(remaining.kms, (r) => r.attributes.usagetype === 'ap-south-1-KMS-Requests'),
    '100,000 symmetric-key calls; no free tier assumed',
  );
  add(
    'SES outbound recipients',
    1000,
    price(remaining.ses, (r) => r.attributes.usagetype === 'APS3-Recipients'),
    'Traditional SES SMTP sending, no dedicated IP or advanced SES plan',
  );
  const quoted = rows.reduce((n, r) => n + r.costUSD, 0);
  // These are budget reserves, explicitly not fabricated AWS unit prices.
  const allowance = production ? 100 : 60;
  reports.push({
    scenario: name,
    applicationHours: hours,
    rows,
    pricedSubtotalUSD: Number(quoted.toFixed(2)),
    unpricedBudgetReserveUSD: allowance,
    planningTotalUSD: Number((quoted + allowance).toFixed(2)),
    reserveCovers: [
      'CloudWatch dashboards/alarms/API calls/stored logs/Container Insights',
      'Internet and cross-AZ data transfer',
      'Backup/snapshot overages',
      'Cognito human MAUs/MFA delivery',
      'WAF in production',
      'Service Connect certificate-secret storage',
      'One-off migration/restore/initialization tasks',
    ],
    notProvisioned: ['Interface VPC endpoints', 'Read replicas', 'AI/Bedrock services'],
    approvalStatus: 'NOT_APPROVED',
  });
}
const output = {
  date: '2026-10-25',
  region: 'ap-south-1',
  currency: 'USD',
  taxesIncluded: false,
  source: 'Committed AWS Pricing API product/rate snapshots; reprice before deployment approval',
  scenarios: reports,
};
const path = process.argv[2];
if (path) writeFileSync(path, JSON.stringify(output, null, 2) + '\n');
console.log(
  JSON.stringify(
    reports.map(({ scenario, pricedSubtotalUSD, unpricedBudgetReserveUSD, planningTotalUSD }) => ({
      scenario,
      pricedSubtotalUSD,
      unpricedBudgetReserveUSD,
      planningTotalUSD,
    })),
    null,
    2,
  ),
);
