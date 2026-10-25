import { test, expect } from '@playwright/test';

test('public and account screens share the accessible MotorOS identity and tab icons', async ({
  page,
}) => {
  for (const route of [
    '/',
    '/login',
    '/register',
    '/password-recovery',
    '/verify-email',
    '/session-expired',
    '/access-denied',
  ]) {
    await page.goto(route);
    const logo = page.getByRole('img', { name: 'MotorOS', exact: true }).first();
    await expect(logo).toBeVisible();
    const image = logo.locator('img');
    await expect(image).toHaveAttribute('src', '/brand/motoros-mark.svg');
    await expect
      .poll(() =>
        image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
    const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]');
    await expect(favicon).toHaveCount(1);
    const response = await page.request.get((await favicon.getAttribute('href'))!);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('#FF9857');
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('img', { name: 'MotorOS', exact: true }).first()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('secure identity forms use the MotorOS brand and matching favicon', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in securely' }).click();
  await expect(page.locator('#kc-header-wrapper')).toContainText('motoros');
  await expect(page.locator('input[name="username"]')).toBeVisible();
  const background = await page
    .locator('#kc-header-wrapper')
    .evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(background).toContain('/login/motoros/img/motoros-mark.svg');
  const icon = page.locator('link[rel="icon"]').first();
  expect(await icon.getAttribute('href')).toContain('/login/motoros/img/favicon.ico');
  const iconUrl = new URL((await icon.getAttribute('href'))!, page.url()).href;
  expect((await page.request.get(iconUrl)).ok()).toBe(true);
});
