import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../../scripts/env.mjs';
const env = { ...process.env, ...loadEnv() };
const suffix = Date.now();
const created = [];
const ports = {};
const network = process.env.MOTOROS_DOCKER_NETWORK || 'motoros_default';
function docker(args, childEnv = env) {
  const r = spawnSync('docker', args, { env: childEnv, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'Docker command failed');
  return r.stdout.trim();
}
const names = Object.fromEntries(
  ['tenant', 'customer', 'workorder'].map((s) => [s, `motoros-review-${s}-${suffix}`]),
);
try {
  for (const service of ['tenant', 'customer', 'workorder']) {
    const image = `motoros/${service}:milestone1-review`;
    const config = JSON.parse(docker(['image', 'inspect', image]))[0].Config;
    assert.equal(config.User, 'motoros');
    assert.ok(config.Env.includes('PORT=8080'));
    assert.ok(
      !config.Env.some(
        (value) =>
          value.startsWith('DATABASE_PASSWORD=') || value.startsWith('MOTOROS_JWT_SECRET='),
      ),
    );
    const childEnv = {
      ...env,
      DATABASE_USER: service + '_app',
      DATABASE_PASSWORD: env[service.toUpperCase() + '_PASSWORD'],
      MOTOROS_LOCAL_AUTH: service === 'tenant' ? 'true' : 'false',
    };
    docker(
      [
        'run',
        '-d',
        '--name',
        names[service],
        '--network',
        network,
        '-p',
        '127.0.0.1::8080',
        '-e',
        'DATABASE_USER',
        '-e',
        'DATABASE_PASSWORD',
        '-e',
        'MOTOROS_JWT_SECRET',
        '-e',
        'MOTOROS_LOCAL_AUTH',
        '-e',
        'DATABASE_URL=jdbc:postgresql://postgres:5432/motoros',
        '-e',
        `CUSTOMER_URL=http://${names.customer}:8080`,
        image,
      ],
      childEnv,
    );
    created.push(names[service]);
    ports[service] = Number(docker(['port', names[service], '8080']).split(':').at(-1));
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const r = await fetch(`http://127.0.0.1:${ports[service]}/actuator/health`, {
          signal: AbortSignal.timeout(2500),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(ready, service + ' container health');
  }
  const fixture = JSON.parse(readFileSync('.runtime/fixture-logins.json', 'utf8'))[0];
  const login = await fetch(`http://127.0.0.1:${ports.tenant}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const customers = await fetch(`http://127.0.0.1:${ports.customer}/api/customers`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(customers.status, 200);
  const history = await fetch(
    `http://127.0.0.1:${ports.workorder}/api/vehicles/${fixture.vehicleId}/history?branchId=${fixture.branches[1].id}`,
    { headers: { Authorization: 'Bearer ' + token } },
  );
  assert.equal(history.status, 200);
  assert.equal((await history.json()).length, 1);
  writeFileSync(
    '.runtime/review-container-results.json',
    JSON.stringify(
      {
        nonRootImages: 3,
        healthEndpoints: 3,
        login: true,
        customers: true,
        crossBranchHistoryThroughContainerNetwork: true,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: three non-root images, advertised port 8080, service health and real container-to-container history.',
  );
} finally {
  for (const name of created.reverse()) docker(['rm', '-f', name]);
}
