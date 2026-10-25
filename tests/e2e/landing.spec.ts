import { test, expect } from '@playwright/test';
test('public home explains the product and links to real account workflows', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Your workshop.In perfect sync.',
  );
  await expect(page.getByRole('heading', { name: 'Workshop overview.' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Create your workshop' }).first()).toHaveAttribute(
    'href',
    '/register',
  );
  await page.getByRole('link', { name: 'See how it works' }).click();
  await expect(page).toHaveURL(/\/#workflow$/);
  await expect(
    page.getByRole('heading', { name: 'A clear next step. For every service visit.' }),
  ).toBeInViewport();
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('link', { name: 'Sign in securely' })).toBeVisible();
});
test('public home fits a mobile viewport and opens registration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Get started', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
});
