import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv } from '../../scripts/env.mjs';
import {
  signIn,
  select,
  call,
  createIdentity,
  mail,
  sessionData,
  machineToken,
} from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8')),
  m5 = JSON.parse(readFileSync('.runtime/m5-fixtures.json', 'utf8')),
  env = loadEnv();
const results = [],
  browser = await chromium.launch(),
  contexts = [];
const db = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  database: 'motoros',
  user: 'postgres',
  password: env.POSTGRES_PASSWORD,
});
await db.connect();
async function actor(identity, tenant = f.tenant) {
  const c = await browser.newContext();
  contexts.push(c);
  await signIn(await c.newPage(), identity);
  if (tenant) await select(c, tenant);
  return c;
}
function check(name, actual, expected = true) {
  results.push({ name, actual, expected, pass: actual === expected });
  assert.equal(actual, expected, name);
}
async function req(c, path, expected = 200, options = {}) {
  const response = await call(c, path, { tenant: f.tenant, ...options });
  const body = await response.json();
  check(path + ' (' + (body.title || response.status()) + ')', response.status(), expected);
  return body;
}
const post = (data) => ({ method: 'POST', data });
async function wait(name, condition, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await condition();
    if (value) {
      check(name, true);
      return value;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Timed out: ' + name);
}
function localAws(args) {
  const r = spawnSync(
    'docker',
    ['exec', 'motoros-localstack-1', 'awslocal', '--region', 'ap-south-1', ...args],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error('Local broker operation failed: ' + args[0] + ' ' + args[1]);
  return r.stdout ? JSON.parse(r.stdout) : {};
}
let savedPreferences;
try {
  const owner = await actor(f.owner),
    precision = await actor(f.precisionOwner, f.precisionTenant),
    mechanic = await actor(f.employeeA);
  let fixtures = existsSync('.runtime/m6-fixtures.json')
    ? JSON.parse(readFileSync('.runtime/m6-fixtures.json', 'utf8'))
    : null;
  if (!fixtures) {
    if (process.env.MOTOROS_DEV_FIXTURES !== '1')
      throw new Error(
        'Set MOTOROS_DEV_FIXTURES=1 to create the separate synthetic local platform administrator.',
      );
    const identity = await createIdentity('m6-platform-admin');
    const c = await actor(identity, null);
    const me = await c.request.get('http://127.0.0.1:3000/api/auth/me').then((r) => r.json());
    await db.query(
      "update tenant.platform_users set platform_admin=true where id=$1 and email like 'm6-platform-admin-%@example.test'",
      [me.user.id],
    );
    fixtures = { platformIdentity: identity };
    writeFileSync('.runtime/m6-fixtures.json', JSON.stringify(fixtures, null, 2));
  }
  const platform = await actor(fixtures.platformIdentity, null);
  await req(owner, 'notification/platform/messaging/health', 403);
  await req(platform, 'notification/platform/messaging/health');
  const metadata=await req(platform,'booking/platform/messaging/outbox?size=5');
  check('Platform outbox listing excludes payloads',metadata.content.every(e=>!Object.hasOwn(e,'payload')&&!Object.hasOwn(e,'sourceSnapshot')),true);
  await req(owner,'booking/platform/messaging/outbox?size=5',403);
  await req(mechanic, 'notification/notifications?branchId=' + f.velachery.id, 403);
  await req(precision, 'notification/notifications?branchId=' + f.omr.id, 403, {
    tenant: f.precisionTenant,
  });
  await req(precision, 'analytics/analytics/branch?branchId=' + f.omr.id, 403, {
    tenant: f.precisionTenant,
  });
  await req(owner, 'notification/notifications/templates');
  savedPreferences = await req(owner, 'customer/communication-preferences/' + m5.customer.id);
  let prefs = await req(owner, 'customer/communication-preferences/' + m5.customer.id, 200, {
    method: 'PUT',
    data: {
      ...savedPreferences,
      emailEnabled: true,
      operationalEnabled: true,
      preferredLanguage: 'ta',
      consentNote: 'Explicit synthetic M6 operational communication consent',
    },
  });
  check('Tamil preference persisted', prefs.preferredLanguage, 'ta');
  await req(precision, 'customer/communication-preferences/' + m5.customer.id, 404, {
    tenant: f.precisionTenant,
  });
  let start;
  for (let day = 20; day < 60; day++) {
    const d = new Date(Date.now() + day * 86400000);
    d.setUTCHours(5, 0, 0, 0);
    const candidate = d.toISOString();
    const available = await req(
      owner,
      `booking/appointments/availability?branchId=${f.omr.id}&startsAt=${candidate}&durationMinutes=15`,
    );
    if (available.available) {
      start = candidate;
      break;
    }
  }
  assert.ok(start, 'Available synthetic appointment interval');
  const input = {
    branchId: f.omr.id,
    customerId: m5.customer.id,
    vehicleId: m5.vehicle.id,
    serviceCategoryId: '00000000-0000-0000-0000-000000000401',
    requestedStartTime: start,
    estimatedDurationMinutes: 15,
    customerComplaint: 'M6 reliable notification acceptance ' + randomUUID(),
    bookingSource: 'STAFF',
  };
  let booking = await req(owner, 'booking/appointments', 201, post(input));
  booking = await req(
    owner,
    `booking/appointments/${booking.id}/confirm`,
    200,
    post({ version: booking.version, note: 'Synthetic M6 confirmation' }),
  );
  const event = await wait('Committed confirmation reaches published outbox', async () => {
    const r = await db.query(
      "select * from booking.outbox_events where aggregate_id=$1 and event_type='AppointmentConfirmed' and status='PUBLISHED'",
      [booking.id],
    );
    return r.rows[0];
  });
  const delivered = await wait('Booking confirmation accepted by local provider', async () => {
    const r = await db.query(
      "select * from notification.notification_requests where source_event_id=$1 and template_key='booking-confirmed' and status='SENT'",
      [event.event_id],
    );
    return r.rows[0];
  });
  check('Correct tenant on request', delivered.tenant_id, f.tenant);
  check('Tamil template used', delivered.language, 'ta');
  check(
    'SMTP acceptance is unconfirmed delivery',
    delivered.provider_status,
    'ACCEPTED_UNCONFIRMED',
  );
  const message = await mail(m5.customerIdentity.email, 'முன்பதிவு');
  check('Tamil text reached Mailpit', (message.Text || '').includes('உங்கள்'), true);
  await wait('Independent analytics subscription projected booking', async () => {
    const r = await db.query(
      'select 1 from analytics.aggregate_projections where tenant_id=$1 and aggregate_id=$2',
      [f.tenant, booking.id],
    );
    return r.rowCount === 1;
  });
  await req(owner, 'notification/notifications?branchId=' + f.omr.id);
  await req(owner, 'analytics/analytics/branch?branchId=' + f.omr.id);
  // Duplicate broker publication must retain a single source/channel/template request.
  const sourceToken = await machineToken('notification');
  const sourceProof = await fetch(
    'http://127.0.0.1:8084/api/automation/event-proof/' + event.event_id,
    { headers: { Authorization: 'Bearer ' + sourceToken, 'X-MotorOS-Tenant': f.tenant } },
  ).then((r) => r.json());
  const envelope = sourceProof.event;
  localAws([
    'sns',
    'publish',
    '--topic-arn',
    'arn:aws:sns:ap-south-1:000000000000:motoros-booking-v1',
    '--message',
    JSON.stringify(envelope),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  check(
    'Duplicate event creates one delivery request',
    Number(
      (
        await db.query(
          "select count(*) from notification.notification_requests where source_event_id=$1 and template_key='booking-confirmed'",
          [event.event_id],
        )
      ).rows[0].count,
    ),
    1,
  );
  check(
    'Exact duplicate is accepted rather than quarantined',
    Number(
      (
        await db.query('select count(*) from notification.consumer_failures where event_id=$1', [
          event.event_id,
        ])
      ).rows[0].count,
    ),
    0,
  );
  // Force only this synthetic persisted reminder due; cancellation must win at source revalidation.
  await wait('Durable appointment reminder scheduled', async () => {
    const r = await db.query(
      "select id from notification.scheduled_notifications where source_event_id=$1 and template_key='appointment-reminder'",
      [event.event_id],
    );
    return r.rows[0];
  });
  booking = await req(
    owner,
    `booking/appointments/${booking.id}/cancel`,
    200,
    post({ version: booking.version, note: 'Cancel before synthetic reminder becomes due' }),
  );
  await db.query(
    "update notification.scheduled_notifications set due_at=now()-interval '1 second' where source_event_id=$1 and template_key='appointment-reminder'",
    [event.event_id],
  );
  await wait('Cancelled appointment reminder is cancelled', async () => {
    const r = await db.query(
      "select status from notification.scheduled_notifications where source_event_id=$1 and template_key='appointment-reminder'",
      [event.event_id],
    );
    return r.rows[0]?.status === 'CANCELLED';
  });
  check(
    'No stale appointment reminder sent',
    Number(
      (
        await db.query(
          "select count(*) from notification.notification_requests where source_event_id=$1 and template_key='appointment-reminder' and status='SENT'",
          [event.event_id],
        )
      ).rows[0].count,
    ),
    0,
  );
  prefs = await req(owner, 'customer/communication-preferences/' + m5.customer.id, 200, {
    method: 'PUT',
    data: {
      ...prefs,
      emailEnabled: false,
      consentNote: 'Synthetic customer email opt-out for reliability test',
    },
  });
  let opted = await req(
    owner,
    'booking/appointments',
    201,
    post({ ...input, customerComplaint: 'M6 opted-out synthetic booking' }),
  );
  opted = await req(
    owner,
    `booking/appointments/${opted.id}/confirm`,
    200,
    post({ version: opted.version, note: 'Synthetic opted-out confirmation' }),
  );
  const optedEvent = await wait('Opt-out event processed durably', async () => {
    const r = await db.query(
      "select o.event_id from booking.outbox_events o join notification.processed_events p on p.event_id=o.event_id where o.aggregate_id=$1 and o.event_type='AppointmentConfirmed'",
      [opted.id],
    );
    return r.rows[0];
  });
  check(
    'Email opt-out respected',
    Number(
      (
        await db.query(
          "select count(*) from notification.notification_requests where source_event_id=$1 and channel='EMAIL'",
          [optedEvent.event_id],
        )
      ).rows[0].count,
    ),
    0,
  );
  await req(
    owner,
    `booking/appointments/${opted.id}/cancel`,
    200,
    post({ version: opted.version, note: 'Synthetic acceptance cleanup' }),
  );
  const user = await sessionData(owner);
  const publicProof = await fetch(
    'http://127.0.0.1:8084/api/automation/event-proof/' + event.event_id,
    { headers: { Authorization: 'Bearer ' + user.accessToken, 'X-MotorOS-Tenant': f.tenant } },
  );
  check('Public identity cannot resolve event authority', publicProof.status, 403);
  const machine = await machineToken('notification');
  const wrongCustomer=await fetch(`http://127.0.0.1:8082/api/automation/communication-context?customerId=${f.customer.id}&eventId=${event.event_id}&producer=booking`,{headers:{Authorization:'Bearer '+machine,'X-MotorOS-Tenant':f.tenant}});
  check('Incorrect recipient/customer resolution is denied',wrongCustomer.status,403);
  const wrongTenant = await fetch(
    'http://127.0.0.1:8084/api/automation/event-proof/' + event.event_id,
    { headers: { Authorization: 'Bearer ' + machine, 'X-MotorOS-Tenant': f.precisionTenant } },
  );
  check('Machine event proof rejects wrong tenant', wrongTenant.status, 404);
  const spoof = { ...envelope, eventId: randomUUID(), tenantId: f.precisionTenant };
  localAws([
    'sns',
    'publish',
    '--topic-arn',
    'arn:aws:sns:ap-south-1:000000000000:motoros-booking-v1',
    '--message',
    JSON.stringify(spoof),
  ]);
  await wait('Cross-tenant spoof quarantined', async () => {
    const r = await db.query(
      "select id from notification.consumer_failures where event_id=$1 and category='PERMANENT_VALIDATION'",
      [spoof.eventId],
    );
    return r.rows[0];
  });
  check(
    'Spoof creates no cross-tenant notification',
    Number(
      (
        await db.query(
          'select count(*) from notification.notification_requests where source_event_id=$1',
          [spoof.eventId],
        )
      ).rows[0].count,
    ),
    0,
  );
  const failure = (
    await db.query('select id from notification.consumer_failures where event_id=$1', [
      spoof.eventId,
    ])
  ).rows[0];
  await req(
    owner,
    `notification/platform/messaging/failures/${failure.id}/redrive`,
    403,
    post({ reason: 'Unauthorized synthetic redrive attempt' }),
  );
  await req(
    platform,
    `notification/platform/messaging/failures/${failure.id}/redrive`,
    200,
    post({ reason: 'Authorized negative replay must revalidate source proof' }),
  );
  await wait('Replayed invalid event remains rejected', async () => {
    const r = await db.query(
      'select attempt_count from notification.consumer_failures where id=$1',
      [failure.id],
    );
    return r.rows[0].attempt_count >= 2;
  });
  await req(
    platform,
    `notification/platform/messaging/failures/${failure.id}/resolve`,
    200,
    post({ reason: 'Verified negative replay remained isolated' }),
  );
  fixtures.lastAcceptance = {
    bookingId: booking.id,
    eventId: event.event_id,
    notificationId: delivered.id,
    customerId: m5.customer.id,
    branchId: f.omr.id,
  };
  writeFileSync('.runtime/m6-fixtures.json', JSON.stringify(fixtures, null, 2));
  console.log('M6 live event/notification checks passed: ' + results.length);
  writeFileSync(
    '.runtime/m6-api-results.json',
    JSON.stringify({ passed: true, checks: results.length, results }, null, 2),
  );
} catch (error) {
  writeFileSync(
    '.runtime/m6-api-results.json',
    JSON.stringify(
      { passed: false, checks: results.length, results, error: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (savedPreferences) {
    try {
      const c = contexts[0];
      const r = await call(c, 'customer/communication-preferences/' + m5.customer.id, {
        tenant: f.tenant,
      });
      const current = await r.json();
      await call(c, 'customer/communication-preferences/' + m5.customer.id, {
        tenant: f.tenant,
        method: 'PUT',
        data: {
          ...savedPreferences,
          version: current.version,
          consentNote: 'Restore synthetic preferences after M6 acceptance',
        },
      });
    } catch {}
  }
  await db.end();
  await browser.close();
}
