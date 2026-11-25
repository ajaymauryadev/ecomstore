import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';
import { readFile } from 'node:fs/promises';

test('owner downloads, previews and imports Excel, then pages products on desktop and mobile', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const email = 'excel-owner@example.com';
  const password = 'Excel-import-test-123';
  const { store } = await storefront.seedStore('excel-import', { email, password });
  await storefront.Product.create(Array.from({ length: 15 }, (_, index) => ({
    tenantId: store._id, name: `Catalog ${String(index).padStart(2, '0')}`,
    variants: [{ name: 'Each', retailPrice: 10, stock: 10 }],
  })));
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.request.post(storefront.origin + '/api/v1/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.goto(storefront.origin + '/store/products');
  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Sample', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('product-import-sample.xlsx');
  const samplePath = await download.path();
  await page.getByRole('button', { name: 'Import Excel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import products from Excel' });
  await dialog.getByLabel('Excel workbook (.xlsx)').setInputFiles({ name: 'products.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(samplePath) });
  await dialog.getByRole('button', { name: 'Validate workbook' }).click();
  await expect(dialog.getByText('Ready to import 1 products with 2 variants')).toBeVisible();
  expect(await storefront.Product.countDocuments({ tenantId: store._id })).toBe(16);
  await dialog.getByRole('button', { name: 'Import products', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await storefront.Product.countDocuments({ tenantId: store._id })).toBe(17);
  expect(await storefront.StockLedger.countDocuments({ tenantId: store._id })).toBe(2);
  const nav = page.getByRole('navigation', { name: 'products pagination' });
  await expect(nav).toContainText('Page 1 of');
  const desktopCards = await page.locator('.catalog-card').count();
  expect(desktopCards).toBeGreaterThan(0);
  expect(desktopCards).toBeLessThan(17);
  const firstName = await page.locator('.catalog-card h2').first().textContent();
  await nav.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(nav).toContainText('Page 2 of');
  await expect(page.locator('.catalog-card h2').first()).not.toHaveText(firstName);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(nav).toContainText('Page 1 of');
  await expect.poll(() => page.locator('.catalog-card').count()).toBeLessThan(desktopCards);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.cache/product-import-pagination-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('small storefront catalogs show every product without pagination on mobile and desktop', async ({ page, storefront }) => {
  const { store } = await storefront.seedStore('paged-storefront');
  await storefront.Product.create(Array.from({ length: 18 }, (_, index) => ({
    tenantId: store._id, name: `Browse ${String(index).padStart(2, '0')}`,
    variants: [{ name: 'Each', retailPrice: 10, stock: 10 }],
  })));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(storefront.origin + '/s/paged-storefront');
  const results = page.getByRole('region', { name: 'Product results' });
  const nav = results.getByRole('navigation', { name: 'products pagination' });
  const cards = results.locator('.storefront-product');
  await expect(cards).toHaveCount(19);
  await expect(nav).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(cards).toHaveCount(19);
  await expect(nav).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search store products' }).fill('Pickup Test Rice');
  await expect(results.getByRole('link', { name: 'Pickup Test Rice', exact: true })).toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(nav).toHaveCount(0);
});
