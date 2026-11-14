import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, select, signIn } from '../helpers/oidc.mjs';

const origin = 'http://127.0.0.1:3000';

test('mechanic retrieves an approved document in a private conversation', async ({ browser }) => {
  test.skip(
    process.env.MOTOROS_TEST_LOCAL_AI !== '1',
    'Requires synthetic fixtures and live inference',
  );
  test.setTimeout(120000);
  const fixtures = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const owner = await browser.newContext({ baseURL: origin });
  const mechanic = await browser.newContext({ baseURL: origin });
  const other = await browser.newContext({ baseURL: origin });
  const headers = { 'X-MotorOS-Expected-Tenant': fixtures.tenant, Origin: origin };
  let uploaded: { id: string; version: number } | undefined;
  try {
    const ownerPage = await owner.newPage();
    await signIn(ownerPage, fixtures.owner);
    await select(owner, fixtures.tenant);
    const order = await call(owner, 'workorder/work-orders', {
      method: 'POST',
      tenant: fixtures.tenant,
      data: {
        vehicleId: fixtures.vehicle.id,
        branchId: fixtures.velachery.id,
        complaint: 'Synthetic Copilot job for Velachery acceptance',
      },
    });
    expect(order.status()).toBe(201);
    const { id: jobId } = await order.json();
    await ownerPage.goto('/jobs/' + jobId);
    await ownerPage.getByRole('button', { name: /^copilot$/i }).click();
    await ownerPage.getByText('Manage approved workshop documents', { exact: true }).click();
    await ownerPage.getByLabel('Document title').fill('Synthetic accumulator SOP');
    await ownerPage.getByLabel('Document type').selectOption('sop');
    await ownerPage.getByLabel('PDF or text file').setInputFiles({
      name: 'synthetic-sop.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'For the fictional hydraulic accumulator intake, record the gauge reading before visual inspection.',
      ),
    });
    await ownerPage.getByLabel('Approved for Copilot and licensed for this use').check();
    const uploadedResponse = ownerPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/ai/documents') && response.request().method() === 'POST',
    );
    await ownerPage.getByRole('button', { name: 'Index document', exact: true }).click();
    const upload = await uploadedResponse;
    expect(upload.status()).toBe(200);
    uploaded = await upload.json();

    const page = await mechanic.newPage();
    await signIn(page, fixtures.employeeA);
    await select(mechanic, fixtures.tenant);
    await page.goto('/jobs/' + jobId);
    await page.getByRole('button', { name: /^copilot$/i }).click();
    await page
      .getByLabel('Ask about this job')
      .fill('What gauge reading is recorded in the hydraulic accumulator intake SOP?');
    const generatedResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/ai/copilot/chat'),
    );
    await page.getByRole('button', { name: 'Ask Copilot', exact: true }).click();
    const generated = await generatedResponse;
    expect(generated.status(), await generated.text()).toBe(200);
    const answer = await generated.json();
    expect(answer.turn.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceId: uploaded!.id, version: 1 })]),
    );
    await expect(page.getByText('Synthetic accumulator SOP', { exact: true })).toBeVisible();

    const history = `/api/ai/copilot/conversations/${answer.conversationId}?jobId=${jobId}`;
    expect((await owner.request.get(history, { headers })).status()).toBe(404);
    expect((await mechanic.request.get('/api/ai/documents', { headers })).status()).toBe(403);
    await signIn(await other.newPage(), fixtures.employeeB);
    await select(other, fixtures.precisionTenant);
    const denied = await other.request.get(history, {
      headers: { 'X-MotorOS-Expected-Tenant': fixtures.precisionTenant },
    });
    expect([403, 404]).toContain(denied.status());
    expect(await denied.text()).not.toContain('accumulator');

    expect(
      (
        await owner.request.delete(`/api/ai/documents/${uploaded!.id}?version=1`, { headers })
      ).status(),
    ).toBe(200);
    uploaded = undefined;
    const reread = await mechanic.request.get(history, { headers });
    expect(reread.status()).toBe(200);
    expect((await reread.json()).turns[0]).toMatchObject({
      sufficiency: 'insufficient',
      sources: [],
    });
  } finally {
    if (uploaded)
      await owner.request.delete(`/api/ai/documents/${uploaded.id}?version=${uploaded.version}`, {
        headers,
      });
    await Promise.all([owner.close(), mechanic.close(), other.close()]);
  }
});
