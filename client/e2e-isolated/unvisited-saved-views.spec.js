import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('an unvisited offline view shows its controls without background downloading unrelated datasets', async ({ page, storefront }) => {
  test.setTimeout(90000);
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  const credentials = { email: 'unvisited-owner@example.com', password: 'SavedViews123!' };
  const { store } = await storefront.seedStore('unvisited-views', credentials);
  await storefront.Supplier.create({ tenantId: store._id, name: 'Prepared Supplier' });
  await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
  const supplierReads = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/suppliers') supplierReads.push(request.url()); });
  await page.goto(storefront.origin + '/store/products');
  await expect(page.getByText('Pickup Test Rice', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.waitForTimeout(500);
  expect(supplierReads).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/store/products');
  await page.context().setOffline(true);
  await page.evaluate(() => {
    history.pushState({}, '', '/store/supplier-payments');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Supplier Payments' })).toBeVisible();
  await expect(page.getByText('This view is waiting for its first download')).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText('Prepared Supplier', { exact: true })).toBeVisible();
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText('Prepared Supplier', { exact: true })).toBeVisible();
});
