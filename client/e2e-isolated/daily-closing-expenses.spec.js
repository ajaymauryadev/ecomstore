import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('records an expense from Daily Closing and shows the same record in both views', async ({ page, storefront }) => {
  test.setTimeout(60000);
  const credentials = { email: 'daily-money@example.com', password: 'DailyClosing123!' };
  await storefront.seedStore('daily-money', credentials);
  const login = await page.request.post(storefront.origin + '/api/v1/auth/login', { data: credentials });
  expect(login.status()).toBe(200);
  await page.goto(storefront.origin + '/store/daily-closing');
  await expect(page.getByRole('heading', { name: 'Cash Verification' })).toBeVisible();
  await expect(page.getByText('Awaiting Cash Count')).toBeVisible();

  await page.getByRole('button', { name: 'Record money paid' }).click();
  await page.getByRole('link', { name: 'Add shop expense' }).click();
  const form = page.getByRole('dialog', { name: 'Add Expense' });
  await form.getByLabel('Expense name').fill('Local delivery');
  await form.getByLabel('Paid to').fill('Driver');
  await form.getByLabel('Amount (₹)').fill('200');
  await form.getByRole('button', { name: 'Add Expense' }).click();
  await expect(page.getByText('Local delivery', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid to Driver', { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: /Shop expenses.*₹200/ }).click();
  const details = page.getByRole('dialog', { name: 'Shop expenses' });
  await expect(details.getByText('Local delivery', { exact: true })).toBeVisible();
  await expect(details.getByText(/Driver.*Cash/)).toBeVisible();
  await details.getByRole('link', { name: 'Open source' }).click();
  await expect(page.getByText('Local delivery', { exact: true })).toBeVisible();
});
