import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const suffix = Date.now(),
  volume = 'motoros-keycloak-permissions-' + suffix,
  container = volume;
const image = 'quay.io/keycloak/keycloak:26.8.1';
function docker(args, options = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (r.status !== 0) throw new Error('Isolated Keycloak operation failed: ' + args[0]);
  return r.stdout.trim();
}
let created = false,
  started = false;
try {
  docker(['volume', 'create', volume]);
  created = true;
  docker(
    [
      'run',
      '--rm',
      '-i',
      '--mount',
      `type=volume,source=${volume},target=/import`,
      'alpine:3.22',
      'sh',
      '-ec',
      'umask 077; cat > /import/motoros-ci-permissions-realm.json; chown 1001:0 /import/motoros-ci-permissions-realm.json; chmod 600 /import/motoros-ci-permissions-realm.json',
    ],
    { input: JSON.stringify({ realm: 'motoros-ci-permissions', enabled: true }) },
  );
  const denied = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      '1000:0',
      '--entrypoint',
      'bash',
      '--mount',
      `type=volume,source=${volume},target=/opt/keycloak/data/import,readonly`,
      image,
      '-c',
      'test -r /opt/keycloak/data/import/motoros-ci-permissions-realm.json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(denied.status, 1, 'A different UID must not read the private import');
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--user',
    '1001:0',
    '--memory',
    '1g',
    '-p',
    '127.0.0.1::8080',
    '--mount',
    `type=volume,source=${volume},target=/opt/keycloak/data/import,readonly`,
    image,
    'start-dev',
    '--import-realm',
  ]);
  started = true;
  const port = Number(docker(['port', container, '8080']).split(':').at(-1));
  let ready = false;
  for (let i = 0; i < 180; i++) {
    if (i % 10 === 0 && docker(['inspect', '--format', '{{.State.Running}}', container]) !== 'true')
      break;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/realms/motoros-ci-permissions/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok) {
        const metadata = await response.json();
        assert.ok(metadata.issuer.endsWith('/realms/motoros-ci-permissions'));
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    mkdirSync('.runtime', { recursive: true });
    const result = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
    writeFileSync(
      '.runtime/keycloak-permissions-diagnostic.log',
      (result.stdout || '') + (result.stderr || ''),
    );
  }
  assert.ok(
    ready,
    'Keycloak must import mode-0600 data and expose OIDC discovery under its matching non-root UID',
  );
  console.log(
    'PASS: private Keycloak import denies UID 1000, imports as UID 1001, and serves real OIDC discovery.',
  );
} finally {
  if (started) docker(['rm', '-f', container]);
  if (created) docker(['volume', 'rm', volume]);
}
