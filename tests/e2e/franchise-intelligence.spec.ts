import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, origin, select, signIn } from '../helpers/oidc.mjs';
import { completeDevelopmentJob } from '../helpers/workshop.mjs';

test('two franchise branches service one vehicle without crossing access boundaries', async ({
  browser,
}) => {
  test.skip(
    process.env.MOTOROS_TEST_FRANCHISE_LOCAL !== '1',
    'Requires synthetic tenants and local Mailpit',
  );
  test.setTimeout(180000);
  const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const owner = await browser.newContext({ baseURL: origin });
  const mechanic = await browser.newContext({ baseURL: origin });
  const outsider = await browser.newContext({ baseURL: origin });
  const headers = (tenant: string) => ({ Origin: origin, 'X-MotorOS-Expected-Tenant': tenant });

  async function request(path: string, method = 'GET', data?: object) {
    const res = await call(owner, path, { tenant: f.tenant, method, data });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  }

  try {
    await signIn(await owner.newPage(), f.owner);
    await select(owner, f.tenant);
    const directory = await request('tenant/branches?size=100');
    const tag = crypto.randomUUID().slice(0, 8);
    const customer = await request('customer/customers', 'POST', {
      name: 'Synthetic franchise customer ' + tag,
      email: 'franchise-' + tag + '@example.test',
      city: 'Chennai',
      country: 'India',
    });
    const vehicle = await request('customer/vehicles', 'POST', {
      customerId: customer.id,
      branchId: f.anna.id,
      registration: 'QA' + tag.toUpperCase(),
      make: 'Honda',
      model: 'City',
    });
    const branches = [];
    for (const seed of [
      { name: 'Adyar QA', branchCode: 'QA-ADYAR' },
      { name: 'Porur QA', branchCode: 'QA-PORUR' },
    ]) {
      const branch =
        directory.find((row: { branchCode: string }) => row.branchCode === seed.branchCode) ??
        (await request('tenant/branches', 'POST', { ...seed, city: 'Chennai' }));
      const job = await request('workorder/work-orders', 'POST', {
        branchId: branch.id,
        vehicleId: vehicle.id,
        customerId: customer.id,
        complaint: 'Synthetic franchise service at ' + branch.name,
      });
      const closed = await completeDevelopmentJob(owner, f.tenant, job);
      expect(closed.status).toBe('CLOSED');
      branches.push({ id: branch.id, name: branch.name, order: job.id });
    }

    await signIn(await mechanic.newPage(), f.employeeA);
    await select(mechanic, f.tenant);
    const summaryPath = '/api/ai/vehicles/' + vehicle.id + '/history-summary?branchId=';
    // A just-closed job can change the watermark while the summary is being built.
    let summary:
      { status: number; body: { title?: string; sourceReferences?: unknown[] } } | undefined;
    await expect
      .poll(
        async () => {
          const response = await mechanic.request.post(summaryPath + f.velachery.id, {
            headers: headers(f.tenant),
          });
          summary = { status: response.status(), body: await response.json() };
          return summary.status === 409 && /history changed/i.test(summary.body.title ?? '');
        },
        { timeout: 15000 },
      )
      .toBe(false);
    expect(summary!.status, summary!.body.title).toBe(200);
    expect(summary!.body.sourceReferences).toEqual(
      expect.arrayContaining(
        branches.map((branch) =>
          expect.objectContaining({ branch: branch.name, resourceId: branch.order }),
        ),
      ),
    );
    for (const branch of branches) {
      const denied = await mechanic.request.post(summaryPath + branch.id, {
        headers: headers(f.tenant),
      });
      expect(denied.status()).toBe(403);
    }
    await signIn(await outsider.newPage(), f.employeeB);
    await select(outsider, f.precisionTenant);
    const foreign = await outsider.request.post(summaryPath + f.velachery.id, {
      headers: headers(f.precisionTenant),
    });
    expect([403, 404]).toContain(foreign.status());

    await expect
      .poll(
        async () => {
          const report = await owner.request.post('/api/ai/analytics/query', {
            headers: headers(f.tenant),
            data: {
              question: 'Compare service volume by branch',
              branchIds: branches.map((branch) => branch.id),
            },
          });
          expect(report.status(), await report.text()).toBe(200);
          return (await report.json()).rows.map((row: { label: string }) => row.label).sort();
        },
        { timeout: 30000 },
      )
      .toEqual(branches.map((branch) => branch.name).sort());
  } finally {
    await Promise.all([owner.close(), mechanic.close(), outsider.close()]);
  }
});
