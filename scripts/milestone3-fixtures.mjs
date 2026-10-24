import { completeDevelopmentJob } from '../tests/helpers/workshop.mjs';
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createIdentity, signIn, select, call, invitationMail } from '../tests/helpers/oidc.mjs';
if (process.env.MOTOROS_DEV_FIXTURES !== '1')
  throw new Error('Explicit development fixture flag required');
if (existsSync('.runtime/m3-fixtures.json')) {
  console.log('Existing Milestone 3 fixtures retained.');
  process.exit(0);
}
const browser = await chromium.launch();
const contexts = [];
async function actor(identity) {
  const context = await browser.newContext();
  contexts.push(context);
  await signIn(await context.newPage(), identity);
  return context;
}
async function json(r) {
  if (!r.ok())
    throw new Error('M3 fixture API failed: ' + r.status() + ' ' + (await r.json()).title);
  return r.json();
}
try {
  const owner = await createIdentity('m3-apex-owner'),
    precisionOwner = await createIdentity('m3-precision-owner');
  const apex = await actor(owner),
    precision = await actor(precisionOwner);
  const a = await json(
    await call(apex, 'tenant/tenants', {
      method: 'POST',
      data: {
        name: 'Apex Motorworks [M3 fixture]',
        businessEmail: owner.email,
        primaryBranch: { name: 'Anna Nagar', branchCode: 'ANNA', city: 'Chennai' },
      },
    }),
  );
  const tenant = a.tenant.id;
  await select(apex, tenant);
  const velachery = await json(
    await call(apex, 'tenant/branches', {
      method: 'POST',
      tenant,
      data: { name: 'Velachery', branchCode: 'VEL', city: 'Chennai' },
    }),
  );
  const omr = await json(
    await call(apex, 'tenant/branches', {
      method: 'POST',
      tenant,
      data: { name: 'OMR', branchCode: 'OMR', city: 'Chennai' },
    }),
  );
  const b = await json(
    await call(precision, 'tenant/tenants', {
      method: 'POST',
      data: {
        name: 'Precision Auto Care [M3 fixture]',
        businessEmail: precisionOwner.email,
        primaryBranch: { name: 'Precision Central', branchCode: 'PRECISION', city: 'Chennai' },
      },
    }),
  );
  await select(precision, b.tenant.id);
  const customer = await json(
    await call(apex, 'customer/customers', {
      method: 'POST',
      tenant,
      data: {
        name: 'Arun Raj [M3 fixture]',
        email: 'arun-' + Date.now() + '@example.test',
        phone: '',
        city: 'Chennai',
        country: 'India',
      },
    }),
  );
  const vehicle = await json(
    await call(apex, 'customer/vehicles', {
      method: 'POST',
      tenant,
      data: {
        customerId: customer.id,
        registration: 'TN-01-M3-' + Date.now().toString().slice(-7),
        vin: '1HGCM82633A004352',
        make: 'Honda',
        model: 'City',
        year: 2021,
        branchId: a.branch.id,
      },
    }),
  );
  let order = await json(
    await call(apex, 'workorder/work-orders', {
      method: 'POST',
      tenant,
      data: {
        vehicleId: vehicle.id,
        branchId: a.branch.id,
        complaint: 'Anna Nagar completed brake inspection [M3 fixture]',
      },
    }),
  );
  order = await completeDevelopmentJob(apex, tenant, order);
  const bytes = Buffer.from('%PDF-1.7\nSynthetic M3 service attachment\n%%EOF');
  const upload = await json(
    await call(apex, `customer/vehicles/${vehicle.id}/documents/uploads`, {
      method: 'POST',
      tenant,
      data: {
        fileName: 'service-record.pdf',
        contentType: 'application/pdf',
        byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        branchId: a.branch.id,
        visibility: 'TECHNICAL',
      },
    }),
  );
  const stored = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
  if (!stored.ok) throw new Error('Fixture upload failed: ' + stored.status);
  const document = await json(
    await call(apex, `customer/documents/${upload.documentId}/complete`, {
      method: 'POST',
      tenant,
      data: { version: 0 },
    }),
  );
  async function employee(context, tenant, branch, prefix) {
    const identity = await createIdentity(prefix);
    await json(
      await call(context, `tenant/tenants/${tenant}/invitations`, {
        method: 'POST',
        tenant,
        data: { email: identity.email, role: 'MECHANIC', branchIds: [branch] },
      }),
    );
    const delivered = await invitationMail(identity.email);
    const staff = await actor(identity);
    await json(
      await call(staff, 'tenant/invitations/accept', {
        method: 'POST',
        data: { token: delivered.token },
      }),
    );
    return identity;
  }
  const employeeA = await employee(apex, tenant, velachery.id, 'm3-velachery'),
    employeeB = await employee(precision, b.tenant.id, b.branch.id, 'm3-precision-staff');
  writeFileSync(
    '.runtime/m3-fixtures.json',
    JSON.stringify(
      {
        owner,
        precisionOwner,
        employeeA,
        employeeB,
        tenant,
        precisionTenant: b.tenant.id,
        anna: a.branch,
        velachery,
        omr,
        precisionBranch: b.branch,
        customer,
        vehicle,
        order,
        document,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    'Created Apex (Anna Nagar, Velachery, OMR) and Precision fixtures, completed service, private document and invited employees. Credentials remain in ignored .runtime/m3-fixtures.json.',
  );
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
}
