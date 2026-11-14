import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { call, select, signIn } from '../tests/helpers/oidc.mjs';
import { completeDevelopmentJob } from '../tests/helpers/workshop.mjs';
import { loadEnv } from './env.mjs';

const env = loadEnv();
if (process.env.MOTOROS_DEV_FIXTURES !== '1' || env.IDENTITY_SMTP_PROVIDER === 'gmail')
  throw new Error('Use an isolated Mailpit stack with development fixtures enabled.');

const fixtures = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
const complaint = 'OMR completed oil service [M8 fixture]';
const browser = await chromium.launch();

async function json(response) {
  if (!response.ok()) throw new Error('Milestone 8 fixture request failed: ' + response.status());
  return response.json();
}

try {
  const owner = await browser.newContext();
  await signIn(await owner.newPage(), fixtures.owner);
  await select(owner, fixtures.tenant);
  const history = await json(
    await call(
      owner,
      `customer/vehicles/${fixtures.vehicle.id}/timeline?branchId=${fixtures.omr.id}&size=50`,
      { tenant: fixtures.tenant },
    ),
  );
  let visit = history.content.find(
    (item) => item.branchId === fixtures.omr.id && item.summary === complaint,
  );
  if (!visit) {
    const order = await json(
      await call(owner, 'workorder/work-orders', {
        method: 'POST',
        tenant: fixtures.tenant,
        data: { vehicleId: fixtures.vehicle.id, branchId: fixtures.omr.id, complaint },
      }),
    );
    visit = await completeDevelopmentJob(owner, fixtures.tenant, order);
  }
  writeFileSync(
    '.runtime/m8-fixtures.json',
    JSON.stringify({
      vehicleId: fixtures.vehicle.id,
      omrOrderId: visit.id,
    }),
    { mode: 0o600 },
  );
  console.log('Prepared the completed synthetic OMR visit.');
} finally {
  await browser.close();
}
