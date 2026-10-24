import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  createIdentity,
  invitationMail,
  mail,
  select,
  call,
  origin,
  sessionData,
} from '../helpers/oidc.mjs';
const fixtures = JSON.parse(readFileSync('.runtime/m2-fixtures.json', 'utf8'));
async function login(page: Page, user = fixtures[0]) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in securely' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:8180/);
  await page.locator('input[name="username"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
}
test('real OIDC PKCE sign-in restores memberships and opens the preserved workshop', async ({
  page,
  context,
}) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Choose your workspace.' })).toBeVisible();
  await page.getByRole('button', { name: /Apex Motorworks/ }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await page.getByRole('button', { name: 'View all work orders' }).click();
  await expect(
    page.getByText('Investigate steering vibration — synthetic fixture', { exact: true }),
  ).toBeVisible();
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'motoros-session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.value.split('.').length).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
});

test('owner invites a manager and mechanic through real mail and scoped browser workspaces', async ({
  browser,
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.getByRole('button', { name: /Apex Motorworks/ }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff & invitations.' })).toBeVisible();
  const manager = await createIdentity('browser-manager');
  await page.getByRole('button', { name: 'Invite employee' }).click();
  await page.getByLabel('Employee email').fill(manager.email);
  await page.getByRole('combobox', { name: 'Employee role' }).selectOption('BRANCH_MANAGER');
  await page.getByRole('checkbox', { name: 'OMR', exact: true }).check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText('Invitation queued');
  const managerEmail = await invitationMail(manager.email);
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await managerPage.goto(managerEmail.url);
  await managerPage.getByRole('link', { name: 'Sign in to review invitation' }).click();
  await managerPage.locator('input[name="username"]').fill(manager.email);
  await managerPage.locator('input[name="password"]').fill(manager.password);
  await managerPage.locator('#kc-login').click();
  await expect(managerPage.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(managerPage.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await expect(managerPage.getByRole('combobox', { name: 'Selected branch' })).toHaveValue(
    fixtures[0].branches[1].id,
  );
  await expect(
    managerPage.getByRole('combobox', { name: 'Selected branch' }).locator('option'),
  ).toHaveCount(1);
  await expect(managerPage.getByRole('link', { name: 'Staff & invitations' })).toBeVisible();
  const mechanic = await createIdentity('browser-mechanic');
  await page.getByRole('button', { name: 'Invite employee' }).click();
  await page.getByLabel('Employee email').fill(mechanic.email);
  await page.getByRole('combobox', { name: 'Employee role' }).selectOption('MECHANIC');
  await page.getByRole('checkbox', { name: 'OMR', exact: true }).check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const mechanicEmail = await invitationMail(mechanic.email);
  const mechanicContext = await browser.newContext();
  const mechanicPage = await mechanicContext.newPage();
  await mechanicPage.goto(mechanicEmail.url);
  await mechanicPage.getByRole('link', { name: 'Sign in to review invitation' }).click();
  await mechanicPage.locator('input[name="username"]').fill(mechanic.email);
  await mechanicPage.locator('input[name="password"]').fill(mechanic.password);
  await mechanicPage.locator('#kc-login').click();
  await mechanicPage.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(mechanicPage.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await expect(
    mechanicPage.getByRole('button', { name: 'Customers', exact: true }),
  ).not.toBeVisible();
  await expect(mechanicPage.getByRole('link', { name: 'Staff & invitations' })).not.toBeVisible();
  await expect(mechanicPage.getByRole('button', { name: 'New work order' })).not.toBeVisible();
  await mechanicPage.getByRole('button', { name: 'Vehicles', exact: true }).click();
  await mechanicPage.getByRole('button', { name: /FIXTURE-APEX/ }).click();
  await expect(mechanicPage.getByRole('dialog')).toContainText('Anna Nagar');
  await expect(mechanicPage.getByRole('dialog')).toContainText(
    'Scheduled maintenance — synthetic development fixture',
  );
  await mechanicPage.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Search staff' }).fill(mechanic.email);
  const row = page.getByRole('row').filter({ hasText: mechanic.email }).first();
  await row.getByRole('button', { name: 'Edit access' }).click();
  await page.getByLabel('Membership status').selectOption('INACTIVE');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save access' }).click();
  await expect(page.getByRole('status')).toContainText('Access updated');
  await mechanicPage.reload();
  await expect(mechanicPage.getByRole('heading', { name: 'Welcome to MotorOS.' })).toBeVisible();
  await managerContext.close();
  await mechanicContext.close();
});

test('registration, real email verification and transactional workshop onboarding', async ({
  page,
}) => {
  test.setTimeout(90000);
  const email = `signup-${randomBytes(5).toString('hex')}@example.test`,
    password = 'Registration-' + randomBytes(12).toString('hex') + 'aA1!';
  await page.goto('/register');
  await page.getByRole('link', { name: 'Continue to registration' }).click();
  await page.locator('input[name="firstName"]').fill('New');
  await page.locator('input[name="lastName"]').fill('Workshop Owner');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[type="submit"],button[type="submit"]').first().click();
  await expect(page).toHaveURL(/127\.0\.0\.1:8180/);
  const message = await mail(email, 'verify');
  const link = (message.Text || '').match(/http:\/\/127\.0\.0\.1:8180\/[^\s<>]+/);
  expect(link).toBeTruthy();
  await page.goto(link![0]);
  await page.locator('input[name="password-new"]').fill(password);
  await page.locator('input[name="password-confirm"]').fill(password);
  await page.locator('input[type="submit"],button[type="submit"]').first().click();
  if (!page.url().startsWith(origin + '/')) {
    const back = page.getByRole('link', { name: /back to application|continue/i });
    if (await back.isVisible()) await back.click();
  }
  await expect(page.getByRole('heading', { name: 'Welcome to MotorOS.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('link', { name: 'Create workshop', exact: true }).click();
  await page.getByLabel('Workshop brand').fill('Verified Workshop ' + Date.now());
  await page.getByLabel('First branch name').fill('Primary');
  await page.getByLabel('Branch code', { exact: true }).fill('PRIMARY');
  await page.getByLabel('City', { exact: true }).fill('Chennai');
  await page.getByRole('button', { name: 'Create workshop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
});

test('owner manages branch hours and all-branches view without leaking brand context', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: /Apex Motorworks/ }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await page.goto('/branches/new');
  await page.getByLabel('Branch name', { exact: true }).fill('Browser Branch ' + Date.now());
  await page
    .getByLabel('Branch code', { exact: true })
    .fill('BR-' + randomBytes(3).toString('hex'));
  await page.getByLabel('City', { exact: true }).fill('Chennai');
  await page.getByRole('button', { name: 'Create branch', exact: true }).click();
  await expect(page).toHaveURL(/\/branches\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Branch profile.' })).toBeVisible();
  await page.getByLabel('Service bays').fill('4');
  await page.getByRole('button', { name: 'Save branch', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved');
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Selected branch' }).selectOption('all');
  await expect(page.getByRole('button', { name: 'New work order' })).toBeDisabled();
  await page
    .getByRole('combobox', { name: 'Active brand' })
    .selectOption(fixtures[0].extraTenantId);
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await expect(
    page.getByText('Investigate steering vibration — synthetic fixture', { exact: true }),
  ).not.toBeVisible();
});

test('password recovery delivers real mail and restores provider sign-in', async ({
  page,
  browser,
}) => {
  const user = await createIdentity('recovery');
  await page.goto('/password-recovery');
  await page
    .getByRole('link', { name: /continue|secure/i })
    .first()
    .click();
  await page.getByRole('link', { name: /forgot.*password/i }).click();
  await page.locator('input[name="username"]').fill(user.email);
  await page.locator('input[type="submit"],button[type="submit"]').first().click();
  const message = await mail(user.email, 'reset');
  const link = (message.Text || '').match(/http:\/\/127\.0\.0\.1:8180\/[^\s<>]+/);
  expect(link).toBeTruthy();
  await page.goto(link![0]);
  const password = 'Reset-' + randomBytes(14).toString('hex') + 'aA1!';
  await page.locator('input[name="password-new"]').fill(password);
  await page.locator('input[name="password-confirm"]').fill(password);
  await page.locator('input[type="submit"],button[type="submit"]').first().click();
  const fresh = await browser.newContext();
  await login(await fresh.newPage(), { ...user, password });
  await fresh.close();
});

test('customer, vehicle and work-order lifecycle remains functional through OIDC', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: /Apex Motorworks/ }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  const suffix = Date.now(),
    customer = 'Browser Customer ' + suffix;
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).first().click();
  await page.getByLabel('Full name').fill(customer);
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.getByRole('cell', { name: customer })).toBeVisible();
  await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
  await page.getByRole('button', { name: 'Add vehicle', exact: true }).first().click();
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: customer });
  await page.getByLabel('Registration number').fill('E2E-' + suffix);
  await page.getByLabel('Manufacturer').fill('Toyota');
  await page.getByLabel('Model', { exact: true }).fill('Corolla');
  await page.getByRole('button', { name: 'Save record' }).click();
  await expect(page.getByRole('button').filter({ hasText: 'E2E-' + suffix })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'New work order' }).click();
  await page
    .getByLabel('Vehicle', { exact: true })
    .selectOption({ label: `E2E-${suffix} · Toyota Corolla` });
  await page.getByLabel('Customer complaint').fill('Routine inspection ' + suffix);
  await page.getByRole('button', { name: 'Save record' }).click();
  const card = page.locator('.job-card').filter({ hasText: 'Routine inspection ' + suffix });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Move work order to checked in' }).click();
  await expect(card.getByText('checked in', { exact: true })).toBeVisible();
});

test('management layouts fit desktop and mobile, profile and guards use real state', async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole('button', { name: /Apex Motorworks/ }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  mkdirSync('.runtime/previews', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff & invitations.' })).toBeVisible();
  await page.screenshot({ path: '.runtime/previews/m2-staff-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/previews/m2-staff-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'View profile' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Permissions');
  await page.getByRole('button', { name: 'Close profile' }).click();
  await page.goto('/profile');
  await page.getByLabel('Display name').fill('Apex Owner [fixture]');
  await page.getByLabel('Contact number').fill('');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile updated');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Apex Owner [fixture]');
  await context.clearCookies();
  await page.goto('/staff');
  await expect(page).toHaveURL(/login/);
  const invalid = await context.request.get('/api/auth/callback?code=invalid&state=forged');
  expect(invalid.url()).toContain('/login');
});

test('expired server session leaves the protected workspace', async ({ page, context }) => {
  await login(page);
  await page.getByRole('button', { name: /Apex Motorworks/ }).click();
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toBeVisible();
  await sessionData(context, { expiresAt: Date.now() + 2500 });
  await expect
    .poll(
      async () => (await (await context.request.get('/api/auth/session')).json()).authenticated,
      { timeout: 6000 },
    )
    .toBe(false);
  await expect(page).toHaveURL(/session-expired/, { timeout: 10000 });
});

test('sign out clears the application and provider session', async ({ page, context }) => {
  await login(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/login');
  expect((await context.cookies()).find((c) => c.name === 'motoros-session')).toBeUndefined();
  await page.getByRole('link', { name: 'Sign in securely' }).click();
  await expect(page.locator('input[name="username"]')).toBeVisible();
});
