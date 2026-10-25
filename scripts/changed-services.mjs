import { spawnSync } from 'node:child_process';
import { names } from '../infrastructure/scripts/cloud.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function affectedServices(files) {
  const changed = new Set();
  for (const file of files) {
    if (
      [
        'infrastructure/trivy.yaml',
        'scripts/check-vex.mjs',
        'docs/deployment/motoros.openvex.json',
        '.github/workflows/platform-ci.yml',
      ].includes(file)
    )
      names.forEach((n) => changed.add(n));
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
  return [...changed].filter((n) => names.includes(n));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2],
    head = process.argv[3] || 'HEAD';
  let services = names;
  if (base && !/^0+$/.test(base)) {
    const diff = spawnSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' });
    if (diff.status !== 0) throw new Error('Cannot determine changed services');
    services = affectedServices(diff.stdout.split('\n'));
  }
  console.log(JSON.stringify({ include: services.map((service) => ({ service })) }));
}
