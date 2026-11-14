import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, origin, select, signIn } from '../helpers/oidc.mjs';

test('advisor turns evidence into a priced and editable Billing estimate', async ({ browser }) => {
  test.skip(
    process.env.MOTOROS_TEST_ESTIMATE_LOCAL !== '1',
    'Requires a synthetic local stack and Mailpit',
  );
  test.setTimeout(120000);
  const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const owner = await browser.newContext({ baseURL: origin });
  const other = await browser.newContext({ baseURL: origin });
  const page = await owner.newPage();
  const branchId = f.omr.id;
  const headers = { Origin: origin, 'X-MotorOS-Expected-Tenant': f.tenant };
  const tag = crypto.randomUUID().slice(0, 8);
  const name = 'Synthetic oil filter ' + tag;

  async function req(path: string, status = 200, method = 'GET', data?: object) {
    const response = await call(owner, path, { method, data, tenant: f.tenant });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  }

  try {
    await signIn(page, f.owner);
    await select(owner, f.tenant);
    const response = await call(owner, 'billing/billing/settings?branchId=' + branchId, {
      tenant: f.tenant,
    });
    const settings = response.ok()
      ? await response.json()
      : await req('billing/billing/settings', 200, 'PUT', {
          branchId,
          currency: 'INR',
          laborHourlyRate: '500',
          taxRate: '18',
          legalName: 'Synthetic Apex workshop',
          address: 'Synthetic local address',
          taxLabel: 'Test tax',
          version: 0,
        });
    const customer = await req('customer/customers', 201, 'POST', {
      name: 'Synthetic Estimate Customer ' + tag,
      email: 'm10-' + tag + '@example.test',
      country: 'India',
      city: 'Chennai',
    });
    const vehicle = await req('customer/vehicles', 201, 'POST', {
      customerId: customer.id,
      registration: 'M10' + tag.toUpperCase(),
      make: 'Honda',
      model: 'City',
      branchId,
    });
    const job = await req('workorder/work-orders', 201, 'POST', {
      branchId,
      vehicleId: vehicle.id,
      customerId: customer.id,
      complaint: 'Synthetic oil filter replacement',
    });
    const part = await req('inventory/parts', 200, 'POST', {
      sku: 'M10-' + tag,
      name,
      category: 'Filters',
      manufacturer: 'Synthetic manufacturer',
      currency: settings.currency,
      purchasePrice: '50',
      sellingPrice: '100',
      active: true,
    });
    await req('workorder/work-orders/' + job.id + '/parts', 200, 'POST', {
      description: name,
      quantity: 1,
    });

    await page.goto('/jobs/' + job.id);
    const panel = page.getByRole('region', { name: 'AI estimate assistant' });
    const generated = page.waitForResponse((r) => r.url().endsWith('/api/ai/estimates/draft'));
    await panel.getByRole('button', { name: 'Generate estimate draft with AI' }).click();
    const draftResponse = await generated;
    expect(draftResponse.status(), await draftResponse.text()).toBe(200);
    const draft = await draftResponse.json();
    expect(draft.catalogItemReferences).toEqual([part.id]);
    await panel.getByRole('checkbox', { name: 'Include ' + name }).check();
    await panel.getByLabel('Part quantity').fill('2');
    const applyPath = '/api/ai/estimates/drafts/' + draft.estimateDraftId + '/apply';
    const applied = page.waitForResponse((r) => r.url().endsWith(applyPath));
    await panel.getByRole('button', { name: 'Calculate and save Billing draft' }).click();
    const saved = await applied;
    expect(saved.status()).toBe(200);
    await page.waitForURL(/\/estimates\/[0-9a-f-]+$/);
    const estimate = await req('billing/estimates/' + page.url().split('/').at(-1));
    expect(estimate.status).toBe('DRAFT');
    expect(estimate.workOrderId).toBe(job.id);
    expect(Number(estimate.items[0].unitPrice)).toBe(100);
    expect(Number(estimate.total)).toBeCloseTo(200 * (1 + Number(settings.taxRate) / 100), 2);

    const same = await owner.request.post(applyPath, {
      headers,
      data: { items: [{ partId: part.id, description: name, quantity: '2' }], note: '' },
    });
    expect(same.status(), await same.text()).toBe(200);
    expect((await same.json()).id).toBe(estimate.id);

    await page.waitForURL('**/estimates/' + estimate.id);
    await page.getByRole('button', { name: 'Edit draft' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Quantity', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Recalculate and save' }).click();
    await expect(dialog).not.toBeVisible();
    const recalculated = await req('billing/estimates/' + estimate.id);
    expect(Number(recalculated.items[0].quantity)).toBe(3);
    expect(Number(recalculated.total)).toBeCloseTo(300 * (1 + Number(settings.taxRate) / 100), 2);
    expect(recalculated.version).toBeGreaterThan(estimate.version);
    const refresh = await owner.request.post('/api/ai/estimates/draft', {
      headers,
      data: { workOrderId: job.id, requestId: crypto.randomUUID() },
    });
    expect(refresh.status(), await refresh.text()).toBe(200);
    const fresh = await refresh.json();
    const update = await owner.request.post(
      '/api/ai/estimates/drafts/' + fresh.estimateDraftId + '/apply',
      {
        headers,
        data: {
          estimateId: estimate.id,
          version: recalculated.version,
          items: [{ partId: part.id, description: name, quantity: '3' }],
        },
      },
    );
    expect(update.status(), await update.text()).toBe(200);
    const updated = await update.json();
    expect(updated.id).toBe(estimate.id);
    expect(updated.version).toBeGreaterThan(recalculated.version);
    await page.reload();

    await page.getByRole('button', { name: 'Send to customer for approval' }).click();
    await dialog
      .getByLabel('Reason / scope explanation')
      .fill('Synthetic advisor reviewed the work and pricing');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await req('billing/estimates/' + estimate.id)).status).toBe(
      'PENDING_CUSTOMER_APPROVAL',
    );
    const bypass = await call(owner, 'billing/estimates/' + estimate.id + '/approve', {
      tenant: f.tenant,
      method: 'POST',
      data: { token: 'a'.repeat(43), decision: 'APPROVED', note: '' },
    });
    expect(bypass.status()).toBe(403);

    await signIn(await other.newPage(), f.employeeB);
    await select(other, f.precisionTenant);
    const denied = await other.request.get('/api/ai/estimates/drafts/' + draft.estimateDraftId, {
      headers: { 'X-MotorOS-Expected-Tenant': f.precisionTenant },
    });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain(part.id);

    const revised = await req('billing/estimates/' + estimate.id + '/revise', 200, 'POST', {
      version: (await req('billing/estimates/' + estimate.id)).version,
      note: 'Synthetic advisor created a new version',
    });
    expect(revised.revision).toBe(estimate.revision + 1);
    await page.goto('/estimates/' + revised.id);
    await page.getByLabel('Compare with revision ' + revised.revision).selectOption(estimate.id);
    await expect(
      page.getByRole('heading', { name: 'Revision ' + estimate.revision + ' · SUPERSEDED' }),
    ).toBeVisible();
  } finally {
    await other.close();
    await owner.close();
  }
});
