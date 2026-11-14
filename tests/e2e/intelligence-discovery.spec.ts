import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { select, signIn } from '../helpers/oidc.mjs';

test('workshop AI features are discoverable from the dashboard and record lists', async ({
  page,
  context,
}) => {
  test.skip(process.env.MOTOROS_TEST_LOCAL_AI !== '1', 'Requires the synthetic workshop fixtures');
  const fixtures = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, fixtures.owner);
  await select(context, fixtures.tenant);
  await page.goto('/');

  const shortcuts = page.getByRole('region', { name: 'Workshop AI tools' });
  await expect(shortcuts).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI tools' })).toBeInViewport();
  await page.getByRole('button', { name: 'AI tools' }).click();
  await expect(page.getByRole('heading', { name: 'MotorOS Intelligence.' })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: /Mechanic Copilot/ })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: /AI estimate drafting/ })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: /Analytics Intelligence/ })).toHaveAttribute(
    'href',
    '/reporting#analytics-intelligence',
  );
  await expect(shortcuts.getByRole('link', { name: /AI message composer/ })).toHaveAttribute(
    'href',
    '/notifications?tab=compose',
  );
  await shortcuts.getByRole('link', { name: /AI vehicle history summary/ }).click();

  await page.getByRole('textbox', { name: 'Search vehicles' }).fill(fixtures.vehicle.registration);
  const vehicle = page.getByRole('row').filter({ hasText: fixtures.vehicle.registration });
  await vehicle.getByRole('link', { name: 'AI history summary' }).click();
  await expect(page.getByRole('button', { name: 'Intelligence', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('heading', { name: 'Vehicle health & service history' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const summary = page.getByRole('button', { name: 'Open AI history summary' });
  await summary.focus();
  await summary.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Profile sections' })).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/jobs?branch=' + fixtures.anna.id);
  await page.getByRole('textbox', { name: 'Search jobs' }).fill(fixtures.vehicle.registration);
  const jobShortcut = page.locator('a[href="/jobs/' + fixtures.order.id + '?tab=copilot"]');
  await expect(jobShortcut).toHaveText('Ask Copilot');
  await jobShortcut.click();
  await expect(page.getByRole('button', { name: 'Copilot', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Ask MotorOS Copilot' })).toBeVisible();
});

test('shared dialogs and the composer fit desktop and mobile', async ({ page, context }) => {
  test.skip(process.env.MOTOROS_TEST_LOCAL_AI !== '1', 'Requires the synthetic workshop fixtures');
  const fixtures = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8'));
  await signIn(page, fixtures.owner);
  await select(context, fixtures.tenant);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/customers');
    const opener = page.getByRole('button', { name: 'New customer', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'New customer' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(10);
    expect(box.y).toBeGreaterThanOrEqual(10);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 10);
    if (viewport.width > 600) {
      expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(5);
    } else {
      expect(viewport.height - box.y - box.height).toBeLessThan(25);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.goto('/notifications?tab=compose');
    const composer = page.getByRole('region', { name: 'AI message composer' });
    await expect(composer).toBeVisible();
    await expect(composer.getByRole('heading', { name: 'Message preview' })).toBeVisible();
    const layout = await composer
      .locator('.composer-layout')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    expect(layout).toBe(viewport.width > 850 ? 2 : 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});
