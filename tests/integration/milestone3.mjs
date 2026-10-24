import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { signIn, select, call } from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
const results = [];
const browser = await chromium.launch();
const contexts = [];
function check(name, actual, expected) {
  results.push({ name, actual, expected, pass: actual === expected });
  assert.equal(actual, expected, name);
}
async function actor(identity, tenant) {
  const c = await browser.newContext();
  contexts.push(c);
  await signIn(await c.newPage(), identity);
  await select(c, tenant);
  return c;
}
async function request(
  context,
  path,
  status,
  name,
  { method = 'GET', data, tenant = f.tenant } = {},
) {
  const r = await call(context, 'customer/' + path, { method, data, tenant });
  check(name, r.status(), status);
  return r.json();
}
async function upload(
  context,
  vehicle,
  visibility = 'TECHNICAL',
  body = Buffer.from('%PDF-1.7\nSynthetic M3 integration document\n%%EOF'),
) {
  const grant = await request(
    context,
    `vehicles/${vehicle}/documents/uploads`,
    201,
    'authorized document upload grant',
    {
      method: 'POST',
      data: {
        fileName: 'inspection.pdf',
        contentType: 'application/pdf',
        byteSize: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        branchId: f.anna.id,
        visibility,
      },
    },
  );
  const response = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body });
  check('signed upload accepted', response.status, 200);
  return { grant, body };
}
try {
  const owner = await actor(f.owner, f.tenant),
    employee = await actor(f.employeeA, f.tenant),
    foreign = await actor(f.employeeB, f.precisionTenant);
  const suffix = randomBytes(4).toString('hex');
  const found = await request(
    employee,
    'vehicles?q=' + encodeURIComponent(f.vehicle.registration),
    200,
    'Velachery employee finds shared Anna Nagar vehicle',
  );
  check(
    'shared vehicle search includes mandatory fixture',
    found.content.some((v) => v.id === f.vehicle.id),
    true,
  );
  check(
    'mechanic vehicle search redacts owner identifiers',
    found.content.every((v) => !Object.hasOwn(v, 'customerId')),
    true,
  );
  const detail = await request(
    employee,
    'vehicles/' + f.vehicle.id,
    200,
    'authorized vehicle detail',
  );
  check('vehicle profile redacts customer identity', Object.hasOwn(detail, 'customerId'), false);
  await request(
    employee,
    'customers/' + f.customer.id,
    403,
    'mechanic cannot read customer-sensitive profile',
  );
  await request(
    employee,
    'vehicles/' + f.vehicle.id + '/ownership',
    403,
    'mechanic cannot read ownership relationships',
  );
  const history = await request(
    employee,
    `vehicles/${f.vehicle.id}/timeline?branchId=${f.velachery.id}&size=1`,
    200,
    'authorized cross-branch timeline through authenticated services',
  );
  check(
    'Anna Nagar service visible from Velachery',
    history.content.some((e) => e.branchId === f.anna.id && e.id === f.order.id),
    true,
  );
  check(
    'timeline includes structured Work Order source reference',
    history.content[0].source.service,
    'workorder',
  );
  check('timeline is paginated', history.content.length, 1);
  await request(
    employee,
    `vehicles/${f.vehicle.id}/timeline?branchId=${f.anna.id}`,
    403,
    'invalid acting branch denied',
  );
  for (const path of [
    'vehicles/' + f.vehicle.id,
    `vehicles/${f.vehicle.id}/documents`,
    `vehicles/${f.vehicle.id}/timeline?branchId=${f.precisionBranch.id}`,
  ])
    await request(foreign, path, 404, 'Precision cannot access ' + path.split('?')[0], {
      tenant: f.precisionTenant,
    });
  await request(
    foreign,
    'documents/' + f.document.id + '/download',
    404,
    'Precision cannot obtain document URL',
    { method: 'POST', tenant: f.precisionTenant, data: {} },
  );
  const foreignSearch = await request(
    foreign,
    'vehicles?q=' + encodeURIComponent(f.vehicle.registration),
    200,
    'Precision search remains tenant scoped',
    { tenant: f.precisionTenant },
  );
  check('foreign vehicle absent from searches', foreignSearch.totalElements, 0);
  const customer = await request(owner, 'customers', 201, 'create customer contact registry', {
    method: 'POST',
    data: {
      name: 'M3 Integration ' + suffix,
      email: suffix + '@example.test',
      phone: '',
      city: 'Chennai',
    },
  });
  await request(owner, 'customers', 409, 'normalized duplicate email denied', {
    method: 'POST',
    data: { name: 'Duplicate person', email: suffix.toUpperCase() + '@EXAMPLE.TEST' },
  });
  const candidates = await request(
    owner,
    'customers/duplicates?email=' + suffix + '@example.test',
    200,
    'explicit duplicate candidate lookup',
  );
  check('duplicate candidate identifies existing record', candidates[0].id, customer.id);
  await request(owner, 'customers', 201, 'reviewed shared contact creates separate person', {
    method: 'POST',
    data: {
      name: 'Reviewed family ' + suffix,
      email: suffix + '@example.test',
      duplicateReason: 'Two distinct people with reviewed family contact',
    },
  });
  const page = await request(
    owner,
    'customers?q=' + suffix + '&size=1',
    200,
    'customer directory pagination and search',
  );
  check('pagination keeps total count', page.totalElements, 2);
  check('pagination bounds content', page.content.length, 1);
  const normalized = f.vehicle.registration.replaceAll('-', ' ').toLowerCase();
  await request(owner, 'vehicles', 409, 'normalized duplicate registration denied', {
    method: 'POST',
    data: { customerId: customer.id, registration: normalized, make: 'Honda', model: 'City' },
  });
  await request(owner, 'vehicles', 409, 'duplicate VIN denied', {
    method: 'POST',
    data: {
      customerId: customer.id,
      registration: 'VIN-' + suffix,
      vin: f.vehicle.vin,
      make: 'Honda',
      model: 'City',
    },
  });
  const before = await request(
    owner,
    'vehicles/' + f.vehicle.id,
    200,
    'read current vehicle version',
  );
  await request(
    owner,
    'vehicles/' + f.vehicle.id + '/ownership',
    200,
    'ownership transfer commits with history',
    {
      method: 'POST',
      data: {
        customerId: customer.id,
        version: before.version,
        branchId: f.anna.id,
        reason: 'Synthetic customer sale reviewed',
      },
    },
  );
  await request(
    owner,
    'vehicles/' + f.vehicle.id + '/ownership',
    409,
    'stale ownership version rejected',
    {
      method: 'POST',
      data: {
        customerId: f.customer.id,
        version: before.version,
        branchId: f.anna.id,
        reason: 'Stale transfer must fail',
      },
    },
  );
  const ownership = await request(
    owner,
    'vehicles/' + f.vehicle.id + '/ownership?size=100',
    200,
    'historical ownership retrieval',
  );
  check(
    'old owner relationship retained',
    ownership.content.some((h) => h.customerId === before.customerId && h.endedAt),
    true,
  );
  check('exactly one current owner', ownership.content.filter((h) => !h.endedAt).length, 1);
  const postTransferHistory = await request(
    employee,
    `vehicles/${f.vehicle.id}/timeline?branchId=${f.velachery.id}`,
    200,
    'transfer retains vehicle service history',
  );
  check(
    'service remains attached to same vehicle',
    postTransferHistory.content.some((e) => e.id === f.order.id),
    true,
  );
  const readings = await request(
    employee,
    'vehicles/' + f.vehicle.id + '/odometer',
    200,
    'read odometer history',
  );
  const km = (readings.content[0]?.kilometers || 10000) + 100;
  await request(
    employee,
    'vehicles/' + f.vehicle.id + '/odometer',
    201,
    'mechanic records odometer in assigned branch',
    {
      method: 'POST',
      data: { kilometers: km, branchId: f.velachery.id, note: 'Synthetic intake' },
    },
  );
  await request(
    employee,
    'vehicles/' + f.vehicle.id + '/odometer',
    409,
    'decreasing odometer denied',
    { method: 'POST', data: { kilometers: km - 1, branchId: f.velachery.id } },
  );
  await request(
    employee,
    'vehicles/' + f.vehicle.id + '/odometer',
    403,
    'odometer invalid branch denied',
    { method: 'POST', data: { kilometers: km + 1, branchId: f.anna.id } },
  );
  const uploaded = await upload(owner, f.vehicle.id);
  const published = await request(
    owner,
    'documents/' + uploaded.grant.documentId + '/complete',
    200,
    'backend validates checksum size and magic bytes',
    { method: 'POST', data: { version: 0 } },
  );
  check('document metadata hides storage key', Object.hasOwn(published, 'objectKey'), false);
  const grant = await request(
    employee,
    'documents/' + published.id + '/download',
    200,
    'authorized technical document download',
    { method: 'POST', data: {} },
  );
  check('download grant expires quickly', grant.expiresIn, 60);
  const content = await fetch(grant.url);
  check('signed private download works', content.status, 200);
  check(
    'download bytes match upload',
    Buffer.from(await content.arrayBuffer()).equals(uploaded.body),
    true,
  );
  const unsigned = new URL(grant.url);
  unsigned.search = '';
  check('anonymous raw object access denied', (await fetch(unsigned)).status, 403);
  const tampered = new URL(grant.url);
  tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64));
  check('tampered download signature denied', (await fetch(tampered)).status, 403);
  const overwrite = await fetch(uploaded.grant.url, {
    method: 'PUT',
    headers: uploaded.grant.headers,
    body: uploaded.body,
  });
  check('upload grant replay is confined to staging object', overwrite.ok, true);
  const unchanged = await fetch(grant.url);
  check(
    'published object unaffected by upload replay',
    Buffer.from(await unchanged.arrayBuffer()).equals(uploaded.body),
    true,
  );
  await request(
    foreign,
    'documents/' + published.id + '/download',
    404,
    'cross-tenant document ID manipulation denied',
    { method: 'POST', data: {}, tenant: f.precisionTenant },
  );
  const privateUpload = await upload(owner, f.vehicle.id, 'CUSTOMER_PRIVATE');
  const privateDoc = await request(
    owner,
    'documents/' + privateUpload.grant.documentId + '/complete',
    200,
    'publish customer private document',
    { method: 'POST', data: { version: 0 } },
  );
  await request(
    employee,
    'documents/' + privateDoc.id + '/download',
    403,
    'mechanic cannot download private owner document',
    { method: 'POST', data: {} },
  );
  const visible = await request(
    employee,
    'vehicles/' + f.vehicle.id + '/documents',
    200,
    'document list filters sensitive objects',
  );
  check(
    'private document absent from mechanic list',
    visible.content.every((d) => d.visibility === 'TECHNICAL'),
    true,
  );
  await request(
    owner,
    `vehicles/${f.vehicle.id}/documents/uploads`,
    400,
    'unsupported executable upload rejected',
    {
      method: 'POST',
      data: {
        fileName: 'bad.exe',
        contentType: 'application/octet-stream',
        byteSize: 4,
        sha256: '0'.repeat(64),
        branchId: f.anna.id,
        visibility: 'TECHNICAL',
      },
    },
  );
  const bad = await upload(owner, f.vehicle.id, 'TECHNICAL', Buffer.from('not a PDF'));
  await request(
    owner,
    'documents/' + bad.grant.documentId + '/complete',
    400,
    'declared PDF with wrong magic rejected',
    { method: 'POST', data: { version: 0 } },
  );
  await request(
    owner,
    'documents/' + bad.grant.documentId + '/download',
    404,
    'unvalidated upload cannot be downloaded',
    { method: 'POST', data: {} },
  );
  await request(
    owner,
    'documents/' + published.id + '/archive',
    200,
    'archive revokes new grants',
    { method: 'POST', data: { version: published.version } },
  );
  await request(
    owner,
    'documents/' + published.id + '/download',
    404,
    'archived document cannot get fresh URL',
    { method: 'POST', data: {} },
  );
  await request(owner, 'customers/' + customer.id, 200, 'customer profile versioned edit', {
    method: 'PATCH',
    data: { name: 'Updated M3 ' + suffix, email: customer.email, version: customer.version },
  });
  await request(owner, 'customers/' + customer.id, 409, 'stale customer edit denied', {
    method: 'PATCH',
    data: { name: 'Stale overwrite', email: customer.email, version: customer.version },
  });
  const currentVehicle = await request(
    owner,
    'vehicles/' + f.vehicle.id,
    200,
    'read vehicle for versioned edit',
  );
  const edit = {
    customerId: currentVehicle.customerId,
    registration: currentVehicle.registration,
    make: currentVehicle.make,
    model: currentVehicle.model,
    vin: currentVehicle.vin,
    year: currentVehicle.year,
    status: currentVehicle.status,
    color: 'Graphite',
    version: currentVehicle.version,
  };
  await request(
    owner,
    'vehicles/' + f.vehicle.id,
    403,
    'vehicle edit cannot claim foreign branch',
    { method: 'PATCH', data: { ...edit, branchId: f.precisionBranch.id } },
  );
  await request(owner, 'vehicles/' + f.vehicle.id, 200, 'authorized vehicle profile edit', {
    method: 'PATCH',
    data: { ...edit, branchId: f.anna.id },
  });
  await request(owner, 'vehicles/' + f.vehicle.id, 409, 'stale vehicle profile edit denied', {
    method: 'PATCH',
    data: { ...edit, branchId: f.anna.id },
  });
  await request(
    employee,
    'vehicles/' + f.vehicle.id + '/odometer',
    400,
    'odometer requires a supplied reading',
    { method: 'POST', data: { branchId: f.velachery.id } },
  );
  const audit = await request(
    owner,
    'vehicles/' + f.vehicle.id + '/audit',
    200,
    'registry activity endpoint',
  );
  check(
    'registry audit retains actor tenant and correlation',
    audit.content.some((e) => e.actorId && e.tenantId === f.tenant && e.correlationId),
    true,
  );
  const inactive = await request(
    owner,
    'vehicles',
    201,
    'register inactive vehicle without deleting history',
    {
      method: 'POST',
      data: {
        customerId: customer.id,
        registration: 'INACTIVE-' + suffix,
        make: 'Honda',
        model: 'City',
        status: 'INACTIVE',
        branchId: f.anna.id,
      },
    },
  );
  const intake = await call(owner, 'workorder/work-orders', {
    method: 'POST',
    tenant: f.tenant,
    data: { branchId: f.anna.id, vehicleId: inactive.id, complaint: 'Inactive intake must fail' },
  });
  check('inactive vehicle denies new work-order intake', intake.status(), 409);
  await request(
    owner,
    `vehicles/${inactive.id}/timeline?branchId=${f.anna.id}`,
    200,
    'inactive vehicle keeps readable service history',
  );
  const contact = await request(
    owner,
    `customers/${customer.id}/contacts`,
    201,
    'additional customer contact persists',
    {
      method: 'POST',
      data: { kind: 'EMAIL', label: 'Alternate', value: 'alternate-' + suffix + '@example.test' },
    },
  );
  await request(
    owner,
    `customers/${customer.id}/contacts/${contact.id}/deactivate`,
    200,
    'contact deactivation is versioned',
    { method: 'POST', data: { version: contact.version } },
  );
  const activeContacts = await request(
    owner,
    `customers/${customer.id}/contacts`,
    200,
    'contact listing excludes inactive entries',
  );
  check(
    'deactivated contact absent from active list',
    activeContacts.some((c) => c.id === contact.id),
    false,
  );
  await request(
    owner,
    `customers/${customer.id}/contacts/${contact.id}/deactivate`,
    409,
    'stale contact deactivation rejected',
    { method: 'POST', data: { version: contact.version } },
  );
  const customerBytes = Buffer.from('%PDF-1.7\nSynthetic customer-only attachment\n%%EOF');
  const customerUpload = await request(
    owner,
    `customers/${customer.id}/documents/uploads`,
    201,
    'customer document upload grant',
    {
      method: 'POST',
      data: {
        fileName: 'customer-record.pdf',
        contentType: 'application/pdf',
        byteSize: customerBytes.length,
        sha256: createHash('sha256').update(customerBytes).digest('hex'),
        branchId: f.anna.id,
        visibility: 'TECHNICAL',
      },
    },
  );
  check(
    'customer file signed upload accepted',
    (
      await fetch(customerUpload.url, {
        method: 'PUT',
        headers: customerUpload.headers,
        body: customerBytes,
      })
    ).status,
    200,
  );
  const customerDocument = await request(
    owner,
    'documents/' + customerUpload.documentId + '/complete',
    200,
    'customer document publication',
    { method: 'POST', data: { version: 0 } },
  );
  check(
    'customer target always forces private classification',
    customerDocument.visibility,
    'CUSTOMER_PRIVATE',
  );
  const customerDocs = await request(
    owner,
    `customers/${customer.id}/documents`,
    200,
    'customer document listing',
  );
  check(
    'customer document is attached to correct owner record',
    customerDocs.content.some((d) => d.id === customerDocument.id && d.customerId === customer.id),
    true,
  );
  await request(
    employee,
    'documents/' + customerDocument.id + '/download',
    403,
    'mechanic cannot fetch customer-targeted document',
    { method: 'POST', data: {} },
  );
  await request(
    owner,
    'documents/' + customerDocument.id + '/archive',
    200,
    'customer document archival',
    { method: 'POST', data: { version: customerDocument.version } },
  );
  writeFileSync(
    '.runtime/m3-api-results.json',
    JSON.stringify({ checks: results.length, passed: true, results }, null, 2),
  );
  console.log(
    'PASS: ' +
      results.length +
      ' Milestone 3 live registry, transfer, cross-branch history, private-storage and tenant-isolation checks.',
  );
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
}
