import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
const fixtures = JSON.parse(readFileSync('.runtime/fixture-logins.json', 'utf8'));
async function request(port, path, token, body, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
const tokens = [];
for (const f of fixtures) {
  const r = await request(
    8081,
    'auth/login',
    null,
    { email: f.email, password: f.password },
    'POST',
  );
  assert.equal(r.status, 200);
  tokens.push(r.data.token);
}
const [a, b] = fixtures;
let r = await request(8082, 'vehicles/' + a.vehicleId, tokens[1]);
assert.equal(r.status, 404, 'Other tenant cannot read vehicle');
r = await request(8083, `vehicles/${a.vehicleId}/history?branchId=${b.branches[0].id}`, tokens[1]);
assert.equal(r.status, 404, 'Other tenant cannot read history');
r = await request(8083, `vehicles/${a.vehicleId}/history?branchId=${a.branches[1].id}`, tokens[0]);
assert.equal(r.status, 200);
assert.equal(r.data.length, 1);
assert.equal(
  r.data[0].branchId,
  a.branches[0].id,
  'Same brand can see completed history from another branch',
);
const completed = r.data[0];
r = await request(
  8083,
  `work-orders/${completed.id}/status`,
  tokens[0],
  { status: 'CREATED', version: completed.version, note: 'Invalid test transition' },
  'PATCH',
);
assert.equal(r.status, 409);
r = await request(8083, `work-orders?branchId=${b.branches[0].id}`, tokens[0]);
assert.equal(r.status, 403, 'Cannot select another tenant branch');
r = await request(8082, 'vehicles/' + a.vehicleId, null);
assert.equal(r.status, 401);
// Forge a token without the signing secret: the real security filter must reject it.
const encoded = JSON.parse(Buffer.from(tokens[0].split('.')[1], 'base64url').toString());
encoded.tenant = b.branches[0].id;
const forged =
  tokens[0].split('.')[0] +
  '.' +
  Buffer.from(JSON.stringify(encoded)).toString('base64url') +
  '.' +
  tokens[0].split('.')[2];
r = await request(8082, 'vehicles', forged);
assert.equal(r.status, 401, 'Tampered JWT rejected');
// Test signed role/branch restrictions with the local test harness; never exposed in the UI.
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const original = JSON.parse(Buffer.from(tokens[0].split('.')[1], 'base64url').toString());
function signed(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return (
    header +
    '.' +
    payload +
    '.' +
    createHmac('sha256', env.MOTOROS_JWT_SECRET)
      .update(header + '.' + payload)
      .digest('base64url')
  );
}
const mechanic = signed({ ...original, role: 'MECHANIC', branches: [a.branches[1].id] });
r = await request(8083, `vehicles/${a.vehicleId}/history?branchId=${a.branches[1].id}`, mechanic);
assert.equal(r.status, 200, 'Mechanic in another authorized branch can read shared history');
r = await request(8083, `work-orders?branchId=${a.branches[0].id}`, mechanic);
assert.equal(r.status, 403, 'Mechanic cannot access branch operations outside assignment');
r = await request(8082, 'customers', mechanic, { name: 'Forbidden' }, 'POST');
assert.equal(r.status, 403, 'Mechanic cannot create customer');
const expired = signed({ ...original, exp: Math.floor(Date.now() / 1000) - 120 });
r = await request(8082, 'vehicles', expired);
assert.equal(r.status, 401, 'Expired JWT rejected');
const wrongAudience = signed({ ...original, aud: ['another-api'] });
r = await request(8082, 'vehicles', wrongAudience);
assert.equal(r.status, 401, 'Wrong audience rejected');
const customer = signed({ ...original, role: 'CUSTOMER' });
r = await request(8082, 'vehicles', customer);
assert.equal(r.status, 403, 'Customer cannot access staff list');
console.log(
  'PASS: 13 real HTTP security, isolation, role, lifecycle and cross-branch history checks.',
);
