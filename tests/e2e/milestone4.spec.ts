import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { signIn, select, call } from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
const ops = JSON.parse(readFileSync('.runtime/m4-fixtures.json', 'utf8'));
test('booking to intake, technician inspection, authorized repair and separate quality review', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await signIn(page, f.owner);
  await select(context, f.tenant);
  const response = await call(context, 'customer/vehicles/' + ops.lastAcceptance.vehicleId, {
    tenant: f.tenant,
  });
  const vehicle = await response.json();
  const registration = vehicle.registration;
  for (let cleanupPage = 0; cleanupPage < 100; cleanupPage++) {
    const prior = await call(
      context,
      'booking/appointments?branchId=' + f.omr.id + '&size=100&page=' + cleanupPage,
      { tenant: f.tenant },
    ).then((r) => r.json());
    for (const a of prior.content || []) {
      if (!a.customerComplaint.startsWith('Browser workshop acceptance')) continue;
      if (['REQUESTED', 'CONFIRMED'].includes(a.appointmentStatus) && !a.checkInState) {
        const cancel = await call(context, 'booking/appointments/' + a.id + '/cancel', {
          tenant: f.tenant,
          method: 'POST',
          data: { version: a.version, note: 'Clean up incomplete synthetic browser attempt' },
        });
        expect(cancel.ok()).toBe(true);
      } else if (a.appointmentStatus === 'CHECKED_IN')
        await call(context, 'booking/appointments/' + a.id + '/reconcile', {
          tenant: f.tenant,
          method: 'POST',
          data: {},
        });
    }

    if (cleanupPage + 1 >= prior.totalPages) break;
  }

  await page.goto('/appointments');
  await page.getByRole('combobox', { name: 'Acting branch', exact: true }).selectOption(f.omr.id);
  await page.getByRole('button', { name: 'New appointment', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Search customers' }).fill('M4 acceptance customer');
  await dialog.locator('select[name=customerId]').selectOption(ops.lastAcceptance.customerId);
  await dialog.getByRole('textbox', { name: 'Search vehicles' }).fill(registration);
  await dialog.locator('select[name=vehicleId]').selectOption(vehicle.id);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel('Start (Asia/Kolkata)').fill(tomorrow + 'T10:00');
  await dialog.getByLabel('Duration in minutes').fill('45');
  const complaint = 'Browser workshop acceptance ' + Date.now();
  await dialog.getByLabel('Customer complaint').fill(complaint);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('article')
    .filter({ hasText: complaint })
    .getByRole('button', { name: 'Booking detail' })
    .click();
  await page.getByRole('button', { name: 'Confirm appointment', exact: true }).click();
  await page.getByRole('link', { name: 'Check in vehicle', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Acting branch', exact: true })).toHaveValue(
    f.omr.id,
  );
  await page.getByLabel('Current odometer (km)').fill('16000');
  await page.getByLabel('Customer complaints', { exact: true }).fill(complaint);
  await page.getByLabel('Service requested', { exact: true }).fill('Inspect and service vehicle');
  await page.getByLabel('Existing damage observations').fill('No additional visible damage');
  await page.getByLabel('Accessories and belongings').fill('Spare wheel, tool kit');
  await page.getByRole('button', { name: 'Complete vehicle check-in' }).click();
  await expect(page.getByRole('heading', { name: 'Vehicle intake saved' })).toBeVisible();
  await page.getByRole('link', { name: 'Open job card and attach intake photos' }).click();
  await expect(page.getByRole('button', { name: 'Assign technician', exact: true })).toBeVisible();
  const jobUrl = page.url();
  await page.getByRole('button', { name: 'Assign technician', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Technician', exact: true })
    .selectOption(ops.lastAcceptance.technicianId);
  await page.getByLabel('Assignment reason').fill('OMR mechanic for browser workflow');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  async function move(status: string) {
    await page.getByRole('button', { name: 'Change job status' }).click();
    await page.getByRole('dialog').getByLabel('Next status').selectOption(status);
    await page
      .getByRole('dialog')
      .getByLabel('Reason / status notes')
      .fill('Browser acceptance ' + status);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await move('INSPECTION');
  const mechanic = await browser.newContext();
  const mp = await mechanic.newPage();
  mp.setDefaultTimeout(15000);
  await signIn(mp, ops.technician);
  await select(mechanic, f.tenant);
  await mp.goto(jobUrl);
  await mp.getByRole('button', { name: 'inspection', exact: true }).click();
  await mp.getByRole('button', { name: 'Start inspection', exact: true }).click();
  for (const category of [
    'Engine',
    'Brakes',
    'Tires',
    'Suspension',
    'Steering',
    'Battery and electrical',
    'Fluids',
    'Lights',
    'Air conditioning',
    'Exterior condition',
    'Interior condition',
  ])
    await mp
      .getByRole('combobox', { name: category + ' condition', exact: true })
      .selectOption('GOOD');
  await mp.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(mp.getByRole('button', { name: 'Save checklist' })).toBeEnabled();
  await mp.getByRole('button', { name: 'Complete saved inspection' }).click();
  await expect(mp.getByText('completed', { exact: true }).first()).toBeVisible();
  await page.reload();
  await move('ESTIMATE_PENDING');
  await move('AWAITING_APPROVAL');
  await page.getByRole('button', { name: 'Development approval simulation', exact: true }).click();
  await page.getByLabel('Manager reason').fill('Browser local development simulation only');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await move('IN_PROGRESS');
  await page.getByRole('button', { name: 'tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Add repair task', exact: true }).click();
  await page.getByLabel('Task description', { exact: true }).fill('Browser synthetic service task');
  await page.getByLabel('Task category', { exact: true }).fill('GENERAL');
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Technician', exact: true })
    .selectOption(ops.lastAcceptance.technicianId);
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await mp.reload();
  await mp.getByRole('button', { name: 'tasks', exact: true }).click();
  await mp.getByLabel('Task status', { exact: true }).selectOption('IN_PROGRESS');
  await mp.getByLabel('Update reason').fill('Starting assigned task');
  await mp.getByRole('button', { name: 'Update task', exact: true }).click();
  await expect(mp.getByRole('button', { name: 'Update task' })).toBeEnabled();
  await mp.getByLabel('Task status', { exact: true }).selectOption('COMPLETED');
  await mp.getByLabel('Update reason').fill('Assigned task completed');
  await mp.getByRole('button', { name: 'Update task', exact: true }).click();
  await expect(mp.getByRole('button', { name: 'Update task' })).not.toBeVisible();
  await mp.getByRole('button', { name: 'quality', exact: true }).click();
  await mp.getByRole('button', { name: 'Submit for quality check' }).click();
  await mp
    .getByLabel('Qualified reviewer', { exact: true })
    .selectOption(ops.lastAcceptance.reviewerId);
  await mp.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(mp.getByRole('dialog')).not.toBeVisible();
  const reviewer = await browser.newContext(),
    rp = await reviewer.newPage();
  await signIn(rp, ops.reviewer);
  await select(reviewer, f.tenant);
  await rp.goto(jobUrl);
  await rp.getByRole('button', { name: 'quality', exact: true }).click();
  await rp.getByRole('button', { name: 'Approve quality check' }).click();
  await rp.getByLabel('Completed repairs verified').check();
  await rp.getByLabel('Inspection findings reviewed').check();
  await rp.getByLabel('Accessories and belongings verified').check();
  await rp
    .getByLabel('Reviewer notes / rework reason')
    .fill('Separate qualified review completed for browser acceptance');
  await rp.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rp.getByRole('dialog')).not.toBeVisible();
  await expect(rp.getByText('ready for delivery', { exact: true }).first()).toBeVisible();
  await page.reload();
  await move('DELIVERED');
  const delivered = await call(context, 'workorder/work-orders/' + jobUrl.split('/').at(-1), {
    tenant: f.tenant,
  }).then((r) => r.json());
  const reconciled = await call(
    context,
    'booking/appointments/' + delivered.appointmentId + '/reconcile',
    { tenant: f.tenant, method: 'POST', data: {} },
  );
  expect(reconciled.ok()).toBe(true);

  await mp.goto('/mechanic');
  await expect(mp.getByRole('heading', { name: 'My jobs', exact: true })).toBeVisible();
  await page.goto('/operations');
  await page.getByRole('combobox', { name: 'Acting branch', exact: true }).selectOption(f.omr.id);
  mkdirSync('.runtime/previews', { recursive: true });
  await expect(page.getByText('Loading authorized records…').first()).not.toBeVisible();
  await page.screenshot({ path: '.runtime/previews/m4-board-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(jobUrl);
  await page.getByRole('button', { name: 'inspection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Digital vehicle inspection' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/previews/m4-inspection-mobile.png', fullPage: true });
  await mechanic.close();
  await reviewer.close();
});
test('Precision employee cannot open an Apex job card', async ({ page, context }) => {
  await signIn(page, f.employeeB);
  await select(context, f.precisionTenant);
  await page.goto('/jobs/' + ops.lastAcceptance.jobId);
  await expect(page.getByText('Record not found', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Assign technician', exact: true }),
  ).not.toBeVisible();
});
