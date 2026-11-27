import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('customer storefront stays light, responsive and usable without a floating cache notice', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const { store, product } = await storefront.seedStore('customer-design');
  const { default: Category } = await import('../../server/src/models/Category.js');
  await Category.create(['Dairy', 'Grains', 'Snacks', 'Home care', 'Beverages', 'Personal care'].map((name, i) => ({
    tenantId: store._id, name, emoji: ['🥛', '🌾', '🍪', '🧹', '🧃', '🧴'][i], sortOrder: i,
  })));
  product.variants[0].offerPrice = 85;
  product.isFeatured = true;
  await product.save();
  const errors = [];
  const productReads = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/customer-design/products')) productReads.push(url.search);
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(`${storefront.origin}/s/customer-design`);
  await expect(page.getByRole('link', { name: 'Pickup Test Rice', exact: true })).toBeVisible();
  await expect(page.locator('.saved-data-status')).toHaveCount(0);
  await expect(page.locator('.customer-store-name')).toHaveText(store.name);
  await expect(page.getByRole('textbox', { name: 'Search store products' })).toBeVisible();
  await page.waitForTimeout(800);
  expect(productReads).toHaveLength(1); // Promotion links use the existing catalog, with no extra feeds.
  await page.screenshot({ path: '.cache/customer-storefront-mobile.png' });
  for (const width of [320, 393, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.customer-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: '.cache/customer-storefront-desktop.png' });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: 'Add Pickup Test Rice to cart', exact: true }).scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const addToCartPaintMs = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      const start = performance.now();
      document.querySelector('[aria-label="Add Pickup Test Rice to cart"]').click();
      requestAnimationFrame(() => resolve(performance.now() - start));
    });
  }));
  expect(addToCartPaintMs).toBeLessThan(250);
  await test.info().attach('customer-interaction-performance', {
    body: JSON.stringify({ cpuSlowdown: 4, addToCartPaintMs, initialProductReads: productReads.length }), contentType: 'application/json',
  });
  const card = page.locator('.storefront-product');
  await expect(card.getByRole('button', { name: 'Increase quantity of Pickup Test Rice' })).toBeEnabled();
  await expect(card.getByText('1', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Decrease quantity of Pickup Test Rice' }).click();
  await expect(card.getByRole('button', { name: 'Add Pickup Test Rice to cart' })).toBeEnabled();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // Carousel responds to user input; it has no automatic rotation timer.
  await page.getByRole('button', { name: 'Next highlight' }).click();
  await expect(page.getByRole('heading', { name: 'A little more for your basket.' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous highlight' }).click();
  await expect(page.getByRole('heading', { name: 'Your everyday, sorted.' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Discover your store' }).getByRole('link', { name: 'Explore offers' }).click();
  await expect(page).toHaveURL(/offer=true/);
  await expect(card).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).first().click();
  await page.getByRole('button', { name: 'Browse categories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All Categories', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
