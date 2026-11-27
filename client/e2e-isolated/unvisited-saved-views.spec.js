import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('opens unvisited Supplier Dues offline and retains it after reload', async ({ page, storefront }) => {
  test.setTimeout(90000);
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  const credentials = { email: 'unvisited-owner@example.com', password: 'SavedViews123!' };
  const { store } = await storefront.seedStore('unvisited-views', credentials);
  await storefront.Supplier.create({ tenantId: store._id, name: 'Prepared Supplier' });
  await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
  const downloaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/suppliers' && url.searchParams.get('limit') === '5' && response.ok();
  });
  await page.goto(storefront.origin + '/store/products');
  await expect(page.getByText('Pickup Test Rice', { exact: true }).first()).toBeVisible();
  await downloaded;
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe('/store/products');
  await page.context().setOffline(true);
  await page.evaluate(() => {
    history.pushState({}, '', '/store/supplier-payments');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Supplier Payments' })).toBeVisible();
  await expect(page.getByText('Prepared Supplier', { exact: true })).toBeVisible();
  await expect(page.getByText('This view is waiting for its first download')).toHaveCount(0);
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Prepared Supplier', { exact: true })).toBeVisible();
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
});
