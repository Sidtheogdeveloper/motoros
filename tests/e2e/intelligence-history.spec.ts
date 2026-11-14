import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, select, signIn } from '../helpers/oidc.mjs';

const origin = 'http://127.0.0.1:3000';
const enabled = process.env.MOTOROS_TEST_LOCAL_AI === '1';
const hosted = process.env.MOTOROS_TEST_AI_PROVIDER === 'nvidia';

test('authorized mechanic can summarize completed history and another brand is denied', async ({
  page,
  context,
  browser,
}) => {
  test.skip(
    !enabled,
    'Requires the local stack, existing synthetic M3 fixtures and a configured inference provider',
  );
  test.setTimeout(120000);
  const fixtures = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const additional = JSON.parse(readFileSync('.runtime/m8-fixtures.json', 'utf8'));
  expect(additional.vehicleId).toBe(fixtures.vehicle.id);
  await signIn(page, fixtures.employeeA);
  await select(context, fixtures.tenant);
  await page.goto('/vehicles/' + fixtures.vehicle.id);
  await page.getByRole('button', { name: 'Intelligence', exact: true }).click();
  const panel = page.getByRole('heading', { name: 'Vehicle health & service history' });
  await expect(panel).toBeVisible();
  const branch = await page.getByLabel('Viewing from branch').inputValue();
  const summaryResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/history-summary?') && response.request().method() === 'POST',
    { timeout: 50000 },
  );
  await page.getByRole('button', { name: /Generate AI summary|Check for updated summary/ }).click();
  const summary = await summaryResponse;
  expect(summary.status()).toBe(200);
  const result = await summary.json();
  expect(result.modelIdentifier).toMatch(
    process.env.MOTOROS_TEST_AI_PROVIDER === 'fixture'
      ? /^fixture\/local-no-network$/
      : hosted
        ? /^nim\/nvidia\/nemotron-3-ultra-550b-a55b$/
        : /^ollama\//,
  );
  expect(result.sourceReferences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ resourceId: fixtures.order.id, branch: 'Anna Nagar' }),
      expect.objectContaining({ resourceId: additional.omrOrderId, branch: 'OMR' }),
    ]),
  );
  expect(result.response.highlights.length).toBeGreaterThan(0);
  const sourceLink = page.locator(`a[href$="#service-record-${fixtures.order.id}"]`);
  await expect(sourceLink).toBeVisible();
  const sourcePage = await context.newPage();
  try {
    await sourcePage.goto((await sourceLink.getAttribute('href'))!);
    await expect(sourcePage.locator(`#service-record-${fixtures.order.id}`)).toBeVisible();
  } finally {
    await sourcePage.close();
  }

  await page.getByRole('button', { name: 'Helpful', exact: true }).click();
  await expect(page.getByText('Feedback saved.')).toBeVisible();
  const summaryPath = `/api/ai/vehicles/${fixtures.vehicle.id}/history-summaries?branchId=${branch}`;
  const tenantHeaders = { 'X-MotorOS-Expected-Tenant': fixtures.tenant };
  const saved = await context.request.get(summaryPath, { headers: tenantHeaders });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).summaries[0]).toMatchObject({
    summaryId: result.summaryId,
    helpful: true,
    usageMetadata: { cacheHit: true },
  });

  const wrongBranch = await context.request.get(summaryPath.replace(branch, fixtures.omr.id), {
    headers: tenantHeaders,
  });
  expect(wrongBranch.status()).toBe(403);

  const other = await browser.newContext({ baseURL: origin });
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, fixtures.employeeB);
    await select(other, fixtures.precisionTenant);
    const denied = await other.request.get(
      `/api/ai/vehicles/${fixtures.vehicle.id}/history-summaries?branchId=${branch}`,
      { headers: { 'X-MotorOS-Expected-Tenant': fixtures.precisionTenant } },
    );
    expect([403, 404]).toContain(denied.status());
    expect(await denied.text()).not.toContain(fixtures.order.id);
  } finally {
    await other.close();
  }

  const owner = await browser.newContext({ baseURL: origin });
  try {
    await signIn(await owner.newPage(), fixtures.owner);
    await select(owner, fixtures.tenant);
    const vehiclePath = 'customer/vehicles/' + fixtures.vehicle.id;
    const profile = await call(owner, vehiclePath, { tenant: fixtures.tenant });
    expect(profile.status()).toBe(200);
    const { customerId, registration, make, model, vin, year, fuelType, status, version } =
      await profile.json();
    // Color is not part of the summary snapshot. This change must invalidate via VehicleUpdated.
    const edit = await call(owner, vehiclePath, {
      method: 'PATCH',
      tenant: fixtures.tenant,
      data: {
        customerId,
        registration,
        make,
        model,
        vin,
        year,
        fuelType,
        status,
        version,
        branchId: fixtures.anna.id,
        color: 'Acceptance-' + Date.now(),
      },
    });
    expect(edit.status()).toBe(200);
    await expect
      .poll(
        async () => {
          const response = await context.request.get(summaryPath, { headers: tenantHeaders });
          if (response.status() !== 200) return response.status();
          return (await response.json()).summaries.length;
        },
        { timeout: 20000 },
      )
      .toBe(0);
    const stale = await context.request.post(
      `/api/ai/vehicles/${fixtures.vehicle.id}/history-feedback?branchId=${branch}&summaryId=${result.summaryId}&helpful=false`,
      { headers: { ...tenantHeaders, Origin: origin } },
    );
    expect(stale.status()).toBe(409);
  } finally {
    await owner.close();
  }
});
