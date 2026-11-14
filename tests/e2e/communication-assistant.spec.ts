import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, mail, origin, select, signIn } from '../helpers/oidc.mjs';

test('staff reviews a verified Tamil draft and Notification delivers it to Mailpit', async ({
  browser,
}) => {
  test.skip(
    process.env.MOTOROS_TEST_COMMUNICATION_LOCAL !== '1',
    'Requires the isolated local Mailpit stack and M3 fixtures',
  );
  test.setTimeout(120000);
  const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  const owner = await browser.newContext({ baseURL: origin });
  const other = await browser.newContext({ baseURL: origin });
  const mechanic = await browser.newContext({ baseURL: origin });
  const page = await owner.newPage();
  const branchId = f.omr.id;
  const tag = crypto.randomUUID().slice(0, 8);
  const email = 'm12-' + tag + '@example.test';
  const name = 'Synthetic M12 ' + tag;
  const registration = 'M12' + tag.toUpperCase();
  const prefix = '/api/ai/communications/';
  const headers = { Origin: origin, 'X-MotorOS-Expected-Tenant': f.tenant };

  async function req(path: string, status = 200, method = 'GET', data?: object) {
    const response = await call(owner, path, { tenant: f.tenant, method, data });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  }

  async function pref(customerId: string, enabled: boolean) {
    const path = 'customer/communication-preferences/' + customerId;
    const current = await req(path);
    return req(path, 200, 'PUT', {
      version: current.version,
      emailEnabled: enabled,
      smsEnabled: false,
      whatsappEnabled: false,
      operationalEnabled: true,
      promotionalEnabled: false,
      preferredLanguage: 'ta',
      consentNote: 'Synthetic fixture consent for local Mailpit acceptance',
    });
  }

  try {
    await signIn(page, f.owner);
    await select(owner, f.tenant);
    const customer = await req('customer/customers', 201, 'POST', {
      name,
      email,
      country: 'India',
      city: 'Chennai',
    });
    const vehicle = await req('customer/vehicles', 201, 'POST', {
      branchId,
      customerId: customer.id,
      registration,
      make: 'Honda',
      model: 'City',
    });
    await pref(customer.id, true);
    const intake = await req('workorder/check-ins', 201, 'POST', {
      branchId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      odometerKilometers: 42000,
      complaints: 'Synthetic tyre inspection request',
      serviceRequested: 'Tyre inspection',
      accessories: [],
    });

    const input = {
      branchId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      resourceId: intake.workOrderId,
      purpose: 'VEHICLE_CHECKED_IN',
      language: 'ta',
      channel: 'EMAIL',
      tone: 'FRIENDLY',
    };
    const mismatch = await owner.request.post(prefix + 'draft', {
      headers,
      data: { ...input, vehicleId: f.vehicle.id },
    });
    expect(mismatch.status(), await mismatch.text()).toBe(409);
    const wrongCustomer = await owner.request.post(prefix + 'draft', {
      headers,
      data: { ...input, customerId: crypto.randomUUID() },
    });
    expect(wrongCustomer.status()).toBe(409);

    await page.goto('/notifications?branch=' + branchId);
    await page.getByRole('button', { name: 'AI message composer', exact: true }).click();
    const composer = page.getByRole('region', { name: 'AI message composer' });
    await composer.getByLabel('Message type').selectOption(input.purpose);
    await composer.getByLabel('Source record').selectOption(intake.workOrderId);
    await composer.getByLabel('Language', { exact: true }).selectOption('ta');
    const result = page.waitForResponse((response) => response.url().endsWith(prefix + 'draft'));
    await composer.getByRole('button', { name: 'Generate message draft' }).click();
    const generated = await result;
    expect(generated.status(), await generated.text()).toBe(200);
    const draft = await generated.json();
    expect(draft.verifiedFacts).toMatchObject({
      customerName: name,
      vehicleRegistration: registration,
    });
    expect(draft.body).toContain(registration);
    expect(draft.body).toMatch(/[\u0B80-\u0BFF]/);
    expect(draft.verifiedFacts).not.toHaveProperty('amount');
    expect(JSON.stringify(draft)).not.toContain(email);
    const path = prefix + 'drafts/' + draft.messageDraftId;
    const beforeApproval = await owner.request.post(path + '/send', {
      headers,
      data: { version: draft.version, confirmed: true },
    });
    expect(beforeApproval.status()).toBe(409);

    const preview = composer.getByRole('region', { name: 'Message preview' });
    await preview.getByLabel('I reviewed this exact message').check();
    await preview.getByRole('button', { name: 'Approve draft' }).click();
    await expect(preview.getByRole('button', { name: 'Send approved message' })).toBeVisible();

    await preview.getByLabel('Message tone').selectOption('FRIENDLY');
    await preview.getByRole('button', { name: 'Save message edits' }).click();
    await expect(preview.getByRole('button', { name: 'Approve draft' })).toBeVisible();
    await preview.getByLabel('I reviewed this exact message').check();
    await preview.getByRole('button', { name: 'Approve draft' }).click();
    await expect(preview.getByRole('button', { name: 'Send approved message' })).toBeVisible();
    const list = await owner.request.get(prefix + 'drafts?branchId=' + branchId, { headers });
    const approved = (await list.json()).drafts.find(
      (row: { messageDraftId: string }) => row.messageDraftId === draft.messageDraftId,
    );
    await pref(customer.id, false);
    const optedOut = await owner.request.post(path + '/send', {
      headers,
      data: { version: approved.version, confirmed: true },
    });
    expect(optedOut.status(), await optedOut.text()).toBe(409);
    await pref(customer.id, true);

    await preview.getByLabel('Send this approved message to the verified recipient').check();
    const sentResponse = page.waitForResponse((response) =>
      response.url().endsWith(path + '/send'),
    );
    await preview.getByRole('button', { name: 'Send approved message' }).click();
    const sent = await sentResponse;
    expect(sent.status(), await sent.text()).toBe(200);
    const retry = await owner.request.post(path + '/send', {
      headers,
      data: { version: approved.version, confirmed: true },
    });
    expect(retry.status(), await retry.text()).toBe(200);
    expect((await retry.json()).messageDraftId).toBe(draft.messageDraftId);

    const first = await mail(email, approved.subject);
    // The automatic check-in notice can have the same subject. Identify the staff-approved copy.
    const message = first.Text.includes(registration)
      ? first
      : await mail(email, approved.subject, first.ID);
    expect(message.Text).toContain(registration);
    expect(message.Text).toContain('அன்புள்ள ' + name);
    await expect
      .poll(async () => {
        const history = await req(
          'notification/notifications?branchId=' + branchId + '&customerId=' + customer.id,
        );
        return history.content
          .filter((row: { id: string }) => row.id === draft.messageDraftId)
          .map((row: { status: string }) => row.status);
      })
      .toEqual(['SENT']);

    await signIn(await mechanic.newPage(), f.employeeA);
    await select(mechanic, f.tenant);
    expect(
      (
        await mechanic.request.post(path + '/send', {
          headers,
          data: { version: approved.version, confirmed: true },
        })
      ).status(),
    ).toBe(404);
    await signIn(await other.newPage(), f.precisionOwner);
    await select(other, f.precisionTenant);
    const foreign = await other.request.post(path + '/send', {
      headers: { ...headers, 'X-MotorOS-Expected-Tenant': f.precisionTenant },
      data: { version: approved.version, confirmed: true },
    });
    expect(foreign.status()).toBe(404);
  } finally {
    await Promise.all([owner.close(), other.close(), mechanic.close()]);
  }
});
