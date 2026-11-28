import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('renders the app shell before JavaScript or session requests finish', async ({ page, storefront }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(/\/(?:src\/main\.jsx|assets\/index-[^/]+\.js)(?:\?.*)?$/, async (route) => {
    await held;
    await route.continue();
  });
  const navigation = page.goto(storefront.origin + '/login', { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByLabel('Opening Smart Kirana')).toBeVisible();
    await expect(page.locator('.startup-header')).toContainText('Smart Kirana');
    expect(await page.locator('main').boundingBox()).not.toBeNull();
  } finally { release(); await navigation; }
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('an uncached offline view keeps navigation, page controls and its placeholder layout', async ({ page, storefront }) => {
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  const credentials = { email: 'stable-missing@example.com', password: 'StableMissing123!' };
  await storefront.seedStore('stable-missing', credentials);
  await page.route('**/api/v1/audit-logs?*', (route) => route.abort());
  await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
  await page.goto(storefront.origin + '/store/products');
  await expect(page.getByText('Pickup Test Rice', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.context().setOffline(true);
  await page.evaluate(() => { history.pushState({}, '', '/store/audit-logs'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('heading', { name: 'Audit Logs', exact: true })).toBeVisible();
  await expect(page.getByText('This view is waiting for its first download')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Store navigation', exact: true })).toBeVisible();
  await expect(page.locator('main input').first()).toBeVisible();
  await expect(page.getByText('Loading Smart Kirana...')).toHaveCount(0);
  await page.context().setOffline(false);
});
