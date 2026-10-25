import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { localEnv, serviceEnv } from '../../scripts/runtime.mjs';
import { fixtures, signIn, sessionData } from '../helpers/oidc.mjs';
const env = localEnv(),
  suffix = Date.now(),
  created = [],
  ports = {};
const network = process.env.MOTOROS_DOCKER_NETWORK || 'motoros_default';
const names = Object.fromEntries(
  [
    'tenant',
    'customer',
    'workorder',
    'booking',
    'inventory',
    'billing',
    'notification',
    'analytics',
  ].map((s) => [s, `motoros-m6-${s}-${suffix}`]),
);
function docker(args, childEnv = env) {
  const r = spawnSync('docker', args, {
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error((r.stderr || r.error?.message || 'Docker command failed').slice(-1500));
  return r.stdout.trim();
}
const browser = await chromium.launch();
try {
  for (const [index, service] of [
    'tenant',
    'customer',
    'workorder',
    'booking',
    'inventory',
    'billing',
    'notification',
    'analytics',
  ].entries()) {
    const image = `motoros/${service}:${process.env.MOTOROS_IMAGE_TAG || 'milestone7'}`;
    const config = JSON.parse(docker(['image', 'inspect', image]))[0].Config;
    assert.equal(config.User, 'motoros');
    assert.ok(config.Env.includes('PORT=8080'));
    assert.ok(!config.Env.some((v) => /PASSWORD=|CLIENT_SECRET=|ENCRYPTION_KEY=/.test(v)));
    const childEnv = {
      ...serviceEnv(env, service, index),
      PORT: '8080',
      MESSAGING_ENABLED: 'true',
      MESSAGING_ENDPOINT: 'http://localstack:4566',
      MESSAGING_ACCOUNT: '000000000000',
      MESSAGING_BOOTSTRAP: 'false',
      MOTOROS_EVENTS_PUBLISH_ENABLED: 'false',
      MOTOROS_EVENTS_CONSUME_ENABLED: 'false',
      MOTOROS_ANALYTICS_RECONCILE_ENABLED: 'false',
      NOTIFICATION_ENCRYPTION_KEY:
        service === 'notification' ? env.NOTIFICATION_ENCRYPTION_KEY : undefined,
      DATABASE_URL: 'jdbc:postgresql://postgres:5432/motoros',
      // This second eight-service fleet shares the local database with the running app.
      SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: '3',
      SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE: '1',
      TENANT_URL: `http://${names.tenant}:8080`,
      CUSTOMER_URL: `http://${names.customer}:8080`,
      WORKORDER_URL: `http://${names.workorder}:8080`,
      BOOKING_URL: `http://${names.booking}:8080`,
      INVENTORY_URL: `http://${names.inventory}:8080`,
      BILLING_URL: `http://${names.billing}:8080`,
      NOTIFICATION_URL: `http://${names.notification}:8080`,
      ANALYTICS_URL: `http://${names.analytics}:8080`,
      S3_ENDPOINT: 'http://storage:8333',
      S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:8333',
      S3_LOCAL_ACCESS_KEY: ['customer', 'workorder', 'billing'].includes(service)
        ? env.S3_LOCAL_ACCESS_KEY
        : undefined,
      S3_LOCAL_SECRET_KEY: ['customer', 'workorder', 'billing'].includes(service)
        ? env.S3_LOCAL_SECRET_KEY
        : undefined,
      OIDC_ISSUER: 'http://127.0.0.1:8180/realms/motoros',
      OIDC_JWKS_URI: 'http://keycloak:8080/realms/motoros/protocol/openid-connect/certs',
      OIDC_TOKEN_URI: 'http://keycloak:8080/realms/motoros/protocol/openid-connect/token',
      OIDC_USERINFO_URI: 'http://keycloak:8080/realms/motoros/protocol/openid-connect/userinfo',
      MAIL_ENABLED: 'false',
      SMTP_HOST: 'mailpit',
      SMTP_PORT: '1025',
    };
    const settings = [
      'PORT',
      'MESSAGING_ENABLED',
      'MESSAGING_ENDPOINT',
      'MESSAGING_ACCOUNT',
      'MESSAGING_BOOTSTRAP',
      'MOTOROS_EVENTS_PUBLISH_ENABLED',
      'MOTOROS_EVENTS_CONSUME_ENABLED',
      'MOTOROS_ANALYTICS_RECONCILE_ENABLED',
      'NOTIFICATION_ENCRYPTION_KEY',
      'DATABASE_URL',
      'DATABASE_USER',
      'DATABASE_PASSWORD',
      'SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE',
      'SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE',
      'TENANT_URL',
      'CUSTOMER_URL',
      'WORKORDER_URL',
      'BOOKING_URL',
      'INVENTORY_URL',
      'BILLING_URL',
      'NOTIFICATION_URL',
      'ANALYTICS_URL',
      'S3_ENDPOINT',
      'S3_PUBLIC_ENDPOINT',
      'S3_LOCAL_ACCESS_KEY',
      'S3_LOCAL_SECRET_KEY',
      'OIDC_ISSUER',
      'OIDC_JWKS_URI',
      'OIDC_TOKEN_URI',
      'OIDC_USERINFO_URI',
      'SERVICE_CLIENT_ID',
      'SERVICE_CLIENT_SECRET',
      'INVITATION_ENCRYPTION_KEY',
      'MAIL_ENABLED',
      'SMTP_HOST',
      'SMTP_PORT',
    ];
    docker(
      [
        'run',
        '-d',
        '--read-only',
        '--user',
        '1000:1000',
        '--memory',
        '1g',
        '--cpus',
        '0.5',
        '--name',
        names[service],
        '--network',
        network,
        '-p',
        '127.0.0.1::8080',
        ...settings.flatMap((k) => ['-e', k]),
        image,
      ],
      childEnv,
    );
    created.push(names[service]);
    ports[service] = Number(docker(['port', names[service], '8080']).split(':').at(-1));
    let healthy = false;
    for (let i = 0; i < 90; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${ports[service]}/actuator/health`, {
          signal: AbortSignal.timeout(5000),
        });
        healthy = response.ok;
        await response.arrayBuffer();
        if (healthy) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!healthy) {
      const logs = spawnSync('docker', ['logs', names[service]], { encoding: 'utf8' });
      writeFileSync(
        `.runtime/m6-container-${service}.log`,
        (logs.stdout || '') + (logs.stderr || ''),
      );
    }
    assert.ok(healthy, service + ' container health');
    console.log(`Ready: ${service} container`);
  }
  const context = await browser.newContext();
  await signIn(await context.newPage(), fixtures[0]);
  const { accessToken } = await sessionData(context);
  const headers = {
    Authorization: 'Bearer ' + accessToken,
    'X-MotorOS-Tenant': fixtures[0].branches[0].tenantId,
  };
  assert.equal(
    (await fetch(`http://127.0.0.1:${ports.customer}/api/customers`, { headers })).status,
    200,
  );
  const history = await fetch(
    `http://127.0.0.1:${ports.workorder}/api/vehicles/${fixtures[0].vehicleId}/history?branchId=${fixtures[0].branches[1].id}`,
    { headers },
  );
  assert.equal(history.status, 200);
  assert.ok((await history.json()).some((o) => o.branchId === fixtures[0].branches[0].id));
  const timeline = await fetch(
    `http://127.0.0.1:${ports.customer}/api/vehicles/${fixtures[0].vehicleId}/timeline?branchId=${fixtures[0].branches[1].id}`,
    { headers },
  );
  assert.equal(timeline.status, 200);
  assert.ok((await timeline.json()).content.length > 0);
  const f3 = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const c3 = await browser.newContext();
  await signIn(await c3.newPage(), f3.owner);
  const user3 = await sessionData(c3);
  const grant = await fetch(
    `http://127.0.0.1:${ports.customer}/api/documents/${f3.document.id}/download`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + user3.accessToken, 'X-MotorOS-Tenant': f3.tenant },
    },
  );
  assert.equal(grant.status, 200);
  assert.equal((await fetch((await grant.json()).url)).status, 200);
  const f4 = JSON.parse(readFileSync('.runtime/m4-fixtures.json', 'utf8'));
  const opHeaders = {
    Authorization: 'Bearer ' + user3.accessToken,
    'X-MotorOS-Tenant': f3.tenant,
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  };
  const next = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) + 'T03:30:00Z';
  const booked = await fetch(`http://127.0.0.1:${ports.booking}/api/appointments`, {
    method: 'POST',
    headers: opHeaders,
    body: JSON.stringify({
      branchId: f3.omr.id,
      vehicleId: f4.lastAcceptance.vehicleId,
      customerId: f4.lastAcceptance.customerId,
      serviceCategoryId: '00000000-0000-0000-0000-000000000401',
      requestedStartTime: next,
      estimatedDurationMinutes: 30,
      customerComplaint: 'Synthetic container booking smoke',
      bookingSource: 'STAFF',
    }),
  });
  assert.equal(booked.status, 201);
  const a = await booked.json();
  const cancel = await fetch(`http://127.0.0.1:${ports.booking}/api/appointments/${a.id}/cancel`, {
    method: 'POST',
    headers: opHeaders,
    body: JSON.stringify({
      version: a.version,
      note: 'Synthetic container booking smoke complete',
    }),
  });
  assert.equal(cancel.status, 200);
  const photo = await fetch(
    `http://127.0.0.1:${ports.workorder}/api/work-orders/${f4.lastAcceptance.jobId}/photos/${f4.lastAcceptance.photoId}/download`,
    { headers: opHeaders },
  );
  assert.equal(photo.status, 200);
  const photoUrl = (await photo.json()).url;
  assert.equal((await fetch(photoUrl)).status, 200);
  assert.equal((await fetch(photoUrl.split('?')[0])).status, 403);
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${ports.workorder}/api/work-orders/${f4.lastAcceptance.jobId}/development-approval`,
        {
          method: 'POST',
          headers: opHeaders,
          body: JSON.stringify({
            version: 0,
            decision: 'APPROVE',
            reason: 'Container default must not simulate approval',
          }),
        },
      )
    ).status,
    403,
  );
  const f5 = JSON.parse(readFileSync('.runtime/m5-fixtures.json', 'utf8'));
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${ports.inventory}/api/parts/${f5.lastAcceptance.partId}`, {
        headers: opHeaders,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${ports.billing}/api/invoices/${f5.lastAcceptance.invoiceId}`, {
        headers: opHeaders,
      })
    ).status,
    200,
  );
  const invoicePdf = await fetch(
    `http://127.0.0.1:${ports.billing}/api/invoices/${f5.lastAcceptance.invoiceId}/pdf`,
    { headers: opHeaders },
  );
  assert.equal(invoicePdf.status, 200);
  const privatePdf = (await invoicePdf.json()).url;
  assert.equal((await fetch(privatePdf)).status, 200);
  assert.equal((await fetch(privatePdf.split('?')[0])).status, 403);
  writeFileSync(
    '.runtime/m6-container-results.json',
    JSON.stringify(
      {
        nonRootImages: 8,
        healthEndpoints: 8,
        realOidc: true,
        authenticatedServiceDelegation: true,
        crossBranchHistory: true,
        customerToWorkOrderTimeline: true,
        privateDocumentDownload: true,
        bookingReferenceDelegation: true,
        workshopPhotosPrivate: true,
        developmentApprovalDisabledByDefault: true,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: eight non-root service containers, real JWKS, delegated live authority and cross-branch history.',
  );
} finally {
  await browser.close();
  for (const name of created.reverse()) docker(['rm', '-f', name]);
}
