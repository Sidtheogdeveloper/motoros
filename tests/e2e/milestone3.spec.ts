import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { signIn, select } from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
async function login(page: Page, context: BrowserContext, identity = f.owner, tenant = f.tenant) {
  await signIn(page, identity);
  await select(context, tenant);
}
test('Velachery employee finds Anna Nagar vehicle, documents and structured service timeline', async ({
  page,
  context,
}) => {
  await login(page, context, f.employeeA);
  await page.goto('/vehicles');
  await page.getByRole('textbox', { name: 'Search vehicles' }).fill(f.vehicle.registration);
  const row = page.getByRole('row').filter({ hasText: f.vehicle.registration });
  await row.getByRole('link', { name: /Open profile/ }).click();
  await expect(
    page.getByRole('heading', { name: f.vehicle.registration, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Customer directory', exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Ownership', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Service timeline', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Anna Nagar completed brake inspection [M3 fixture]',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Source: workorder / ' + f.order.id, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Timeline branch' }).locator('option'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('service-record.pdf', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Upload document', exact: true }),
  ).not.toBeVisible();
  mkdirSync('.runtime/previews', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.runtime/previews/m3-vehicle-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/previews/m3-vehicle-mobile.png', fullPage: true });
});
test('Precision employee cannot access Apex profile, private documents or service history', async ({
  page,
  context,
}) => {
  await login(page, context, f.employeeB, f.precisionTenant);
  await page.goto('/vehicles');
  await page.getByRole('textbox', { name: 'Search vehicles' }).fill(f.vehicle.registration);
  await expect(page.getByRole('heading', { name: 'No matching vehicles' })).toBeVisible();
  await page.goto('/vehicles/' + f.vehicle.id);
  await expect(page.locator('main [role=alert]')).toContainText('Record not found');
  const response = await context.request.post(
    '/api/backend/customer/documents/' + f.document.id + '/download',
    {
      headers: { Origin: 'http://127.0.0.1:3000', 'X-MotorOS-Expected-Tenant': f.precisionTenant },
      data: {},
    },
  );
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('X-Amz');
  await page.goto('/vehicles/' + f.vehicle.id + '/timeline');
  await expect(page.locator('main [role=alert]')).toContainText('Record not found');
});
test('owner manages customer, vehicle, duplicate review, ownership, odometer and real private upload', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await login(page, context);
  const suffix = Date.now(),
    name = 'Registry Browser ' + suffix,
    email = 'm3-browser-' + suffix + '@example.test',
    registration = 'M3-UI-' + String(suffix).slice(-8);
  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('City', { exact: true }).fill('Chennai');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
  const customerUrl = page.url();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Contact label').fill('Work');
  await page.getByLabel('Contact value').fill('work-' + suffix + '@example.test');
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await expect(
    page.getByText('Work · work-' + suffix + '@example.test', { exact: true }),
  ).toBeVisible();
  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Duplicate ' + suffix);
  await page.getByLabel('Email', { exact: true }).fill(email.toUpperCase());
  await page.getByRole('button', { name: 'Check duplicate contacts' }).click();
  await expect(page.getByRole('status')).toContainText('Possible matches');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.locator('main [role=alert]')).toContainText('Possible duplicate contact');
  await page
    .getByLabel('Separate-record review reason (only when contacts are shared)')
    .fill('Reviewed distinct sibling sharing household contact');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
  await page.goto(customerUrl);
  await page.getByRole('button', { name: 'Edit customer', exact: true }).click();
  await page.getByLabel('City', { exact: true }).fill('Madurai');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByText('Madurai · India', { exact: true })).toBeVisible();
  await page.goto('/vehicles');
  await page.getByRole('button', { name: 'Register vehicle', exact: true }).click();
  await page.getByLabel('Find current owner').fill(name);
  await expect(
    page.getByRole('combobox', { name: 'Current owner', exact: true }).locator('option'),
  ).toContainText([/Select a customer/, new RegExp(name)]);
  await page
    .getByRole('combobox', { name: 'Current owner', exact: true })
    .selectOption({ label: name + ' · ' + email });
  await page.getByLabel('Registration', { exact: true }).fill(registration);
  await page.getByLabel('Make', { exact: true }).fill('Toyota');
  await page.getByLabel('Model', { exact: true }).fill('Innova');
  await page.getByLabel('Registration branch').selectOption(f.anna.id);
  await page.getByRole('button', { name: 'Save vehicle', exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: registration, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Odometer', exact: true }).click();
  await page.getByLabel('Odometer kilometers').fill('23000');
  await page.getByRole('button', { name: 'Record odometer', exact: true }).click();
  await expect(page.getByText('23,000 km', { exact: true })).toBeVisible();
  await page.getByLabel('Odometer kilometers').fill('22000');
  await page.getByRole('button', { name: 'Record odometer', exact: true }).click();
  await expect(page.locator('main [role=alert]')).toContainText('Odometer cannot decrease');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Document file').setInputFiles({
    name: 'browser-inspection.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nBrowser synthetic document\n%%EOF'),
  });
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  // The document-list refresh can expose its loading status alongside this notice.
  await expect(
    page.getByRole('status').filter({ hasText: 'Document validated and published.' }),
  ).toBeVisible();
  await expect(page.getByText('browser-inspection.pdf', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  const objectRequestPromise = page.waitForRequest(
    (r) => r.url().startsWith('http://127.0.0.1:8333/') && r.method() === 'GET',
  );
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const downloaded = await downloadPromise;
  expect(downloaded.suggestedFilename()).toBe('browser-inspection.pdf');
  expect((await (await objectRequestPromise).allHeaders()).cookie).toBeUndefined();
  await page.getByRole('button', { name: 'Ownership', exact: true }).click();
  await page.getByLabel('Find next owner').fill(f.customer.name);
  await page
    .getByRole('combobox', { name: 'Next owner', exact: true })
    .selectOption({ label: f.customer.name });
  await page.getByLabel('Transfer reason').fill('Verified synthetic vehicle sale');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  await expect(page.getByText('Verified synthetic vehicle sale', { exact: true })).toBeVisible();
  await expect(page.getByText('Initial registration', { exact: true })).toBeVisible();
  await page.goto(customerUrl);
  await expect(page.getByText('No current vehicles registered.', { exact: true })).toBeVisible();
});
