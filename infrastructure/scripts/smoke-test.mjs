import { config, run, aws, deployment, save, manifest } from './cloud.mjs';
const [configPath, deploymentPath, releasePath] = process.argv.slice(2),
  c = config(configPath),
  d = deployment(deploymentPath),
  m = manifest(releasePath, c);
if (process.env.MOTOROS_CLOUD_SMOKE !== 'true')
  throw new Error('Explicit cloud smoke execution required');

if (
  !/^\{\{resolve:secretsmanager:[^}]+\}\}$/.test(process.env.MOTOROS_SMOKE_SECRET_REFERENCE || '')
)
  throw new Error('A private synthetic-account fixture reference is required');
run('asm-exec', ['--', process.execPath, 'infrastructure/scripts/smoke-browser.mjs'], {
  env: {
    ...process.env,
    MOTOROS_SMOKE_CONTEXT: process.env.MOTOROS_SMOKE_SECRET_REFERENCE,
    MOTOROS_SMOKE_ORIGIN: c.app_origin,
    MOTOROS_SMOKE_READ_ONLY: c.environment === 'production' ? 'true' : 'false',
  },
  stdio: 'inherit',
});
const live = aws(
  'ecs',
  'describe-services',
  { cluster: d.cluster, services: Object.values(d.services) },
  c,
);
if (
  live.failures?.length ||
  live.services.some(
    (s) =>
      s.runningCount < s.desiredCount || s.deployments.some((x) => x.rolloutState !== 'COMPLETED'),
  )
)
  throw new Error('Service fleet is not healthy');
const groups = aws(
  'logs',
  'describe-log-groups',
  { logGroupNamePrefix: `/motoros/${c.environment}/` },
  c,
);
for (const n of Object.keys(d.services)) {
  const group = groups.logGroups.find((g) => g.logGroupName === `/motoros/${c.environment}/${n}`);
  if (!group) throw new Error('Missing service log group');
  const streams = aws(
    'logs',
    'describe-log-streams',
    { logGroupName: group.logGroupName, orderBy: 'LastEventTime', descending: true, limit: 1 },
    c,
  );
  if (!streams.logStreams?.length) throw new Error('No service logs observed');
}
if (c.environment === 'staging') m.stagingSmokePassed = true;
else m.productionReadOnlySmokePassed = true;
m.verifiedAt = new Date().toISOString();
save(releasePath, m);
console.log('AWS staging smoke and fleet/log verification passed.');
