import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const origin = process.env.MOTOROS_SMOKE_ORIGIN;
const f = JSON.parse(process.env.MOTOROS_SMOKE_CONTEXT || '{}');
if (
  !origin?.startsWith('https://') ||
  f.synthetic !== true ||
  !f.apex?.tenantId ||
  !f.precision?.tenantId ||
  !f.unauthorizedBranchId ||
  !f.bookingInput ||
  f.velachery?.tenantId !== f.apex.tenantId ||
  f.apex.tenantId === f.precision.tenantId
)
  throw new Error('Complete isolated synthetic staging fixture context required');
const browser = await chromium.launch();
let checks = 0;
try {
  async function login(user) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(origin + '/login');
    await page.getByRole('link', { name: 'Sign in securely' }).click();
    await page.locator('input[name=username]:visible').fill(user.email);
    await page.locator('input[name=password]:visible').fill(user.password);
    await page
      .locator('input[name=signInSubmitButton]:visible,button[type=submit]:visible')
      .first()
      .click();
    await page.waitForURL(origin + '/');
    checks++;
    const selected = await context.request.post(origin + '/api/context', {
      headers: { Origin: origin },
      data: { tenantId: user.tenantId },
    });
    assert.equal(selected.status(), 200);
    checks++;
    return { context, page };
  }
  const a = await login(f.apex),
    b = await login(f.precision),
    crossBranch = await login(f.velachery);
  async function api(session, tenant, path, method = 'GET', data) {
    return session.context.request.fetch(origin + '/api/backend/' + path, {
      method,
      data,
      headers: {
        Origin: origin,
        'X-MotorOS-Expected-Tenant': tenant,
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
  }
  assert.equal((await a.context.request.get(origin + '/health')).status(), 200);
  checks++;
  for (const path of [
    `tenant/me/memberships`,
    `customer/customers/${f.customerId}`,
    `customer/vehicles/${f.vehicleId}`,
    `customer/vehicles/${f.vehicleId}/timeline`,
    `inventory/parts?branchId=${f.branchId}`,
    `billing/estimates?branchId=${f.branchId}`,
    `notification/notifications?branchId=${f.branchId}`,
    `analytics/analytics/branch?branchId=${f.branchId}`,
  ]) {
    assert.equal((await api(a, f.apex.tenantId, path)).status(), 200);
    checks++;
  }
  for (const path of [
    `customer/vehicles/${f.vehicleId}`,
    `workorder/work-orders/${f.workOrderId}`,
    `customer/documents/${f.documentId}/download`,
  ]) {
    assert.ok([403, 404].includes((await api(b, f.precision.tenantId, path)).status()));
    checks++;
  }
  for (const path of [
    `customer/vehicles/${f.vehicleId}`,
    `customer/vehicles/${f.vehicleId}/timeline`,
  ]) {
    assert.equal((await api(crossBranch, f.apex.tenantId, path)).status(), 200);
    checks++;
  }
  assert.ok(
    [403, 404].includes(
      (
        await api(
          crossBranch,
          f.apex.tenantId,
          `booking/appointments?branchId=${f.unauthorizedBranchId}`,
        )
      ).status(),
    ),
  );
  checks++;
  if (process.env.MOTOROS_SMOKE_READ_ONLY !== 'true') {
    let start;
    for (let day = 1; day <= 14 && !start; day++) {
      for (const hour of [4, 6, 8, 10]) {
        const candidate = new Date(Date.now() + day * 86400000);
        candidate.setUTCHours(hour, 0, 0, 0);
        const response = await api(
          a,
          f.apex.tenantId,
          `booking/appointments/availability?branchId=${f.branchId}&startsAt=${encodeURIComponent(candidate.toISOString())}&durationMinutes=${f.bookingInput.estimatedDurationMinutes}`,
        );
        if (response.ok() && (await response.json()).available) {
          start = candidate.toISOString();
          break;
        }
      }
    }
    assert.ok(start, 'A real available synthetic branch slot is required');
    const baseline = await (
      await api(a, f.apex.tenantId, `analytics/analytics/branch?branchId=${f.branchId}`)
    ).json();
    const confirmedBefore = Number(baseline.booking?.[0]?.confirmed || 0);
    const booking = await api(a, f.apex.tenantId, 'booking/appointments', 'POST', {
      ...f.bookingInput,
      branchId: f.branchId,
      customerId: f.customerId,
      vehicleId: f.vehicleId,
      requestedStartTime: start,
    });
    assert.equal(booking.status(), 201);
    const appointment = await booking.json();
    checks++;
    assert.equal(
      (await api(a, f.apex.tenantId, 'booking/appointments/' + appointment.id)).status(),
      200,
    );
    checks++;
    const confirmation = await api(
      a,
      f.apex.tenantId,
      `booking/appointments/${appointment.id}/confirm`,
      'POST',
      { version: appointment.version, note: 'Authorized synthetic cloud smoke' },
    );
    assert.equal(confirmation.status(), 200);
    checks++;
    const job = await api(a, f.apex.tenantId, 'workorder/work-orders', 'POST', {
      branchId: f.branchId,
      vehicleId: f.vehicleId,
      complaint: 'Authorized synthetic staging smoke',
    });
    assert.equal(job.status(), 201);
    checks++;
    const createdJob = await job.json();
    assert.equal(
      (await api(a, f.apex.tenantId, 'workorder/work-orders/' + createdJob.id)).status(),
      200,
    );
    checks++;
    const doc = await api(a, f.apex.tenantId, `customer/documents/${f.documentId}/download`);
    assert.equal(doc.status(), 200);
    const link = await doc.json();
    assert.equal((await a.context.request.get(link.url)).status(), 200);
    checks++;
    // Poll authoritative delivery and projection state; provider acceptance is not recipient reading.
    for (let i = 0; i < 60; i++) {
      const history = await (
        await api(a, f.apex.tenantId, `notification/notifications?branchId=${f.branchId}`)
      ).json();
      if (
        history.content?.some((n) => n.relatedResourceId === appointment.id && n.status === 'SENT')
      ) {
        checks++;
        break;
      }
      if (i === 59)
        throw new Error('Confirmed appointment notification did not reach provider acceptance');
      await new Promise((r) => setTimeout(r, 2000));
    }
    for (let i = 0; i < 60; i++) {
      const projection = await (
        await api(a, f.apex.tenantId, `analytics/analytics/branch?branchId=${f.branchId}`)
      ).json();
      if (
        Number(projection.booking?.[0]?.confirmed || 0) >= confirmedBefore + 1 &&
        projection.freshness?.projectedAt
      ) {
        checks++;
        break;
      }
      if (i === 59) throw new Error('Booking projection did not converge');
      await new Promise((r) => setTimeout(r, 2000));
    }
    const current = await (
      await api(a, f.apex.tenantId, 'booking/appointments/' + appointment.id)
    ).json();
    assert.equal(
      (
        await api(a, f.apex.tenantId, `booking/appointments/${appointment.id}/cancel`, 'POST', {
          version: current.version,
          note: 'Synthetic cloud acceptance cleanup',
        })
      ).status(),
      200,
    );
    checks++;
  }
  // Projection acceptance is checked against a branch counter and timestamp in the dedicated synthetic tenant.
  // Five-minute Cognito access tokens expire; the same server-held session must refresh.
  // No tokens, browser storage, traces or screenshots leave this process.
  const refreshAt = Date.now() + 320000;
  while (Date.now() < refreshAt)
    await new Promise((r) => setTimeout(r, Math.min(10000, refreshAt - Date.now())));
  assert.equal((await a.context.request.get(origin + '/api/auth/me')).status(), 200);
  checks++;
  const cookie = (await a.context.cookies()).find((c) => c.name === 'motoros-session');
  assert.ok(cookie?.secure && cookie.httpOnly);
  checks++;
  await a.page.goto(origin + '/');
  assert.ok(await a.page.getByRole('combobox', { name: 'Active brand' }).isVisible());
  checks++;
  const logout = await a.context.request.post(origin + '/api/auth/logout', {
    headers: { Origin: origin },
  });
  assert.equal(logout.status(), 200);
  const target = (await logout.json()).logoutUrl;
  await a.page.goto(target);
  await a.page.waitForURL(origin + '/login');
  checks++;
  console.log(
    `Cloud browser/API smoke passed: ${checks} checks; no screenshots, traces or credentials recorded.`,
  );
} finally {
  await browser.close();
}
