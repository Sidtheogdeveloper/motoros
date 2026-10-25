import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv } from '../../scripts/env.mjs';
import { signIn, select, call, machineToken } from '../helpers/oidc.mjs';
import { completeDevelopmentJob } from '../helpers/workshop.mjs';
if (process.env.MOTOROS_FAILURE_TESTS !== '1')
  throw new Error('Set MOTOROS_FAILURE_TESTS=1 for controlled local broker/SMTP failure tests.');
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8')),
  m5 = JSON.parse(readFileSync('.runtime/m5-fixtures.json', 'utf8')),
  m6 = JSON.parse(readFileSync('.runtime/m6-fixtures.json', 'utf8')),
  env = loadEnv();
const browser = await chromium.launch(),
  results = [],
  db = new pg.Client({
    host: '127.0.0.1',
    port: 55432,
    database: 'motoros',
    user: 'postgres',
    password: env.POSTGRES_PASSWORD,
  });
await db.connect();
let brokerStopped = false,
  smtpStopped = false,
  paused = false;
function check(name, value) {
  results.push({ name, pass: !!value });
  assert.ok(value, name);
}
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('Controlled Docker operation failed: ' + args[0]);
  return r.stdout.trim();
}
function aws(args) {
  const text = docker([
    'exec',
    'motoros-localstack-1',
    'awslocal',
    '--region',
    'ap-south-1',
    ...args,
  ]);
  return text ? JSON.parse(text) : {};
}
async function wait(name, fn, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) {
        check(name, true);
        return value;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Timed out: ' + name);
}
async function actor(identity, tenant) {
  const c = await browser.newContext();
  await signIn(await c.newPage(), identity);
  if (tenant) await select(c, tenant);
  return c;
}
async function req(c, path, data, expected = 200, method = 'POST') {
  const r = await call(c, path, { tenant: f.tenant, method, data });
  const body = await r.json();
  assert.equal(r.status(), expected, path + ' ' + (body.title || ''));
  return body;
}
async function source(producer, id) {
  const port = { booking: 8084, workorder: 8083, billing: 8086, inventory: 8085 }[producer];
  const token = await machineToken('notification');
  const r = await fetch(`http://127.0.0.1:${port}/api/automation/event-proof/${id}`, {
    headers: { Authorization: 'Bearer ' + token, 'X-MotorOS-Tenant': f.tenant },
  });
  assert.equal(r.status, 200);
  return (await r.json()).event;
}
let platform;
try {
  const owner = await actor(f.owner, f.tenant);
  platform = await actor(m6.platformIdentity, null);
  async function control(action) {
    return req(platform, 'notification/platform/messaging/consumer/' + action, {
      reason: 'Controlled synthetic M6 consumer recovery test',
    });
  }
  await wait('Initial subscription backlog drained', async () => {
    const h = await req(platform, 'notification/platform/messaging/health', undefined, 200, 'GET');
    return ['notification', 'analytics', 'workorder-approval'].every(
      (k) =>
        Number(h.queues[k]?.ApproximateNumberOfMessages || 0) === 0 &&
        Number(h.queues[k]?.ApproximateNumberOfMessagesNotVisible || 0) === 0,
    );
  });
  await control('pause');
  paused = true;
  await wait('Consumer paused after completing existing handlers', async () => {
    const h = await req(platform, 'notification/platform/messaging/health', undefined, 200, 'GET');
    return h.worker.activeConsumerLoops === 0 && !h.worker.consuming;
  });
  let start;
  for (let day = 60; day < 100; day++) {
    const d = new Date(Date.now() + day * 86400000);
    d.setUTCHours(6, 0, 0, 0);
    const candidate = d.toISOString();
    const a = await req(
      owner,
      `booking/appointments/availability?branchId=${f.omr.id}&startsAt=${candidate}&durationMinutes=15`,
      undefined,
      200,
      'GET',
    );
    if (a.available) {
      start = candidate;
      break;
    }
  }
  assert.ok(start);
  const input = {
    branchId: f.omr.id,
    customerId: m5.customer.id,
    vehicleId: m5.vehicle.id,
    serviceCategoryId: '00000000-0000-0000-0000-000000000401',
    requestedStartTime: start,
    estimatedDurationMinutes: 15,
    customerComplaint: 'M6 abandoned consumer receipt ' + Date.now(),
    bookingSource: 'STAFF',
  };
  let booking = await req(owner, 'booking/appointments', input, 201);
  booking = await req(owner, `booking/appointments/${booking.id}/confirm`, {
    version: booking.version,
    note: 'Synthetic abandoned-receipt confirmation',
  });
  const queue = aws(['sqs', 'get-queue-url', '--queue-name', 'motoros-notification-v1']).QueueUrl;
  const receipt = await wait(
    'Short-lived test consumer receives confirmation without acknowledging it',
    async () => {
      const r = aws([
        'sqs',
        'receive-message',
        '--queue-url',
        queue,
        '--max-number-of-messages',
        '10',
        '--wait-time-seconds',
        '1',
        '--visibility-timeout',
        '30',
      ]);
      let target;
      for (const message of r.Messages || []) {
        const e = JSON.parse(JSON.parse(message.Body).Message);
        if (e.aggregateId === booking.id && e.eventType === 'AppointmentConfirmed')
          target = message;
        else
          aws([
            'sqs',
            'delete-message',
            '--queue-url',
            queue,
            '--receipt-handle',
            message.ReceiptHandle,
          ]);
      }
      return target;
    },
  );
  const wrapper = JSON.parse(receipt.Body),
    received = JSON.parse(wrapper.Message);
  check(
    'SNS transport includes propagated trace context',
    !!wrapper.MessageAttributes?.traceparent?.Value,
  );
  check(
    'No effect before abandoned receipt recovery',
    Number(
      (
        await db.query(
          'select count(*) from notification.notification_requests where source_event_id=$1',
          [received.eventId],
        )
      ).rows[0].count,
    ) === 0,
  );
  // The receive subprocess has exited. Its receipt is left unacknowledged; no handler ran.
  aws([
    'sqs',
    'change-message-visibility',
    '--queue-url',
    queue,
    '--receipt-handle',
    receipt.ReceiptHandle,
    '--visibility-timeout',
    '2',
  ]);
  await control('resume');
  paused = false;
  await wait('Restarted consumer processes abandoned delivery', async () => {
    const r = await db.query(
      "select id from notification.notification_requests where source_event_id=$1 and status='SENT'",
      [received.eventId],
    );
    return r.rows[0];
  });
  check(
    'Abandoned/restarted delivery creates one request',
    Number(
      (
        await db.query(
          'select count(*) from notification.notification_requests where source_event_id=$1',
          [received.eventId],
        )
      ).rows[0].count,
    ) === 1,
  );
  // Real provider failure: disable only local SMTP, then verify durable request retry.
  docker(['stop', 'motoros-mailpit-1']);
  smtpStopped = true;
  const later = new Date(Date.parse(start) + 3600000).toISOString();
  let retryBooking = await req(
    owner,
    'booking/appointments',
    {
      ...input,
      requestedStartTime: later,
      customerComplaint: 'M6 provider recovery ' + Date.now(),
    },
    201,
  );
  retryBooking = await req(owner, `booking/appointments/${retryBooking.id}/confirm`, {
    version: retryBooking.version,
    note: 'Synthetic SMTP outage confirmation',
  });
  const retry = await wait('SMTP outage leaves durable retryable request', async () => {
    const r = await db.query(
      "select n.* from notification.notification_requests n join booking.outbox_events e on e.event_id=n.source_event_id where e.aggregate_id=$1 and n.template_key='booking-confirmed' and n.attempt_count>=1 and n.status in ('QUEUED','FAILED')",
      [retryBooking.id],
    );
    return r.rows[0];
  });
  docker(['start', 'motoros-mailpit-1']);
  smtpStopped = false;
  if (retry.status === 'FAILED')
    await req(owner, `notification/notifications/${retry.id}/retry`, {
      version: retry.version,
      reason: 'Restore synthetic delivery after local SMTP restart',
    });
  await wait('Provider recovery accepts the same durable request', async () => {
    const r = await db.query(
      'select status,attempt_count from notification.notification_requests where id=$1',
      [retry.id],
    );
    return r.rows[0]?.status === 'SENT' && r.rows[0].attempt_count >= 2;
  });
  await wait('Producer journal recorded local broker generation', async () => {
    const r = await db.query(
      "select value from booking.messaging_runtime_metadata where key='local-broker-generation'",
    );
    return !!r.rows[0];
  });
  await control('pause');
  paused = true;
  await wait('Consumer paused for already-published message recovery', async () => {
    const h = await req(platform, 'notification/platform/messaging/health', undefined, 200, 'GET');
    return h.worker.activeConsumerLoops === 0;
  });
  let journalBooking = await req(
    owner,
    'booking/appointments',
    {
      ...input,
      requestedStartTime: new Date(Date.parse(start) + 7200000).toISOString(),
      customerComplaint: 'M6 already-published message journal recovery',
    },
    201,
  );
  journalBooking = await req(owner, `booking/appointments/${journalBooking.id}/confirm`, {
    version: journalBooking.version,
    note: 'Synthetic message queued before broker restart',
  });
  const journalEvent = await wait('Message was published before broker stopped', async () => {
    const r = await db.query(
      "select event_id from booking.outbox_events where aggregate_id=$1 and event_type='AppointmentConfirmed' and status='PUBLISHED'",
      [journalBooking.id],
    );
    return r.rows[0];
  });
  // Stop SNS/SQS and complete an actual local development workshop workflow through owned APIs.
  docker(['stop', 'motoros-localstack-1']);
  brokerStopped = true;
  const readings = await req(
    owner,
    `customer/vehicles/${m5.vehicle.id}/odometer?size=1`,
    undefined,
    200,
    'GET',
  );
  const km = Math.max(20000, ...readings.content.map((r) => Number(r.kilometers))) + 100;
  const intake = await req(
    owner,
    'workorder/check-ins',
    {
      branchId: f.omr.id,
      customerId: m5.customer.id,
      vehicleId: m5.vehicle.id,
      odometerKilometers: km,
      complaints: 'M6 broker outage repair completion',
      serviceRequested: 'Synthetic local reviewed recovery service',
      accessories: ['Spare wheel'],
    },
    201,
  );
  let job = await req(owner, 'workorder/work-orders/' + intake.workOrderId, undefined, 200, 'GET');
  job = await completeDevelopmentJob(owner, f.tenant, job);
  check('Work-order workflow commits with broker stopped', job.status === 'CLOSED');
  const completion = (
    await db.query(
      "select * from workorder.outbox_events where aggregate_id=$1 and event_type='WorkOrderCompleted' order by created_at desc limit 1",
      [job.id],
    )
  ).rows[0];
  check(
    'Completion event committed while broker offline',
    !!completion && !completion.published_at && ['PENDING', 'CLAIMED'].includes(completion.status),
  );
  docker(['start', 'motoros-localstack-1']);
  brokerStopped = false;
  await wait(
    'Broker restart restores local topic/subscription topology',
    async () => {
      return !!aws(['sns', 'list-topics']).Topics?.find((t) =>
        t.TopicArn.endsWith(':motoros-workorder-v1'),
      );
    },
    120000,
  );
  await wait(
    'Persisted work-order completion publishes after broker recovery',
    async () => {
      const r = await db.query('select status from workorder.outbox_events where event_id=$1', [
        completion.event_id,
      ]);
      return r.rows[0]?.status === 'PUBLISHED';
    },
    180000,
  );
  await control('resume');
  paused = false;
  await wait(
    'Previously published but unconsumed message recovers from local journal',
    async () => {
      const r = await db.query(
        "select id from notification.notification_requests where source_event_id=$1 and status='SENT'",
        [journalEvent.event_id],
      );
      return r.rows[0];
    },
    180000,
  );
  check(
    'Broker journal replay creates exactly one request',
    Number(
      (
        await db.query(
          'select count(*) from notification.notification_requests where source_event_id=$1',
          [journalEvent.event_id],
        )
      ).rows[0].count,
    ) === 1,
  );
  await wait('Recovered completion projects exactly one work order', async () => {
    const r = await db.query(
      'select count(*) from analytics.aggregate_projections where tenant_id=$1 and aggregate_id=$2',
      [f.tenant, job.id],
    );
    return Number(r.rows[0].count) === 1;
  });
  // Replaying actual commercial events cannot repeat their original authoritative transactions.
  const before = {
    payments: Number((await db.query('select count(*) from billing.payments')).rows[0].count),
    invoices: Number((await db.query('select count(*) from billing.invoices')).rows[0].count),
    movements: Number(
      (await db.query('select count(*) from inventory.stock_movements')).rows[0].count,
    ),
  };
  for (const [producer, type] of [
    ['billing', 'InvoiceIssued'],
    ['billing', 'PaymentRecorded'],
    ['billing', 'EstimateApproved'],
    ['inventory', 'PartConsumed'],
  ]) {
    const row = (
      await db.query(
        `select event_id from ${producer}.outbox_events where tenant_id=$1 and event_type=$2 and aggregate_version is not null order by created_at desc limit 1`,
        [f.tenant, type],
      )
    ).rows[0];
    assert.ok(row, 'Existing actual commercial event ' + type);
    const e = await source(producer, row.event_id);
    for (let duplicate = 0; duplicate < 2; duplicate++)
      aws([
        'sns',
        'publish',
        '--topic-arn',
        `arn:aws:sns:ap-south-1:000000000000:motoros-${producer}-v1`,
        '--message',
        JSON.stringify(e),
      ]);
  }
  await new Promise((r) => setTimeout(r, 4000));
  check(
    'Duplicate PaymentRecorded creates no payment records',
    Number((await db.query('select count(*) from billing.payments')).rows[0].count) ===
      before.payments,
  );
  check(
    'Duplicate InvoiceIssued creates no invoices',
    Number((await db.query('select count(*) from billing.invoices')).rows[0].count) ===
      before.invoices,
  );
  check(
    'Duplicate PartsConsumed creates no inventory movements',
    Number((await db.query('select count(*) from inventory.stock_movements')).rows[0].count) ===
      before.movements,
  );
  for (const b of [booking, retryBooking, journalBooking])
    await req(owner, `booking/appointments/${b.id}/cancel`, {
      version: b.version,
      note: 'Synthetic reliability acceptance cleanup',
    });
  const result = {
    passed: true,
    checks: results.length,
    results,
    recoveredWorkOrderId: job.id,
    completionEventId: completion.event_id,
    consumerFailureMethod:
      'Paused real consumer; independent receive subprocess exited without acknowledgment; visibility expiry followed by real consumer restart. Transaction rollback and post-commit duplicate windows also covered by JUnit.',
    brokerFailureMethod:
      'Stopped local SNS/SQS container, completed reviewed local development work-order workflow, restarted broker and verified outbox publication/projection. A previously published but unconsumed message also recovered through the local 14-day producer journal replay. Production AWS durability is not emulated.',
  };
  writeFileSync('.runtime/m6-reliability-results.json', JSON.stringify(result, null, 2));
  console.log('M6 controlled reliability checks passed: ' + results.length);
} catch (error) {
  writeFileSync(
    '.runtime/m6-reliability-results.json',
    JSON.stringify({ passed: false, results, error: error.message }, null, 2),
  );
  throw error;
} finally {
  if (brokerStopped) docker(['start', 'motoros-localstack-1']);
  if (smtpStopped) docker(['start', 'motoros-mailpit-1']);
  if (paused && platform)
    try {
      await req(platform, 'notification/platform/messaging/consumer/resume', {
        reason: 'Restore consumer after controlled failure test',
      });
    } catch {}
  await db.end();
  await browser.close();
}
