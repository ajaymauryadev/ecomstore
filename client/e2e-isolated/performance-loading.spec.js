import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });

test('fetches only one catalog batch at a time and reuses downloaded products on navigation', async ({ page, storefront }) => {
  const slug = 'progressive-cache';
  const { store } = await storefront.seedStore(slug);
  await storefront.Product.create(Array.from({ length: 45 }, (_, index) => ({
    tenantId: store._id, name: `Catalog item ${index}`, isOnline: true,
    variants: [{ name: 'Pack', retailPrice: 25, stock: 50 }],
  })));
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/api/v1/storefront/${slug}/products`) requests.push(url.searchParams.get('page'));
  });
  await page.goto(`${storefront.origin}/s/${slug}`);
  await expect(page.locator('.storefront-product')).toHaveCount(20);
  await expect.poll(() => requests).toEqual(['1']);
  // Waiting beyond several scheduler ticks must not recursively fetch the catalog.
  await page.waitForTimeout(1200);
  expect(requests).toEqual(['1']);
  await page.locator('.customer-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(page.locator('.storefront-product')).toHaveCount(40);
  await expect.poll(() => requests).toEqual(['1', '2']);
  expect(requests.filter((number) => number === '2')).toHaveLength(1);
  await page.getByRole('link', { name: 'Login', exact: true }).click();
  await page.goBack();
  await expect(page.locator('.storefront-product')).toHaveCount(40);
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
