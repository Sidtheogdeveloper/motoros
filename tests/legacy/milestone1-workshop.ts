import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
test('onboard, register customer and vehicle, create work order and switch branches', async ({
  page,
}) => {
  const suffix = Date.now();
  const email = `e2e-${suffix}@example.test`;
  const password = randomBytes(18).toString('hex');
  await page.goto('/login');
  await page.getByRole('button', { name: 'Set up your workshop' }).click();
  await page.getByLabel('Workshop brand').fill('E2E Garage ' + suffix);
  await page.getByLabel('First branch').fill('North');
  await page.getByLabel('City', { exact: true }).fill('Chennai');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create workshop' }).click();
  await expect(page.getByRole('status')).toContainText('Workshop created');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).first().click();
  await page.getByLabel('Full name').fill('Test Customer');
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.getByRole('cell', { name: 'Test Customer' })).toBeVisible();
  await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
  await page.getByRole('button', { name: 'Add vehicle', exact: true }).first().click();
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Test Customer' });
  await page.getByLabel('Registration number').fill('E2E-' + suffix);
  await page.getByLabel('Manufacturer').fill('Toyota');
  await page.getByLabel('Model', { exact: true }).fill('Corolla');
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.getByText('Toyota Corolla', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'New work order' }).click();
  await page
    .getByLabel('Vehicle', { exact: true })
    .selectOption({ label: `E2E-${suffix} · Toyota Corolla` });
  await page.getByLabel('Customer complaint').fill('Routine inspection');
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.getByText('Routine inspection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move work order to checked in' }).click();
  await expect(page.getByText('checked in', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Branches', exact: true }).click();
  await page.getByRole('button', { name: 'Add branch' }).click();
  await page.getByLabel('Branch name').fill('South');
  await page.getByLabel('City', { exact: true }).fill('Chennai');
  await page.getByRole('button', { name: 'Save record' }).click();
  await page.getByRole('button', { name: 'Service workspace Sign out securely' }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.getByRole('combobox', { name: 'Selected branch' }).selectOption({ label: 'South' });
  await expect(page.getByText('All clear here').first()).toBeVisible();
});
test('unauthenticated API access is rejected', async ({ request }) => {
  const res = await request.get('/api/backend/customer/customers');
  expect(res.status()).toBe(401);
});

test('fixture dashboard, cross-branch history, mobile layout and theme', async ({ page }) => {
  const fixture = JSON.parse(readFileSync('.runtime/fixture-logins.json', 'utf8'))[0];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('Email address').fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await expect(
    page.getByText('Investigate steering vibration — synthetic fixture', { exact: true }),
  ).toBeVisible();
  mkdirSync('.runtime/previews', { recursive: true });
  await page.screenshot({ path: '.runtime/previews/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.getByRole('button', { name: 'Use dark theme' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Selected branch' })
    .selectOption(fixture.branches[1].id);
  await expect(page.getByText('All clear here').first()).toBeVisible();
  await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
  await page.getByRole('button', { name: /FIXTURE-APEX/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Anna Nagar');
  await expect(page.getByRole('dialog')).toContainText(
    'Scheduled maintenance — synthetic development fixture',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: '.runtime/previews/mobile.png', fullPage: true });
});

test('BFF rejects cross-origin and oversized mutations', async ({ request }) => {
  const denied = await request.post('/api/backend/tenant/auth/register', {
    headers: { Origin: 'https://untrusted.example' },
    data: {},
  });
  expect(denied.status()).toBe(403);
  const oversized = await request.post('/api/backend/tenant/auth/register', {
    headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
    data: 'x'.repeat(17000),
  });
  expect(oversized.status()).toBe(413);
});

test('invalid session can sign in and tokens remain HttpOnly', async ({ page, context }) => {
  const fixture = JSON.parse(readFileSync('.runtime/fixture-logins.json', 'utf8'))[0];
  await context.addCookies([
    {
      name: 'motoros-session',
      value: 'invalid-old-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  let loginPayload: unknown;
  await page.route('**/api/backend/tenant/auth/login', async (route) => {
    const response = await route.fetch();
    loginPayload = await response.json();
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  expect(loginPayload).toEqual({ ok: true });
  const cookie = (await context.cookies()).find((c) => c.name === 'motoros-session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie.includes('motoros-session'))).toBe(false);
});

test('BFF clears rejected cookies, rejects unknown services and bounds chunked bodies', async ({
  request,
}) => {
  const rejected = await request.get('/api/backend/customer/customers', {
    headers: { Cookie: 'motoros-session=invalid' },
  });
  expect(rejected.status()).toBe(401);
  expect(rejected.headers()['set-cookie']).toContain('motoros-session=;');
  expect((await request.get('/api/backend/toString/anything')).status()).toBe(404);
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      'http://127.0.0.1:3000/api/backend/tenant/auth/register',
      {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    req.on('error', reject);
    req.write(' '.repeat(9000));
    req.end(' '.repeat(9000));
  });
  expect(status).toBe(413);
});
