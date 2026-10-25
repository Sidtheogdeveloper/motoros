import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { signIn, select } from '../helpers/oidc.mjs';
const f = JSON.parse(readFileSync('.runtime/m3-fixtures.json', 'utf8')),
  m5 = JSON.parse(readFileSync('.runtime/m5-fixtures.json', 'utf8')),
  m6 = JSON.parse(readFileSync('.runtime/m6-fixtures.json', 'utf8'));
test('manager reviews real communication attempts, templates, reminders and consent', async ({
  page,
  context,
}) => {
  await signIn(page, f.owner);
  await select(context, f.tenant);
  await page.goto('/notifications?branch=' + f.omr.id);
  await expect(
    page.getByRole('heading', { name: 'Customer communications', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Delivery status').selectOption('SENT');
  await page.getByRole('button', { name: 'Delivery attempts', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Delivery attempts', exact: true })).toBeVisible();
  await expect(page.getByText(/ACCEPTED_UNCONFIRMED/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close attempts', exact: true }).click();
  await page.getByRole('button', { name: 'templates', exact: true }).click();
  await expect(page.getByText('Tamil', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('முன்பதிவு உறுதி செய்யப்பட்டது', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'reminders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh reminders', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  await page.getByLabel('Find customer', { exact: true }).fill('M5 acceptance customer');
  await page.getByLabel('Customer', { exact: true }).selectOption(m5.customer.id);
  await page.getByLabel('Preferred language', { exact: true }).selectOption('ta');
  await page
    .getByLabel('Consent record / reason', { exact: true })
    .fill('Synthetic browser customer explicitly selected Tamil operational messages');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Communication preferences saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Preferred language', { exact: true })).toHaveValue('ta');
  await page.getByLabel('Preferred language', { exact: true }).selectOption('en');
  await page
    .getByLabel('Consent record / reason', { exact: true })
    .fill('Restore synthetic English preference after browser verification');
  const refreshed=page.waitForResponse(r=>r.url().includes('customer/communication-preferences/'+m5.customer.id)&&r.request().method()==='GET'&&r.status()===200);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await refreshed;
  await expect(page.getByLabel('Preferred language', { exact: true })).toHaveValue('en');
  await expect(page.getByText('Loading authorized records…',{exact:true})).not.toBeVisible();
  mkdirSync('.runtime/previews', { recursive: true });
  await page.screenshot({ path: '.runtime/previews/m6-preferences-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/previews/m6-preferences-mobile.png', fullPage: true });
});
test('branch reporting shows real freshness and platform diagnostics deny ordinary staff', async ({
  page,
  context,
}) => {
  await signIn(page, f.owner);
  await select(context, f.tenant);
  await page.goto('/reporting?branch=' + f.omr.id);
  await expect(page.getByRole('heading', { name: 'Branch reporting', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Projection freshness', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Manually recorded payments/)).toBeVisible();
  await page.goto('/platform/operations');
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
});
test('separate platform administrator sees metadata, failures and queue health', async ({
  page,
}) => {
  await signIn(page, m6.platformIdentity);
  await page.goto('/platform/operations');
  await expect(
    page.getByRole('heading', { name: 'Subscription queues', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Failed events', exact: true })).toBeVisible();
  await page.getByLabel('Service', { exact: true }).selectOption('workorder');
  await expect(page.getByRole('heading', { name: 'Outbox', exact: true })).toBeVisible();
  await page.screenshot({ path: '.runtime/previews/m6-platform-health.png', fullPage: true });
});
test('Precision cannot open Apex communications or reporting through branch selection', async ({
  page,
  context,
}) => {
  await signIn(page, f.precisionOwner);
  await select(context, f.precisionTenant);
  await page.goto('/notifications?branch=' + f.omr.id);
  await expect(page.getByLabel('Acting branch', { exact: true })).toHaveValue(f.precisionBranch.id);
  await expect(page.getByText(m6.lastAcceptance.customerId, { exact: false })).not.toBeVisible();
  await page.goto('/reporting?branch=' + f.omr.id);
  await expect(page.getByLabel('Acting branch', { exact: true })).toHaveValue(f.precisionBranch.id);
});
