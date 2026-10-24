import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { loadEnv } from '../../scripts/env.mjs';
const env = loadEnv();
const fixtures = JSON.parse(readFileSync('.runtime/fixture-logins.json', 'utf8'));
const fixture = fixtures[0];
const login = await fetch('http://127.0.0.1:8081/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: fixture.email, password: fixture.password }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const original = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
function sign(claims) {
  const data =
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify(claims)).toString('base64url');
  return data + '.' + createHmac('sha256', env.MOTOROS_JWT_SECRET).update(data).digest('base64url');
}
const results = [];
async function check(name, port, path, expected, claims = original, body, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method,
    headers: {
      Authorization: 'Bearer ' + sign(claims),
      'Content-Type': 'application/json',
      'X-Correlation-ID': 'review-' + randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await r.json();
  results.push({ name, expected, actual: r.status, pass: r.status === expected });
  assert.ok(!JSON.stringify(content).includes('stackTrace'), 'No stack trace returned');
  assert.ok(r.headers.get('X-Correlation-ID'), 'Correlation ID present');
}
for (const port of [8081, 8082, 8083]) {
  const path =
    port === 8081
      ? 'tenants/current'
      : port === 8082
        ? 'customers'
        : `work-orders?branchId=${fixture.branches[0].id}`;
  const { exp, ...noExpiry } = original;
  await check(`${port}: missing expiry`, port, path, 401, noExpiry);
  const { sub, ...noSubject } = original;
  await check(`${port}: missing subject`, port, path, 401, noSubject);
  const { branches, ...noBranches } = original;
  await check(`${port}: missing branch claims`, port, path, 401, noBranches);
  await check(`${port}: wrong issuer`, port, path, 401, { ...original, iss: 'untrusted' });
  await check(`${port}: malformed tenant`, port, path, 401, { ...original, tenant: 'invalid' });
  await check(`${port}: unknown role`, port, path, 401, { ...original, role: 'ADMIN' });
}
await check('missing branch parameter', 8083, 'work-orders', 400);
await check('unsupported method', 8082, 'customers', 405, original, {}, 'PATCH');
await check('unknown API route', 8082, 'does-not-exist', 404);
await check(
  'overlong UTF-8 password',
  8081,
  'auth/register',
  400,
  original,
  {
    brand: 'UTF8 Review',
    branch: 'North',
    city: 'Chennai',
    email: `utf8-${randomUUID()}@example.test`,
    password: '界'.repeat(30),
  },
  'POST',
);
const current = await fetch(
  `http://127.0.0.1:8083/api/work-orders?branchId=${fixture.branches[0].id}`,
  { headers: { Authorization: 'Bearer ' + token } },
).then((r) => r.json());
const stages = [
  'CREATED',
  'CHECKED_IN',
  'INSPECTION',
  'ESTIMATE_PENDING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'IN_PROGRESS',
  'QUALITY_CHECK',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'CLOSED',
];
const job = current.content.find(
  (j) => stages.indexOf(j.status) >= 0 && stages.indexOf(j.status) < 9,
);
assert.ok(job);
await check(
  'status update requires version',
  8083,
  `work-orders/${job.id}/status`,
  400,
  original,
  { status: stages[stages.indexOf(job.status) + 1], note: 'Missing version must be rejected' },
  'PATCH',
);
// Real simultaneous transactions, rather than only sequential stale-version requests.
async function call(path, body, method = 'POST') {
  const r = await fetch('http://127.0.0.1:8083/api/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
const created = await call('work-orders', {
  branchId: fixture.branches[0].id,
  vehicleId: fixture.vehicleId,
  complaint: 'Review-only concurrency fixture',
});
assert.equal(created.status, 201);
const changes = await Promise.all(
  ['First', 'Second'].map((note) =>
    call(
      `work-orders/${created.data.id}/status`,
      { status: 'CHECKED_IN', version: created.data.version, note },
      'PATCH',
    ),
  ),
);
results.push({
  name: 'concurrent status writes: exactly one commit',
  expected: '200,409',
  actual: changes
    .map((r) => r.status)
    .sort()
    .join(','),
  pass:
    changes
      .map((r) => r.status)
      .sort()
      .join(',') === '200,409',
});
const audit = await call(`work-orders/${created.data.id}/audit`, undefined, 'GET');
results.push({
  name: 'concurrent loser leaves no audit entry',
  expected: 2,
  actual: audit.data.length,
  pass: audit.status === 200 && audit.data.length === 2,
});
const winner = changes.find((r) => r.status === 200);
assert.ok(winner);
const closed = await call(
  `work-orders/${created.data.id}/status`,
  { status: 'CANCELLED', version: winner.data.version, note: 'Review fixture complete' },
  'PATCH',
);
assert.equal(closed.status, 200);
const output = { checks: results.length, passed: results.filter((r) => r.pass).length, results };
writeFileSync('.runtime/review-security-results.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
if (!process.argv.includes('--observe'))
  assert.equal(output.passed, output.checks, 'Review security regression checks');
