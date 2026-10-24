import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { randomUUID, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnv } from '../../scripts/env.mjs';
import {
  fixtures,
  origin,
  createIdentity,
  signIn,
  select,
  call,
  invitationMail,
  sessionData,
  machineToken,
} from '../helpers/oidc.mjs';
const results = [];
const env = loadEnv();
const browser = await chromium.launch({ headless: true });
const contexts = [];
const database = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  database: 'motoros',
  user: 'postgres',
  password: env.POSTGRES_PASSWORD,
});
await database.connect();
function check(name, actual, expected) {
  results.push({ name, actual, expected, pass: actual === expected });
  assert.equal(actual, expected, name);
}
async function actor(identity) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, identity);
  return { context, page, ...identity };
}
async function json(response, status, name) {
  check(name, response.status(), status);
  return response.json();
}
async function direct(port, path, token, tenant, extra = {}) {
  return fetch(`http://127.0.0.1:${port}/api/${path}`, {
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(tenant ? { 'X-MotorOS-Tenant': tenant } : {}),
      ...extra,
    },
  });
}
const aTenant = fixtures[0].branches[0].tenantId,
  bTenant = fixtures[1].branches[0].tenantId;
try {
  const owner = await actor(fixtures[0]),
    other = await actor(fixtures[1]);
  await select(owner.context, aTenant);
  await select(other.context, bTenant);
  const accessA = (await sessionData(owner.context)).accessToken,
    accessB = (await sessionData(other.context)).accessToken;
  for (const [port, path] of [
    [8081, 'auth/me'],
    [8082, 'vehicles'],
    [8083, 'work-orders'],
  ])
    check(`${port}: unauthenticated access`, (await direct(port, path, null, aTenant)).status, 401);
  const claims = JSON.parse(Buffer.from(accessA.split('.')[1], 'base64url'));
  claims.role = 'BRAND_OWNER';
  claims.tenant = bTenant;
  const forged =
    accessA.split('.')[0] +
    '.' +
    Buffer.from(JSON.stringify(claims)).toString('base64url') +
    '.' +
    accessA.split('.')[2];
  check('tampered OIDC token', (await direct(8082, 'vehicles', forged, bTenant)).status, 401);
  const data =
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 300 })).toString(
      'base64url',
    );
  const legacy =
    data +
    '.' +
    createHmac('sha256', env.MOTOROS_JWT_SECRET || 'retired-test-key')
      .update(data)
      .digest('base64url');
  check(
    'legacy local signer rejected',
    (await direct(8081, 'auth/me', legacy, aTenant)).status,
    401,
  );
  check(
    'cross-tenant brand read',
    (await direct(8081, 'tenants/' + bTenant, accessA, bTenant)).status,
    403,
  );
  check(
    'cross-tenant vehicle read',
    (await direct(8082, 'vehicles/' + fixtures[1].vehicleId, accessA, aTenant)).status,
    404,
  );
  const customers = await json(
    await call(owner.context, 'customer/customers', { tenant: aTenant }),
    200,
    'customer API uses live membership',
  );
  assert.ok(customers.content.every((c) => c.tenantId === aTenant));
  check(
    'search contains only selected tenant',
    customers.content.every((c) => c.tenantId === aTenant),
    true,
  );
  const created = await json(
    await call(owner.context, 'tenant/branches', {
      method: 'POST',
      tenant: aTenant,
      data: {
        name: 'Security test ' + Date.now(),
        branchCode: 'T2-' + randomUUID().slice(0, 8),
        city: 'Chennai',
      },
    }),
    201,
    'owner creates branch',
  );
  await json(
    await call(owner.context, 'tenant/branches', {
      method: 'POST',
      tenant: aTenant,
      data: { name: 'Duplicate code', branchCode: created.branchCode, city: 'Chennai' },
    }),
    409,
    'duplicate branch code rejected',
  );
  await json(
    await call(owner.context, `tenant/tenants/${bTenant}/branches`, {
      method: 'POST',
      tenant: aTenant,
      data: { name: 'Intrusion', branchCode: 'INTRUDE', city: 'Chennai' },
    }),
    403,
    'tenant path manipulation rejected',
  );
  const decision = await json(
    await call(owner.context, 'tenant/me/permissions', { tenant: aTenant }),
    200,
    'live owner context',
  );
  check('new branch is visible without new JWT', decision.branches.includes(created.id), true);
  await select(owner.context, fixtures[0].extraTenantId);
  await json(
    await call(owner.context, 'customer/customers', { tenant: aTenant }),
    409,
    'stale-tab brand context rejected',
  );
  const denied = await owner.context.request.post(origin + '/api/context', {
    headers: { Origin: origin },
    data: { tenantId: bTenant },
  });
  check('unauthorized brand switch', denied.status(), 403);
  await select(owner.context, aTenant);
  const managerIdentity = await createIdentity('manager'),
    mechanicIdentity = await createIdentity('mechanic');
  const branch = fixtures[0].branches[1].id;
  const managerInvite = await json(
    await call(owner.context, `tenant/tenants/${aTenant}/invitations`, {
      method: 'POST',
      tenant: aTenant,
      data: { email: managerIdentity.email, role: 'BRANCH_MANAGER', branchIds: [branch] },
    }),
    201,
    'owner invites manager',
  );
  assert.ok(!('token' in managerInvite) && !('tokenHash' in managerInvite));
  const managerMail = await invitationMail(managerIdentity.email);
  await json(
    await call(other.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: managerMail.token },
    }),
    403,
    'wrong verified account denied',
  );
  const manager = await actor(managerIdentity);
  const accepted = await json(
    await call(manager.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: managerMail.token },
    }),
    200,
    'manager accepts delivered invitation',
  );
  await select(manager.context, aTenant);
  await json(
    await call(manager.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: managerMail.token },
    }),
    409,
    'invitation is single-use',
  );
  const visible = await json(
    await call(manager.context, 'tenant/branches', { tenant: aTenant }),
    200,
    'manager lists assigned branches',
  );
  check('manager sees exactly assigned branch', visible.length, 1);
  check('manager branch assignment', visible[0].id, branch);
  const location = visible[0];
  await json(
    await call(manager.context, 'tenant/branches/' + branch, {
      method: 'PATCH',
      tenant: aTenant,
      data: {
        name: location.name,
        branchCode: location.branchCode,
        city: location.city,
        timezone: location.timezone,
        status: location.status,
        version: location.version,
        operatingHours: { MONDAY: { open: '09:00', close: '18:00' } },
        settings: { serviceBays: 3 },
      },
    }),
    200,
    'manager updates assigned branch hours',
  );
  await json(
    await call(manager.context, 'tenant/tenants/' + aTenant, {
      method: 'PATCH',
      tenant: aTenant,
      data: { name: 'Forbidden', version: 0 },
    }),
    403,
    'manager cannot edit brand settings',
  );
  await json(
    await call(manager.context, `tenant/tenants/${aTenant}/invitations`, {
      method: 'POST',
      tenant: aTenant,
      data: { email: 'owner-forgery@example.test', role: 'BRAND_OWNER', branchIds: [] },
    }),
    403,
    'manager cannot grant owner',
  );
  await json(
    await call(manager.context, `tenant/tenants/${aTenant}/invitations`, {
      method: 'POST',
      tenant: aTenant,
      data: {
        email: 'scope-forgery@example.test',
        role: 'MECHANIC',
        branchIds: [fixtures[0].branches[0].id],
      },
    }),
    403,
    'manager cannot assign foreign branch',
  );
  await json(
    await call(manager.context, `tenant/tenants/${aTenant}/staff/${accepted.membershipId}/roles`, {
      method: 'PATCH',
      tenant: aTenant,
      data: { role: 'BRAND_OWNER', branchIds: [], version: 0 },
    }),
    403,
    'self role escalation denied',
  );
  await json(
    await call(owner.context, `tenant/tenants/${aTenant}/invitations`, {
      method: 'POST',
      tenant: aTenant,
      data: { email: mechanicIdentity.email, role: 'MECHANIC', branchIds: [branch] },
    }),
    201,
    'owner invites mechanic',
  );
  const mechanicMail = await invitationMail(mechanicIdentity.email);
  const mechanic = await actor(mechanicIdentity);
  const mechanicAccepted = await json(
    await call(mechanic.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: mechanicMail.token },
    }),
    200,
    'mechanic accepts delivered invitation',
  );
  await select(mechanic.context, aTenant);
  const mechanicToken = (await sessionData(mechanic.context)).accessToken;
  await json(
    await call(mechanic.context, 'customer/customers', {
      method: 'POST',
      tenant: aTenant,
      data: { name: 'Forbidden' },
    }),
    403,
    'mechanic cannot create customers',
  );
  await json(
    await call(mechanic.context, 'tenant/tenants/' + aTenant, {
      method: 'PATCH',
      tenant: aTenant,
      data: { name: 'Forbidden', version: 0 },
    }),
    403,
    'mechanic cannot edit brand',
  );
  const history = await json(
    await call(
      mechanic.context,
      `workorder/vehicles/${fixtures[0].vehicleId}/history?branchId=${branch}`,
      { tenant: aTenant },
    ),
    200,
    'authorized cross-branch mechanic history',
  );
  check('history originates in another branch', history[0].branchId, fixtures[0].branches[0].id);
  await json(
    await call(
      mechanic.context,
      `workorder/vehicles/${fixtures[1].vehicleId}/history?branchId=${branch}`,
      { tenant: aTenant },
    ),
    404,
    'cross-tenant history denied',
  );
  await json(
    await call(mechanic.context, 'workorder/work-orders?allBranches=true', { tenant: aTenant }),
    403,
    'mechanic cannot use brand-wide overview',
  );
  await json(
    await call(manager.context, `tenant/tenants/${bTenant}/branches`, {
      method: 'POST',
      tenant: aTenant,
      data: { name: 'Forbidden', branchCode: 'FORBIDDEN', city: 'Chennai' },
    }),
    403,
    'manager cannot modify another tenant branches',
  );
  check(
    'mechanic cannot read foreign vehicle',
    (await direct(8082, 'vehicles/' + fixtures[1].vehicleId, mechanicToken, bTenant)).status,
    403,
  );
  const service = await machineToken();
  check(
    'user cannot forge service delegation',
    (
      await direct(8081, `internal/context?tenantId=${aTenant}`, accessA, null, {
        'X-User-Token': accessA,
      })
    ).status,
    403,
  );
  check(
    'service identity alone grants no business context',
    (await direct(8082, 'vehicles', service, aTenant)).status,
    403,
  );
  check(
    'authenticated delegated user and service',
    (await direct(8082, 'vehicles', service, aTenant, { 'X-User-Token': accessA })).status,
    200,
  );
  check(
    'invalid delegated token',
    (await direct(8082, 'vehicles', service, aTenant, { 'X-User-Token': 'invalid' })).status,
    401,
  );
  const member = await json(
    await call(owner.context, `tenant/tenants/${aTenant}/staff/${mechanicAccepted.membershipId}`, {
      tenant: aTenant,
    }),
    200,
    'owner reads employee access',
  );
  await json(
    await call(owner.context, `tenant/tenants/${aTenant}/staff/${member.id}/deactivate`, {
      method: 'POST',
      tenant: aTenant,
      data: { version: member.version },
    }),
    200,
    'owner deactivates membership',
  );
  check(
    'same valid JWT immediately loses vehicle access',
    (await direct(8082, 'vehicles', mechanicToken, aTenant)).status,
    403,
  );
  check(
    'same JWT immediately loses history',
    (
      await direct(
        8083,
        `vehicles/${fixtures[0].vehicleId}/history?branchId=${branch}`,
        mechanicToken,
        aTenant,
      )
    ).status,
    403,
  );
  const expiryIdentity = await createIdentity('expiry');
  const expiring = await json(
    await call(owner.context, `tenant/tenants/${aTenant}/invitations`, {
      method: 'POST',
      tenant: aTenant,
      data: { email: expiryIdentity.email, role: 'MECHANIC', branchIds: [branch] },
    }),
    201,
    'create expiry fixture',
  );
  const oldMail = await invitationMail(expiryIdentity.email);
  await json(
    await call(owner.context, `tenant/invitations/${expiring.id}/resend`, {
      method: 'POST',
      tenant: aTenant,
      data: { version: 0 },
    }),
    200,
    'resend rotates invitation',
  );
  const replacement = await invitationMail(expiryIdentity.email, oldMail.id);
  check('resend replaces secret', replacement.token !== oldMail.token, true);
  await json(
    await call(other.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: oldMail.token },
    }),
    404,
    'old invitation link invalidated',
  );
  await database.query(
    "update tenant.staff_invitations set expires_at=now()-interval '1 second' where id=$1 and tenant_id=$2",
    [expiring.id, aTenant],
  );
  await json(
    await call(other.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: replacement.token },
    }),
    409,
    'expired invitation denied',
  );
  await json(
    await call(owner.context, `tenant/invitations/${expiring.id}/revoke`, {
      method: 'POST',
      tenant: aTenant,
      data: { version: 1 },
    }),
    200,
    'revoke invitation',
  );
  await json(
    await call(other.context, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: replacement.token },
    }),
    409,
    'revoked invitation denied',
  );
  const list = await json(
    await call(owner.context, `tenant/tenants/${aTenant}/invitations?size=100`, {
      tenant: aTenant,
    }),
    200,
    'invitation metadata listing',
  );
  check(
    'lists do not expose token hashes or secrets',
    list.every((i) => !i.token && !i.tokenHash),
    true,
  );
  const labels = await json(
    await call(owner.context, 'tenant/history-branches', { tenant: aTenant }),
    200,
    'history location labels',
  );
  check(
    'history labels contain no staff contacts',
    labels.every((row) => Object.keys(row).every((key) => ['id', 'name'].includes(key))),
    true,
  );
  const audit = await json(
    await call(owner.context, `tenant/tenants/${aTenant}/audit`, { tenant: aTenant }),
    200,
    'owner reads audit trail',
  );
  check(
    'audit includes actor tenant correlation and outcome',
    audit.some((e) => e.actorId && e.tenantId === aTenant && e.correlationId && e.outcome),
    true,
  );
  await json(
    await call(owner.context, 'tenant/platform/tenants'),
    403,
    'owner cannot enter platform administration',
  );
  const operator = await actor(await createIdentity('platform-operator'));
  await database.query(
    'update tenant.platform_users set platform_admin=true where issuer=$1 and subject=$2',
    ['http://127.0.0.1:8180/realms/motoros', operator.subject],
  );
  try {
    const brands = await json(
      await call(operator.context, 'tenant/platform/tenants'),
      200,
      'explicit platform operator lists brands',
    );
    const brand = brands.find((t) => t.id === aTenant);
    await json(
      await call(operator.context, `tenant/platform/tenants/${aTenant}/status`, {
        method: 'POST',
        data: { status: 'SUSPENDED', version: brand.version },
      }),
      200,
      'privileged operator suspends brand',
    );
    check(
      'suspended brand rejects same user JWT',
      (await direct(8082, 'vehicles', accessA, aTenant)).status,
      403,
    );
  } finally {
    const current = await database.query('select version from tenant.tenants where id=$1', [
      aTenant,
    ]);
    await json(
      await call(operator.context, `tenant/platform/tenants/${aTenant}/status`, {
        method: 'POST',
        data: { status: 'ACTIVE', version: Number(current.rows[0].version) },
      }),
      200,
      'privileged operator restores brand',
    );
    await database.query(
      'update tenant.platform_users set platform_admin=false where issuer=$1 and subject=$2',
      ['http://127.0.0.1:8180/realms/motoros', operator.subject],
    );
  }
  const before = await sessionData(owner.context);
  await sessionData(owner.context, { accessExpiresAt: Date.now() - 1000 });
  const refreshed = await Promise.all(
    [1, 2, 3].map(() => owner.context.request.get(origin + '/api/auth/session')),
  );
  check(
    'parallel session refresh succeeds',
    refreshed.every((r) => r.status() === 200),
    true,
  );
  const after = await sessionData(owner.context);
  check('refresh token rotates server-side', after.refreshToken !== before.refreshToken, true);
  check(
    'CSRF protects session context',
    (
      await owner.context.request.post(origin + '/api/context', {
        headers: { Origin: 'https://untrusted.example' },
        data: { tenantId: aTenant },
      })
    ).status(),
    403,
  );
  check(
    'CSRF protects logout',
    (
      await owner.context.request.post(origin + '/api/auth/logout', {
        headers: { Origin: 'https://untrusted.example' },
      })
    ).status(),
    403,
  );
  const cookie = (await owner.context.cookies()).find((c) => c.name === 'motoros-session');
  const loggedOut = await owner.context.request.post(origin + '/api/auth/logout', {
    headers: { Origin: origin },
  });
  check('logout deletes application session', loggedOut.status(), 200);
  const replay = await fetch(origin + '/api/auth/session', {
    headers: { Cookie: `motoros-session=${cookie.value}` },
  }).then((r) => r.json());
  check('logged-out session cookie cannot be replayed', replay.authenticated, false);
  const preserved = await database.query(
    'select count(*)::integer as n from tenant.legacy_staff_users',
  );
  check('legacy migration table remains available', preserved.rows[0].n >= 0, true);
  const passwords = await database.query(
    "select count(*)::integer as n from information_schema.columns where table_schema='tenant' and column_name='password_hash'",
  );
  check('MotorOS no longer stores password hashes', passwords.rows[0].n, 0);
  writeFileSync(
    '.runtime/m2-api-results.json',
    JSON.stringify(
      { checks: results.length, passed: results.every((r) => r.pass), results },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${results.length} Milestone 2 live OIDC, membership, invitation, delegation, revocation and session checks.`,
  );
} finally {
  await database.end();
  for (const context of contexts) await context.close();
  await browser.close();
}
