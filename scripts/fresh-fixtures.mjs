import { completeDevelopmentJob } from '../tests/helpers/workshop.mjs';
// Explicit development-only fixtures, created through actual OIDC and business APIs.
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createIdentity, signIn, select, call, origin } from '../tests/helpers/oidc.mjs';
if (process.env.MOTOROS_DEV_FIXTURES !== '1') throw new Error('Development fixture flag required');
if (
  existsSync('.runtime/m2-fixtures.json') &&
  JSON.parse(readFileSync('.runtime/m2-fixtures.json', 'utf8')).length === 2
) {
  console.log('Existing OIDC fixtures retained.');
} else {
  const browser = await chromium.launch();
  const accounts = [];
  async function json(response) {
    if (!response.ok()) throw new Error('Fixture API failed: ' + response.status());
    return response.json();
  }
  try {
    for (const [brand, places, make, model, registration] of [
      ['Apex Motorworks', ['Anna Nagar', 'OMR'], 'Hyundai', 'i20', 'FIXTURE-APEX'],
      ['Torque Collective', ['Velachery', 'Adyar'], 'Honda', 'City', 'FIXTURE-TORQUE'],
    ]) {
      const identity = await createIdentity(brand.startsWith('Apex') ? 'apex' : 'torque');
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, identity);
      const onboard = await json(
        await call(context, 'tenant/tenants', {
          method: 'POST',
          data: {
            name: brand + ' [fixture]',
            businessEmail: identity.email,
            primaryBranch: { name: places[0], branchCode: 'PRIMARY', city: 'Chennai' },
          },
        }),
      );
      const tenant = onboard.tenant.id;
      await select(context, tenant);
      const second = await json(
        await call(context, 'tenant/branches', {
          method: 'POST',
          tenant,
          data: { name: places[1], branchCode: 'SECOND', city: 'Chennai' },
        }),
      );
      const customer = await json(
        await call(context, 'customer/customers', {
          method: 'POST',
          tenant,
          data: { name: 'Synthetic Customer [fixture]', email: 'fixture@example.test', phone: '' },
        }),
      );
      const vehicle = await json(
        await call(context, 'customer/vehicles', {
          method: 'POST',
          tenant,
          data: { customerId: customer.id, registration, make, model },
        }),
      );
      let order = await json(
        await call(context, 'workorder/work-orders', {
          method: 'POST',
          tenant,
          data: {
            branchId: onboard.branch.id,
            vehicleId: vehicle.id,
            complaint: 'Scheduled maintenance — synthetic development fixture',
          },
        }),
      );
      order = await completeDevelopmentJob(context, tenant, order);
      await json(
        await call(context, 'workorder/work-orders', {
          method: 'POST',
          tenant,
          data: {
            branchId: onboard.branch.id,
            vehicleId: vehicle.id,
            complaint: 'Investigate steering vibration — synthetic fixture',
          },
        }),
      );
      const me = await (await context.request.get(origin + '/api/auth/me')).json();
      const account = {
        ...identity,
        brand,
        vehicleId: vehicle.id,
        branches: [onboard.branch, second],
        userId: me.user.id,
      };
      if (!accounts.length) {
        const extra = await json(
          await call(context, 'tenant/tenants', {
            method: 'POST',
            data: {
              name: 'Apex Fleet [fixture]',
              businessEmail: identity.email,
              primaryBranch: { name: 'Fleet Central', branchCode: 'FLEET', city: 'Chennai' },
            },
          }),
        );
        account.extraTenantId = extra.tenant.id;
      }
      accounts.push(account);
      await context.close();
    }
    mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/m2-fixtures.json', JSON.stringify(accounts, null, 2), { mode: 0o600 });
    console.log(
      'Created two isolated synthetic workshops through real OIDC and APIs. Credentials: ignored .runtime/m2-fixtures.json.',
    );
  } finally {
    await browser.close();
  }
}
