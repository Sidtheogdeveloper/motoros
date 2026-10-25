import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Local frontend container operation failed');
  return r.stdout.trim();
}
const image = process.env.MOTOROS_FRONTEND_IMAGE || 'motoros/api-bff:m7';
const config = JSON.parse(docker(['image', 'inspect', image]))[0].Config;
assert.ok(config.User && config.User !== 'root');
assert.ok(!config.Env.some((v) => /PASSWORD=|CLIENT_SECRET=|ENCRYPTION_KEY=/.test(v)));
mkdirSync('.runtime', { recursive: true });
const results = [];
for (const origin of [
  'https://private-objects.staging.example.test',
  'https://private-objects.production.example.test',
]) {
  const name = 'motoros-m7-bff-' + Date.now();
  try {
    docker([
      'run',
      '-d',
      '--read-only',
      '--user',
      '1000:1000',
      '--memory',
      '896m',
      '--cpus',
      '0.5',
      '--name',
      name,
      '-p',
      '127.0.0.1::3000',
      '-e',
      'MOTOROS_CLOUD=true',
      '-e',
      'MOTOROS_ENVIRONMENT=staging',
      '-e',
      'APP_ORIGIN=https://staging.example.test',
      '-e',
      'S3_UPLOAD_ORIGIN=' + origin,
      image,
    ]);
    const port = Number(docker(['port', name, '3000']).split(':').at(-1));
    let health;
    for (let i = 0; i < 60; i++) {
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (health.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(health?.status, 200);
    const csp = health.headers.get('content-security-policy');
    assert.ok(csp.includes(origin));
    assert.ok(!csp.includes('127.0.0.1:8333'));
    assert.match(health.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.match(health.headers.get('x-correlation-id'), /^[a-f0-9-]{36}$/);
    for (const path of [
      '/api/backend/notification/platform/messaging/health',
      '/api/backend/booking/automation/event-proof/test',
      '/api/backend/tenant/internal/authorize',
      '/actuator/health',
    ]) {
      const denied = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(denied.status, 404);
    }
    await fetch(`http://127.0.0.1:${port}/health?code=synthetic-sensitive-callback-code`);
    const logs = docker(['logs', name]);
    assert.ok(!logs.includes('synthetic-sensitive-callback-code'));
    assert.ok(logs.includes('request_received'));
    results.push({
      origin,
      health: true,
      runtimeCsp: true,
      privateDiagnosticsDenied: true,
      redactedLogs: true,
      readOnly: true,
      applicationMemoryMiB: 896,
    });
  } finally {
    docker(['rm', '-f', name]);
  }
}
writeFileSync(
  '.runtime/m7-frontend-container-results.json',
  JSON.stringify({ image, results }, null, 2),
);
console.log(
  'Frontend image passed two runtime origins, read-only/non-root health, CSP, private-route denial and log redaction checks.',
);
