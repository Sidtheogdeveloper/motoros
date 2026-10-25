import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { signIn, select, call, mail, origin } from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
const m5 = JSON.parse(readFileSync('.runtime/m5-fixtures.json', 'utf8'));
const ops = JSON.parse(readFileSync('.runtime/m4-fixtures.json', 'utf8'));

test('supplier catalog, duplicate protection and physical branch transfer use real stock APIs', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  await signIn(page, f.owner);
  await select(context, f.tenant);
  await page.goto('/inventory?branch=' + f.omr.id);
  const unique = String(Date.now()),
    supplier = 'Browser supplier ' + unique,
    sku = 'TRANSFER-' + unique;
  await page.getByRole('button', { name: 'Suppliers', exact: true }).click();
  await page.getByRole('button', { name: 'New supplier', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Supplier name', { exact: true }).fill(supplier);
  await page
    .getByRole('dialog')
    .getByLabel('Supplier contact details')
    .fill('Synthetic local supplier contact');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  async function partForm(code: string) {
    await page.getByRole('button', { name: 'New part', exact: true }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('SKU', { exact: true }).fill(code);
    await d.getByLabel('Part name', { exact: true }).fill('Browser transfer filter');
    await d.getByLabel('Category', { exact: true }).fill('Filters');
    await d.getByLabel('Purchase price', { exact: true }).fill('50');
    await d.getByLabel('Selling price', { exact: true }).fill('90');
  }
  await partForm(sku);
  await page.getByRole('dialog').getByLabel('Find supplier').fill(supplier);
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Supplier', exact: true })
    .selectOption({ label: supplier });
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await partForm(sku.toLowerCase());
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  async function choosePart() {
    const d = page.getByRole('dialog');
    await d.getByLabel('Find by name, SKU or OEM number').fill(sku);
    const option = d
      .getByRole('combobox', { name: 'Part', exact: true })
      .locator('option')
      .filter({ hasText: sku });
    await expect(option).toHaveCount(1);
    await d
      .getByRole('combobox', { name: 'Part', exact: true })
      .selectOption((await option.getAttribute('value'))!);
  }
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await choosePart();
  await page.getByRole('dialog').getByLabel('Quantity', { exact: true }).fill('3');
  await page
    .getByRole('dialog')
    .getByLabel('Reason / supplier delivery reference')
    .fill('Transfer browser supplier delivery');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/transfers?branch=' + f.omr.id);
  await page.getByRole('button', { name: 'Request transfer', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Destination branch').selectOption(f.anna.id);
  await choosePart();
  await page.getByRole('dialog').getByLabel('Quantity to transfer').fill('2');
  const note = 'Browser physical transfer ' + unique;
  await page.getByRole('dialog').getByLabel('Transfer reason').fill(note);
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('article')
    .filter({ hasText: note })
    .getByRole('button', { name: 'Open transfer', exact: true })
    .click();
  for (const button of ['Approve and reserve', 'Dispatch stock']) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Action / receipt evidence')
      .fill('Authorized browser ' + button);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Acting branch', exact: true }).selectOption(f.anna.id);
  await page
    .getByRole('article')
    .filter({ hasText: note })
    .getByRole('button', { name: 'Open transfer', exact: true })
    .click();
  await page.getByRole('button', { name: 'Record receipt', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Usable quantity received now').fill('2');
  await page
    .getByRole('dialog')
    .getByLabel('Action / receipt evidence')
    .fill('Two usable parts physically received');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
  await page.goto('/inventory?branch=' + f.anna.id);
  await page.getByRole('button', { name: 'Branch stock', exact: true }).click();
  await page.getByLabel('Search catalog or stock').fill(sku);
  await expect(page.getByRole('row').filter({ hasText: sku }).getByRole('cell').nth(1)).toHaveText(
    '2.000',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const mechanic = await browser.newContext();
  const mp = await mechanic.newPage();
  await signIn(mp, ops.technician);
  await select(mechanic, f.tenant);
  await mp.goto('/estimates');
  await expect(mp.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
  await mechanic.close();
});
test('commercial workflow: booking, stock, customer approval, repair, QC, invoice, payment and delivery', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await signIn(page, f.owner);
  await select(context, f.tenant);
  const response = await call(context, 'customer/vehicles/' + m5.vehicle.id, {
    tenant: f.tenant,
  });
  const vehicle = await response.json();
  const registration = vehicle.registration;
  const readings = await call(context, `customer/vehicles/${vehicle.id}/odometer?size=1`, {
    tenant: f.tenant,
  }).then((r) => r.json());
  const nextOdometer =
    Math.max(18000, ...readings.content.map((r: { kilometers: number }) => Number(r.kilometers))) +
    100;
  for (let cleanupPage = 0; cleanupPage < 100; cleanupPage++) {
    const prior = await call(
      context,
      'booking/appointments?branchId=' + f.omr.id + '&size=100&page=' + cleanupPage,
      { tenant: f.tenant },
    ).then((r) => r.json());
    for (const a of prior.content || []) {
      if (!a.customerComplaint.startsWith('Browser commercial acceptance')) continue;
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
  await dialog.getByRole('textbox', { name: 'Search customers' }).fill('M5 acceptance customer');
  await dialog.locator('select[name=customerId]').selectOption(m5.customer.id);
  await dialog.getByRole('textbox', { name: 'Search vehicles' }).fill(registration);
  await dialog.locator('select[name=vehicleId]').selectOption(vehicle.id);
  // Repeated acceptance runs share development data. Select real available capacity
  // instead of assuming tomorrow's fixed slot has no other appointments.
  let bookingStart = '';
  for (let day = 1; day <= 14 && !bookingStart; day++) {
    const date = new Date(Date.now() + day * 86400000).toISOString().slice(0, 10);
    for (const hour of ['10', '12', '14', '16']) {
      const local = date + 'T' + hour + ':00';
      const startsAt = encodeURIComponent(new Date(local + ':00+05:30').toISOString());
      const availability = await call(
        context,
        `booking/appointments/availability?branchId=${f.omr.id}&startsAt=${startsAt}&durationMinutes=45`,
        { tenant: f.tenant },
      );
      if (availability.ok() && (await availability.json()).available) {
        bookingStart = local;
        break;
      }
    }
  }
  expect(bookingStart, 'A valid available workshop slot is required').not.toBe('');
  await dialog.getByLabel('Start (Asia/Kolkata)').fill(bookingStart);
  await dialog.getByLabel('Duration in minutes').fill('45');
  const complaint = 'Browser commercial acceptance ' + Date.now();
  await dialog.getByLabel('Customer complaint').fill(complaint);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Search appointments' }).fill(registration);
  await page.getByRole('combobox', { name: 'Appointment status' }).selectOption('REQUESTED');
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
  await page.getByLabel('Current odometer (km)').fill(String(nextOdometer));
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
  await mp.getByRole('button', { name: 'details', exact: true }).click();
  await mp.getByRole('button', { name: 'Request parts', exact: true }).click();
  await mp
    .getByRole('dialog')
    .getByLabel('Part description', { exact: true })
    .fill('Oil filter requested after inspection');
  await mp.getByRole('dialog').getByLabel('Quantity', { exact: true }).fill('1');
  await mp.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(mp.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Add repair task', exact: true }).click();
  await page
    .getByLabel('Task description', { exact: true })
    .fill('M5 browser approved filter replacement');
  await page.getByLabel('Task category', { exact: true }).fill('GENERAL');
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Technician', exact: true })
    .selectOption(ops.lastAcceptance.technicianId);
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await move('ESTIMATE_PENDING');
  await move('AWAITING_APPROVAL');
  const jobId = jobUrl.split('/').at(-1)!;
  const sku = 'BROWSER-' + Date.now();
  await page.goto('/inventory?branch=' + f.omr.id);
  await page.getByRole('button', { name: 'New part', exact: true }).click();
  await page.getByRole('dialog').getByLabel('SKU', { exact: true }).fill(sku);
  await page
    .getByRole('dialog')
    .getByLabel('Part name', { exact: true })
    .fill('Browser oil filter');
  await page.getByRole('dialog').getByLabel('Category', { exact: true }).fill('Filters');
  await page.getByRole('dialog').getByLabel('Purchase price', { exact: true }).fill('70.00');
  await page.getByRole('dialog').getByLabel('Selling price', { exact: true }).fill('100.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  async function choosePart(target = page) {
    const d = target.getByRole('dialog');
    await d.getByLabel('Find by name, SKU or OEM number').fill(sku);
    const option = d
      .getByRole('combobox', { name: 'Part', exact: true })
      .locator('option')
      .filter({ hasText: sku });
    await expect(option).toHaveCount(1);
    await d
      .getByRole('combobox', { name: 'Part', exact: true })
      .selectOption((await option.getAttribute('value'))!);
  }
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await choosePart();
  await page.getByRole('dialog').getByLabel('Quantity', { exact: true }).fill('3');
  await page
    .getByRole('dialog')
    .getByLabel('Reason / supplier delivery reference')
    .fill('Synthetic browser supplier receipt');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const inventoryContext = await browser.newContext(),
    ip = await inventoryContext.newPage();
  await signIn(ip, m5.inventoryIdentity);
  await select(inventoryContext, f.tenant);
  await ip.goto('/inventory?branch=' + f.omr.id);
  await ip.getByRole('button', { name: 'Reserve for job', exact: true }).click();
  await choosePart(ip);
  await ip
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Job card', exact: true })
    .selectOption(jobId);
  await ip.getByRole('dialog').getByLabel('Quantity', { exact: true }).fill('1');
  await ip.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ip.getByRole('dialog')).not.toBeVisible();
  await page.goto('/estimates?branch=' + f.omr.id);
  await page.getByRole('button', { name: 'New estimate', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Job card', exact: true })
    .selectOption(jobId);
  await choosePart();
  await page
    .getByRole('dialog')
    .getByLabel('Description', { exact: true })
    .fill('Approved oil filter');
  await page.getByRole('button', { name: 'Add estimate line', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Description', { exact: true })
    .nth(1)
    .fill('Approved filter replacement labor');
  await page
    .getByRole('dialog')
    .getByLabel('Scope and revision notes')
    .fill('Filter and one hour of labor for customer approval');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL('**/estimates/*');
  const estimateId = page.url().split('/').at(-1)!;
  await page.getByRole('button', { name: 'Send to customer for approval', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Reason / scope explanation')
    .fill('Customer approval of listed work only');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const message = await mail(m5.customerIdentity.email, estimateId);
  const approvalUrl = message.Text.match(/http:\/\/127\.0\.0\.1:3000\/approval#[^\s]+/)[0];
  const customer = await browser.newContext();
  const cp = await customer.newPage();
  await signIn(cp, m5.customerIdentity);
  await select(customer, f.tenant);
  await cp.goto(approvalUrl);
  await expect(cp.getByRole('heading', { name: 'Revision 1', exact: true })).toBeVisible();
  await cp.getByRole('button', { name: 'Approve this exact estimate', exact: true }).click();
  await expect(cp.getByRole('status')).toContainText('approved');
  await customer.close();
  await page.goto(jobUrl);
  await page
    .getByRole('button', { name: 'Verify customer approval for repair', exact: true })
    .click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await call(context, 'workorder/work-orders/' + jobId, {
          tenant: f.tenant,
        });
        return (await response.json()).status;
      },
      { timeout: 30000 },
    )
    .toBe('APPROVED');
  await page.reload();
  await move('IN_PROGRESS');
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
  await ip.goto('/inventory?branch=' + f.omr.id);
  await ip.getByRole('button', { name: 'Job reservations', exact: true }).click();
  const reservationCard = ip
    .getByRole('article')
    .filter({ has: ip.locator('a[href="/jobs/' + jobId + '"]') });
  await reservationCard.getByRole('button', { name: 'Record installation', exact: true }).click();
  await expect(reservationCard.getByText('consumed', { exact: true })).toBeVisible();
  await mp.reload();
  await mp.getByRole('button', { name: 'details', exact: true }).click();
  await mp.getByRole('button', { name: 'Link installed stock', exact: true }).click();
  const installedOption = mp
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Installed reservation', exact: true })
    .locator('option')
    .filter({ hasText: sku });
  await expect(installedOption).toHaveCount(1);
  await mp
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Installed reservation', exact: true })
    .selectOption((await installedOption.getAttribute('value'))!);
  await mp
    .getByRole('dialog')
    .getByLabel('Parts verification notes')
    .fill('Verified the installed filter matches the mechanic request');
  await mp.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(mp.getByRole('dialog')).not.toBeVisible();
  await expect(mp.getByText('fulfilled', { exact: true })).toBeVisible();
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
  await expect(rp.getByText('passed', { exact: true }).first()).toBeVisible();
  await page.goto(jobUrl);
  await page
    .getByRole('button', { name: 'Create invoice from approved estimate', exact: true })
    .click();
  await page.waitForURL('**/invoices/*');
  await page.getByRole('button', { name: 'Issue immutable invoice', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Reason / reconciliation evidence')
    .fill('Issue after separate quality sign-off');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Amount (INR)', { exact: true }).fill('708.00');
  await page
    .getByRole('dialog')
    .getByLabel(/Unique receipt \/ transaction reference/)
    .fill('BROWSER-' + Date.now());
  await page
    .getByRole('dialog')
    .getByLabel('Reason / reconciliation evidence')
    .fill('Manually recorded cash for synthetic browser service');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('paid', { exact: true }).first()).toBeVisible();
  mkdirSync('.runtime/previews', { recursive: true });
  await page.screenshot({ path: '.runtime/previews/m5-invoice-desktop.png', fullPage: true });
  await page.goto(jobUrl);
  await page
    .getByRole('button', { name: 'Verify invoice and mark ready for delivery', exact: true })
    .click();
  await expect(page.getByText('ready for delivery', { exact: true }).first()).toBeVisible();
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
  await expect(page.getByText('Loading authorized recordsâ€¦').first()).not.toBeVisible();
  await page.screenshot({ path: '.runtime/previews/m5-board-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(jobUrl);
  await page.getByRole('button', { name: 'inspection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Digital vehicle inspection' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/previews/m5-inspection-mobile.png', fullPage: true });
  await mechanic.close();
  await reviewer.close();
  await inventoryContext.close();
});
