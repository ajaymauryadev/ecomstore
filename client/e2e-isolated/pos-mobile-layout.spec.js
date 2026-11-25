import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });

for (const width of [320, 390, 768, 1440]) {
  test(`POS keeps a long bill and payment controls reachable at ${width}px`, async ({ page, storefront }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const email = `pos-layout-${width}@example.com`, password = 'LayoutCheck123!';
    const { product } = await storefront.seedStore(`pos-layout-${width}`, { email, password });
    for (let i = 2; i <= 20; i++) product.variants.push({ name: `Pack ${i}`, retailPrice: 45 + i, stock: 100 });
    await product.save();
    const login = await page.request.post(storefront.apiOrigin + '/api/v1/auth/login', { data: { email, password } });
    expect(login.status()).toBe(200);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(storefront.origin + '/store/pos');
    const catalog = page.locator('.pos-catalog-grid');
    await expect(catalog.getByRole('button')).toHaveCount(20);
    for (let i = 0; i < 20; i++) await catalog.getByRole('button').nth(i).click();
    await expect(page.getByRole('heading', { name: 'Bill Items (20)' })).toBeVisible();
    const dock = page.locator('.pos-checkout');
    const mobile = width < 1024;
    if (mobile) {
      const scroller = page.getByRole('region', { name: 'Sale items and payment' });
      const dockBefore = await dock.boundingBox();
      await catalog.getByRole('button').first().scrollIntoViewIfNeeded();
      const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
      await catalog.getByRole('button').first().hover();
      await page.mouse.wheel(0, 450);
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollBefore + 100);
      expect(await page.evaluate(() => [...document.querySelectorAll('.pos-workspace *')]
        .filter((el) => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        .map((el) => el.className))).toEqual(['pos-content']);
      await page.locator('.pos-cart-list .pos-cart-item').last().getByRole('button', { name: /Increase quantity/ }).click();
      await expect(page.locator('.pos-cart-list .pos-cart-item').last().getByRole('spinbutton', { name: /Quantity/ })).toHaveValue('2');
      await dock.getByRole('link', { name: /Payment Cash/ }).click();
      await expect(page.getByRole('button', { name: 'UPI', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: 'UPI', exact: true }).click();
      await expect(dock).toContainText('Payment UPI');
      await page.getByLabel('Customer name', { exact: true }).fill('Mobile Customer');
      await page.getByLabel('Phone number').fill('9876543210');
      const contentBox = await scroller.boundingBox();
      const phoneBox = await page.getByLabel('Phone number').boundingBox();
      expect(phoneBox.y + phoneBox.height).toBeLessThanOrEqual(contentBox.y + contentBox.height + 1);
      const dockAfter = await dock.boundingBox();
      expect(dockAfter.y).toBeCloseTo(dockBefore.y, 0);
      expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(dockAfter.y);
      const navBox = await page.getByRole('navigation', { name: 'Store shortcuts' }).boundingBox();
      expect(dockAfter.y + dockAfter.height).toBeLessThanOrEqual(navBox.y);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('mobile-payment.png') });
      await page.setViewportSize({ width, height: 560 });
      await page.getByLabel('Phone number').click();
      await expect(dock.getByRole('button', { name: /Collect Payment/ })).toBeInViewport();
      const shortContent = await scroller.boundingBox();
      const focusedPhone = await page.getByLabel('Phone number').boundingBox();
      expect(focusedPhone.y + focusedPhone.height).toBeLessThanOrEqual(shortContent.y + shortContent.height + 1);
      await page.setViewportSize({ width, height: 844 });
      await page.locator('.pos-cart-list .pos-cart-item').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('mobile-bill.png') });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/pos/order'));
    await dock.getByRole('button', { name: /Collect Payment/ }).click();
    expect((await responsePromise).status()).toBe(201);
    await expect(page.getByRole('dialog', { name: 'Bill Generated' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
