import { spawnSync } from 'node:child_process';
import { names } from '../infrastructure/scripts/cloud.mjs';
const base = process.argv[2],
  head = process.argv[3] || 'HEAD';
const paths =
  !base || /^0+$/.test(base)
    ? null
    : spawnSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' });
if (paths && paths.status !== 0) throw new Error('Cannot determine changed services');
const changed = new Set();
if (!paths) names.forEach((n) => changed.add(n));
for (const file of paths?.stdout.split('\n') || []) {
  const service = file.match(/^services\/([^/]+)-service\//)?.[1];
  if (service) changed.add(service);
  if (
    /^packages\/(service-security|service-foundation)\//.test(file) ||
    file === 'pom.xml' ||
    /^infrastructure\/docker\/(service\.Dockerfile|rds-ca\.pem)$/.test(file)
  )
    names.filter((n) => n !== 'api-bff').forEach((n) => changed.add(n));
  if (file.startsWith('packages/object-storage/'))
    ['customer', 'workorder', 'billing'].forEach((n) => changed.add(n));
  if (
    file.startsWith('apps/') ||
    ['package.json', 'package-lock.json', 'infrastructure/docker/frontend.Dockerfile'].includes(
      file,
    ) ||
    /^packages\/api-contracts\/.*\.ts$/.test(file)
  )
    changed.add('api-bff');
}
console.log(
  JSON.stringify({
    include: [...changed].filter((n) => names.includes(n)).map((service) => ({ service })),
  }),
);
