import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

const bottom = (page) => page.locator('.customer-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
async function catalog(storefront, slug) {
  const seeded = await storefront.seedStore(slug);
  await storefront.Product.create(Array.from({ length: 45 }, (_, i) => ({
    tenantId: seeded.store._id, name: `Everyday item ${String(i).padStart(2, '0')}`, isOnline: true,
    variants: [{ name: 'Pack', retailPrice: 25, stock: 100 }],
  })));
  return seeded;
}

test('all explored products and scroll position survive an offline reload without visible pagination', async ({ page, storefront }) => {
  test.setTimeout(90000);
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  await catalog(storefront, 'continuous-offline');
  await page.setViewportSize({ width: 393, height: 852 });
  const reads = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/continuous-offline/products')) reads.push(url.searchParams.get('page'));
  });
  await page.goto(`${storefront.origin}/s/continuous-offline`);
  const cards = page.locator('.storefront-product');
  await expect(cards).toHaveCount(20);
  await page.waitForTimeout(600);
  expect(reads).toEqual(['1']);
  await bottom(page);
  await expect(cards).toHaveCount(40);
  await bottom(page);
  await expect(cards).toHaveCount(46);
  expect(reads).toEqual(['1', '2', '3']);
  expect(new Set(await cards.locator('a[aria-label^="View "]').evaluateAll((nodes) => nodes.map((node) => node.href))).size).toBe(46);
  await expect(page.getByRole('navigation', { name: 'products pagination' })).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await bottom(page);
  await page.waitForTimeout(400);
  await page.context().setOffline(true);
  await page.reload();
  await expect(cards).toHaveCount(46);
  await expect(page.locator('.customer-store-note')).toContainText('Offline');
  await expect.poll(() => page.locator('.customer-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(500);
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  await page.context().setOffline(false);
});

test('a delayed or failed next batch keeps existing cards mounted and retries without a request loop', async ({ page, storefront }) => {
  test.setTimeout(90000);
  await catalog(storefront, 'continuous-retry');
  await page.setViewportSize({ width: 393, height: 852 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  await page.route('**/api/v1/storefront/continuous-retry/products?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('page') !== '2') return route.continue();
    requests++;
    if (requests === 1) {
      await held;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporarily busy' }) });
    }
    return route.continue();
  });
  await page.goto(`${storefront.origin}/s/continuous-retry`);
  const cards = page.locator('.storefront-product');
  await expect(cards).toHaveCount(20);
  await cards.first().evaluate((node) => { node.dataset.retained = 'yes'; });
  await bottom(page);
  await expect.poll(() => requests).toBe(1);
  await expect(cards).toHaveCount(20);
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  release();
  await expect(page.locator('.storefront-scroll-end')).toContainText('More products could not be loaded');
  await page.waitForTimeout(600);
  expect(requests).toBe(1);
  await page.locator('.storefront-scroll-end').getByRole('button', { name: 'Try again' }).click();
  await expect(cards).toHaveCount(40);
  await expect(cards.first()).toHaveAttribute('data-retained', 'yes');
  expect(requests).toBe(2);
  await page.getByRole('group', { name: 'Product filters' }).getByRole('button', { name: 'Offers', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).first().click();
  await expect(cards).toHaveCount(20);
});

test('workspace sync is a header icon and customer account has no search or single-page counter', async ({ page, storefront }) => {
  const credentials = { email: 'sync-icon@example.com', password: 'SyncIcon123!' };
  const { store } = await storefront.seedStore('sync-icon', credentials);
  await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
  await page.goto(`${storefront.origin}/store/dashboard`);
  const sync = page.getByRole('banner').getByLabel('Saved data status', { exact: true });
  await expect(sync).toBeVisible();
  expect(await sync.evaluate((node) => ({ position: getComputedStyle(node).position, width: node.getBoundingClientRect().width }))).toEqual({ position: 'relative', width: 44 });
  await sync.getByLabel('Connection and sync details', { exact: true }).click();
  await expect(sync.locator('.saved-data-details')).toBeVisible();
  await sync.getByLabel('Connection and sync details', { exact: true }).click();
  await expect(sync.locator('.saved-data-details')).not.toBeVisible();
  const customer = await storefront.User.create({ name: 'Account Tester', phone: '9876001200', password: 'AccountTest123!', role: 'customer', tenantId: store._id });
  await page.request.post(`${storefront.apiOrigin}/api/v1/storefront/sync-icon/auth/login`, { data: { phone: customer.phone, password: 'AccountTest123!' } });
  // A new context avoids intentionally restoring the previous owner identity.
  const context = await page.context().browser().newContext({ storageState: await page.context().storageState() });
  const accountPage = await context.newPage();
  try {
    await accountPage.goto(`${storefront.origin}/s/sync-icon/account`);
    await expect(accountPage.getByRole('heading', { name: 'My Account' })).toBeVisible();
    await expect(accountPage.getByRole('textbox', { name: 'Search store products' })).toHaveCount(0);
    await expect(accountPage.getByRole('navigation', { name: 'saved addresses pagination' })).toHaveCount(0);
    await expect(accountPage.locator('.saved-data-status')).toHaveCount(0);
  } finally { await context.close(); }
});
