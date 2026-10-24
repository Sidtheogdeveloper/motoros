import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
// Explicit synthetic development fixtures; never sends customer communications.
const endpoint = {
  tenant: 'http://127.0.0.1:8081',
  customer: 'http://127.0.0.1:8082',
  workorder: 'http://127.0.0.1:8083',
};
async function req(service, path, data, token, method = 'POST') {
  const r = await fetch(endpoint[service] + '/api/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(value));
  return value;
}
const logins = [];
for (const [brand, places, name, make, model, reg] of [
  ['Apex Motorworks', ['Anna Nagar', 'OMR'], 'Arun (fixture)', 'Hyundai', 'i20', 'FIXTURE-APEX'],
  [
    'Torque Collective',
    ['Velachery', 'Adyar'],
    'Meena (fixture)',
    'Honda',
    'City',
    'FIXTURE-TORQUE',
  ],
]) {
  const suffix = Date.now().toString(36);
  const email = brand.startsWith('Apex')
    ? `apex-${suffix}@example.test`
    : `torque-${suffix}@example.test`;
  const password = randomBytes(18).toString('base64url');
  await req('tenant', 'auth/register', {
    brand: brand + ' [fixture]',
    branch: places[0],
    city: 'Chennai',
    email,
    password,
  });
  let { token } = await req('tenant', 'auth/login', { email, password });
  await req('tenant', 'branches', { name: places[1], city: 'Chennai' }, token);
  ({ token } = await req('tenant', 'auth/login', { email, password }));
  const branches = await req('tenant', 'branches', null, token, 'GET');
  const customer = await req(
    'customer',
    'customers',
    { name, email: 'fixture@example.test', phone: '' },
    token,
  );
  const vehicle = await req(
    'customer',
    'vehicles',
    { customerId: customer.id, registration: reg, make, model },
    token,
  );
  let order = await req(
    'workorder',
    'work-orders',
    {
      branchId: branches[0].id,
      vehicleId: vehicle.id,
      complaint: 'Scheduled maintenance — synthetic development fixture',
    },
    token,
  );
  for (const status of [
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
  ])
    order = await req(
      'workorder',
      `work-orders/${order.id}/status`,
      { status, version: order.version, note: 'Synthetic fixture lifecycle' },
      token,
      'PATCH',
    );
  await req(
    'workorder',
    'work-orders',
    {
      branchId: branches[0].id,
      vehicleId: vehicle.id,
      complaint: 'Investigate steering vibration — synthetic fixture',
    },
    token,
  );
  logins.push({ brand, email, password, vehicleId: vehicle.id, branches });
}
mkdirSync('.runtime', { recursive: true });
writeFileSync('.runtime/fixture-logins.json', JSON.stringify(logins, null, 2), { mode: 0o600 });
console.log(
  'Created two isolated synthetic brands and four branches. Login details are in ignored .runtime/fixture-logins.json.',
);
