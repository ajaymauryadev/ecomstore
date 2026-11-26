import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });

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
