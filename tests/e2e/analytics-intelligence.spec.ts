import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, createIdentity, invitationMail, origin, select, signIn } from '../helpers/oidc.mjs';

test('owners and assigned managers can query scoped projections, inspect charts, and export', async ({
  browser,
}) => {
  test.skip(
    process.env.MOTOROS_TEST_ANALYTICS_LOCAL !== '1',
    'Requires the isolated Mailpit stack and synthetic M3/M8 fixtures',
  );
  test.setTimeout(120000);
  const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const owner = await browser.newContext({ baseURL: origin, acceptDownloads: true });
  const manager = await browser.newContext({ baseURL: origin });
  const mechanic = await browser.newContext({ baseURL: origin });
  const other = await browser.newContext({ baseURL: origin });
  const page = await owner.newPage();
  const end = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10);
  const headers = (tenant: string) => ({ Origin: origin, 'X-MotorOS-Expected-Tenant': tenant });
  const query = '/api/ai/analytics/query';
  try {
    await signIn(page, f.owner);
    await select(owner, f.tenant);
    await page.goto('/reporting');
    const workspace = page.getByRole('region', { name: 'Analytics Intelligence' });
    await expect(workspace).toBeVisible();
    await workspace
      .getByLabel('Ask a business question')
      .fill('Compare service volume across all branches');
    await workspace.getByLabel('Start date (UTC)').fill(start);
    await workspace.getByLabel('End date (exclusive)').fill(end);
    const answered = page.waitForResponse((response) => response.url().endsWith(query));
    await workspace.getByRole('button', { name: 'Ask Analytics', exact: true }).click();
    const response = await answered;
    expect(response.status(), await response.text()).toBe(200);
    const data = await response.json();
    expect(data.spec.metric).toBe('completed_work_orders');
    expect(data.spec.branchIds).toEqual(
      expect.arrayContaining([f.anna.id, f.omr.id, f.velachery.id]),
    );
    expect(data.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: f.omr.id, label: 'OMR' })]),
    );
    const projection = await call(
      owner,
      'analytics/analytics/metrics?metric=completed_work_orders&group=branch&start=' +
        start +
        '&end=' +
        end,
      { tenant: f.tenant },
    );
    expect(projection.status(), await projection.text()).toBe(200);
    const actual = await projection.json();
    expect(data.rows.map((row: { key: string; value: string }) => [row.key, row.value])).toEqual(
      actual.rows.map((row: { label: string; value: string }) => [row.label, row.value]),
    );
    const answer = workspace.getByRole('region', { name: 'Analytics answer' });
    await expect(answer.getByRole('img', { name: 'Comparison bar chart' })).toBeVisible();
    await answer.getByLabel('Inspect a chart value').selectOption({ label: 'OMR' });
    const omr = data.rows.find((row: { key: string }) => row.key === f.omr.id);
    expect(Number(omr.value)).toBeGreaterThan(0);
    await expect(answer.getByRole('row', { name: new RegExp('OMR ' + omr.value) })).toBeVisible();

    const downloaded = page.waitForEvent('download');
    await answer.getByRole('button', { name: 'Export results as CSV' }).click();
    const csv = await downloaded;
    expect(csv.suggestedFilename()).toBe('motoros-completed_work_orders.csv');
    expect(readFileSync((await csv.path())!, 'utf8')).toContain('"OMR",' + omr.value + ',"count"');

    await answer.getByRole('button', { name: 'By month', exact: true }).click();
    await expect(answer.getByRole('img', { name: 'Monthly line chart' })).toBeVisible();
    await workspace.getByText('My query history', { exact: true }).click();
    await expect(
      workspace.getByRole('button', { name: 'Compare service volume across all branches' }).last(),
    ).toBeVisible();

    const identity = await createIdentity('m11-branch-manager');
    const invite = await call(owner, 'tenant/tenants/' + f.tenant + '/invitations', {
      tenant: f.tenant,
      method: 'POST',
      data: { email: identity.email, role: 'BRANCH_MANAGER', branchIds: [f.omr.id] },
    });
    expect(invite.status(), await invite.text()).toBe(201);
    const invitation = await invitationMail(identity.email);
    await signIn(await manager.newPage(), identity);
    const accept = await call(manager, 'tenant/invitations/accept', {
      method: 'POST',
      data: { token: invitation.token },
    });
    expect(accept.status(), await accept.text()).toBe(200);
    await select(manager, f.tenant);
    const scoped = await manager.request.post(query, {
      headers: headers(f.tenant),
      data: { question: 'Compare service volume across all branches', start, end },
    });
    expect(scoped.status(), await scoped.text()).toBe(200);
    expect((await scoped.json()).spec.branchIds).toEqual([f.omr.id]);
    const deniedBranch = await manager.request.post(query, {
      headers: headers(f.tenant),
      data: { question: 'Service volume', branchIds: [f.anna.id], start, end },
    });
    expect(deniedBranch.status()).toBe(403);

    await signIn(await mechanic.newPage(), f.employeeA);
    await select(mechanic, f.tenant);
    const deniedRole = await mechanic.request.post(query, {
      headers: headers(f.tenant),
      data: { question: 'Show revenue' },
    });
    expect(deniedRole.status()).toBe(403);

    await signIn(await other.newPage(), f.precisionOwner);
    await select(other, f.precisionTenant);
    const foreign = await other.request.post(query, {
      headers: headers(f.precisionTenant),
      data: { question: 'Service volume', branchIds: [f.omr.id], start, end },
    });
    expect(foreign.status()).toBe(403);
    const hidden = await other.request.get('/api/ai/analytics/query-history', {
      headers: headers(f.precisionTenant),
    });
    expect(hidden.status()).toBe(200);
    expect((await hidden.json()).queries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: data.queryId })]),
    );
  } finally {
    await Promise.all([owner.close(), manager.close(), mechanic.close(), other.close()]);
  }
});
