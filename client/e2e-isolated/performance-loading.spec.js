import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });

test('low-stock pagination retains direct restock links beyond page one', async ({ page, storefront }) => {
  const email = 'lowstock-owner@example.com', password = 'Performance123!';
  const { store } = await storefront.seedStore('bounded-lowstock', { email, password });
  const products = await storefront.Product.create(Array.from({ length: 15 }, (_, i) => ({
    tenantId: store._id, name: `Low item ${String(i).padStart(2, '0')}`,
    variants: [{ name: 'Pack', retailPrice: 25, stock: 2, lowStockLimit: 5 }],
  })));
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const target = products.at(-1);
  await page.goto(`${storefront.origin}/store/inventory/low-stock?productId=${target._id}&variantId=${target.variants[0]._id}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Low item 14');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('15 variant(s) running low', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'products pagination' })).toContainText('Page 2 of 3');
});

test('loads the requested route code during session restoration without fetching private data early', async ({ page, storefront }) => {
  await storefront.seedStore('parallel-startup');
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let refreshing = false;
  const loadedCode = [];
  const earlyReads = [];
  page.on('request', (request) => {
    if (/\/src\/pages\/customer\/StoreFront\.jsx|\/assets\/StoreFront-/.test(request.url())) loadedCode.push(request.url());
    if (new URL(request.url()).pathname.includes('/api/v1/storefront/')) earlyReads.push(request.url());
  });
  await page.route('**/api/v1/auth/refresh', async (route) => {
    refreshing = true;
    await blocked;
    await route.continue();
  });
  try {
    await page.goto(`${storefront.origin}/s/parallel-startup`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => refreshing).toBe(true);
    await expect.poll(() => loadedCode.length).toBeGreaterThan(0);
    expect(earlyReads).toEqual([]);
  } finally { release(); }
  await expect(page.getByRole('link', { name: 'Pickup Test Kirana home', exact: true })).toBeVisible();
});

test('warms only the adjacent catalog page and reuses it on Next', async ({ page, storefront }) => {
  const slug = 'progressive-cache';
  const { store } = await storefront.seedStore(slug);
  await storefront.Product.create(Array.from({ length: 15 }, (_, index) => ({
    tenantId: store._id, name: `Catalog item ${index}`, isOnline: true,
    variants: [{ name: 'Pack', retailPrice: 25, stock: 50 }],
  })));
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/api/v1/storefront/${slug}/products`) requests.push(url.searchParams.get('page'));
  });
  await page.goto(`${storefront.origin}/s/${slug}`);
  await expect(page.getByRole('navigation', { name: 'products pagination' })).toContainText('Page 1 of 4');
  await expect.poll(() => requests).toEqual(['1', '2']);
  // Waiting beyond several scheduler ticks must not recursively fetch the catalog.
  await page.waitForTimeout(1200);
  expect(requests).toEqual(['1', '2']);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'products pagination' })).toContainText('Page 2 of 4');
  await expect.poll(() => requests).toEqual(['1', '2', '3']);
  expect(requests.filter((number) => number === '2')).toHaveLength(1);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'products pagination' })).toContainText('Page 1 of 4');
  expect(requests.filter((number) => number === '1')).toHaveLength(1);
});

test('inventory typing sends one settled search request', async ({ page, storefront }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const email = 'performance-owner@example.com', password = 'Performance123!';
  await storefront.seedStore('debounced-inventory', { email, password });
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const searches = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/inventory/list' && url.searchParams.get('search')) searches.push(url.searchParams.get('search'));
  });
  await page.goto(`${storefront.origin}/store/inventory`);
  const search = page.getByRole('textbox', { name: 'Search inventory' });
  await expect(search).toBeVisible({ timeout: 20000 });
  await search.pressSequentially('Rice', { delay: 30 });
  await expect.poll(() => searches).toEqual(['Rice']);
  expect(errors).toEqual([]);
});
