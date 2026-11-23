import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const store = {
  _id: 'store-ui', name: 'Neighborhood Market', slug: 'ui-market',
  orderSettings: { isAcceptingOrders: true, allowGuest: true },
  deliverySettings: { minOrderAmount: 100, defaultCharge: 40, freeDeliveryAbove: 500 },
};
const product = {
  _id: '123456789012345678901234', name: 'Premium Basmati Rice', brand: 'Market Mill',
  isOnline: true, isActive: true, images: [], categoryId: { _id: 'grains', name: 'Grains' },
  variants: [{ _id: '123456789012345678901235', name: '1 kg bag', unit: 'kg', stock: 12, retailPrice: 120, offerPrice: 100, isActive: true }],
};
const order = {
  _id: 'order-ui', orderNumber: 'ORD-2026-01042', orderType: 'home_delivery',
  status: 'pending', paymentMethod: 'cod', paymentStatus: 'pending',
  createdAt: '2026-11-22T04:03:00Z', updatedAt: '2026-11-22T04:03:00Z',
  items: [{ _id: 'line-ui', name: product.name, variantName: '1 kg bag', quantity: 2, price: 100, mrp: 120, total: 200 }],
  pricing: { subtotal: 200, deliveryCharge: 40, grandTotal: 240 },
  customerInfo: { name: 'Mira Sharma', phone: '9876543210', address: { line1: '105, Community Centre', city: 'Delhi', pincode: '110017' } },
  timeline: [{ status: 'pending', message: 'Order placed', timestamp: '2026-11-22T04:03:00Z' }],
};

async function mockUI(page, role = 'customer') {
  const issues = [];
  page.on('pageerror', (error) => issues.push(error.message));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let data = [];
    if (path === '/auth/refresh') data = { user: { _id: 'ui-user', name: 'Mira Sharma', role, tenantId: store._id, permissions: [] }, accessToken: 'ui-token', store };
    else if (path === '/stores/mine' || path === '/storefront/ui-market') data = { store };
    else if (path.endsWith('/customer/profile')) data = { user: { name: 'Mira Sharma', phone: '9876543210', savedAddresses: [] } };
    else if (path.endsWith('/customer/favorites')) data = { products: [] };
    else if (path.endsWith('/cart/products')) data = { products: [product] };
    else if (path.endsWith('/products/' + product._id)) data = { product, relatedProducts: [] };
    else if (path.endsWith('/products')) data = [product];
    else if (path.endsWith('/categories')) data = { categories: [{ _id: 'grains', name: 'Grains' }] };
    else if (path.endsWith('/orders/order-ui')) data = { order };
    else if (path === '/storefront/ui-market/orders') data = [order];
    else if (path === '/suppliers') data = { suppliers: [] };
    else if (path === '/purchases') data = { purchases: [] };
    else if (path === '/plans') data = { plans: [] };
    else if (path === '/super-admin/stores/store-ui') data = { store: { ...store, createdAt: order.createdAt, subscription: {}, limits: {}, usage: {} }, stats: {} };
    else if (path.includes('/dashboard')) data = { kpis: {}, stats: {}, pendingOrders: [], lowStock: [] };
    else if (path === '/super-admin/stats') data = { totalStores: 0, recentStores: [], planDistribution: [] };
    return route.fulfill({ json: { status: 'success', data, meta: { page: 1, total: 0, totalPages: 1 } } });
  });
  return issues;
}

async function checkLayout(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const scroller of await page.locator('.customer-scroll, .workspace-main').all()) {
    expect(await scroller.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0);
}

for (const width of [320, 1440]) {
  test(`catalog, product controls and category links work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const issues = await mockUI(page);
    await page.goto('/s/ui-market');
    await expect(page.getByRole('heading', { name: 'Welcome to ' + store.name })).toBeVisible();
    await checkLayout(page, width);
    await checkAccessibility(page);
    await page.screenshot({ path: `.cache/ui-review/storefront-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: product.name, exact: true }).click();
    await page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
    await page.getByRole('button', { name: 'Close cart' }).click();
    await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
    await checkLayout(page, width);
    await checkAccessibility(page);
    await page.getByRole('link', { name: 'Grains', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Grains', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(issues).toEqual([]);
  });
}

async function checkAccessibility(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  })).violations.filter((item) => ['serious', 'critical'].includes(item.impact))
    .map((item) => ({ rule: item.id, nodes: item.nodes.map((node) => node.target) })));
  expect(violations).toEqual([]);
}

for (const width of [320, 390, 820, 1440, 1920]) {
  test(`tracking content, card spacing and current step remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const issues = await mockUI(page);
    await page.goto('/s/ui-market/orders/order-ui');
    await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Order Placed');
    const cards = page.locator('.order-tracking .card');
    for (const card of await cards.all()) {
      expect(await card.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(20);
    }
    await checkLayout(page, width);
    await checkAccessibility(page);
    await page.screenshot({ path: `.cache/ui-review/order-tracking-${width}.png`, fullPage: true });
    expect(issues).toEqual([]);
  });
}

test('packed and pickup orders highlight a real step; cancelled and partial orders do not show a misleading tracker', async ({ page }) => {
  await mockUI(page);
  for (const [status, orderType, label] of [
    ['packed', 'home_delivery', 'Packed'], ['ready_for_pickup', 'self_pickup', 'Ready for Pickup'],
    ['delivered', 'home_delivery', 'Delivered'], ['cancelled', 'home_delivery', null],
    ['partially_fulfilled', 'home_delivery', null],
  ]) {
    await page.route('**/api/v1/storefront/ui-market/orders/order-ui', (route) => route.fulfill({ json: { data: { order: { ...order, status, orderType } } } }));
    await page.goto('/s/ui-market/orders/order-ui');
    await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
    if (label) await expect(page.locator('[aria-current="step"]')).toContainText(label);
    else await expect(page.getByRole('list', { name: 'Order progress' })).toHaveCount(0);
  }
});

test('order network failure provides a working retry and cancel dialog preserves keyboard focus', async ({ page }) => {
  await mockUI(page);
  let failed = true;
  await page.route('**/api/v1/storefront/ui-market/orders/order-ui', (route) => route.fulfill({
    status: failed ? 422 : 200,
    json: failed ? { message: 'Connection interrupted. Try again.' } : { data: { order } },
  }));
  await page.goto('/s/ui-market/orders/order-ui');
  await expect(page.getByRole('alert')).toContainText('Connection interrupted');
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  const cancel = page.getByRole('button', { name: 'Cancel Order', exact: true });
  await cancel.click();
  await expect(page.getByRole('dialog', { name: 'Cancel Order?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cancel).toBeFocused();
});

test('storefront, cart and checkout fit narrow phones and cart traps and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const issues = await mockUI(page);
  await page.goto('/s/ui-market');
  await page.getByRole('button', { name: `Add ${product.name} to cart` }).click();
  await checkLayout(page, 320);
  await checkAccessibility(page);
  const opener = page.getByRole('button', { name: 'Open cart with 1 items' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'My Cart (1)' });
  await expect(page.getByRole('button', { name: 'Close cart' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Proceed to Checkout' })).toBeFocused();
  await checkAccessibility(page);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.getByRole('link', { name: 'Categories', exact: true }).click();
  await page.goto('/s/ui-market/cart');
  await expect(page.getByRole('heading', { name: 'My Cart' })).toBeVisible();
  await expect(page.getByText('Add ₹400 more for free delivery')).toBeVisible();
  await checkLayout(page, 320);
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await checkLayout(page, 320);
  await checkAccessibility(page);
  expect(issues).toEqual([]);
});

for (const width of [320, 390, 820, 1440]) {
  test(`owner screen audit at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    const issues = await mockUI(page, 'store_owner');
    for (const [path, title] of [
      ['products', 'Products'], ['products/new', 'Add Product'], ['categories', 'Categories'],
      ['suppliers', 'Suppliers'], ['purchases', 'Purchases'], ['purchases/new', 'New Purchase Entry'],
      ['inventory', 'Inventory'], ['inventory/low-stock', 'Low Stock Alert'], ['orders', 'Orders'],
      ['orders/payment-queue', 'Payment Verification'], ['packing', 'Packing Queue'], ['staff-activity', 'Staff Activity'],
      ['staff', 'Staff and Fulfillment'], ['daily-closing', 'Daily Closing'], ['returns', 'Returns & Exchange'],
      ['udhar', 'Udhar Khata'], ['expenses', 'Expenses'], ['salary', 'Staff Salary'],
      ['supplier-payments', 'Supplier Payments'], ['profit-loss', 'Profit & Loss'], ['reports', 'Reports'],
      ['coupons', 'Coupons'], ['offers', 'Offers & Deals'], ['settings', 'Store Settings'],
      ['notifications', 'Notifications'], ['backup', 'Backup & Export'], ['audit-logs', 'Audit Logs'],
    ]) {
      await test.step(path, async () => {
        await page.goto('/store/' + path);
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await checkLayout(page, width);
        if (['products', 'settings', 'reports'].includes(path) && [390, 1440].includes(width)) {
          await page.screenshot({ path: `.cache/ui-review/owner-${path}-${width}.png`, fullPage: true });
        }
      });
    }
    expect(issues).toEqual([]);
  });
}

test('payment proof form is accessible and rejects unsupported files without submitting', async ({ page }) => {
  await mockUI(page);
  await page.route('**/api/v1/storefront/ui-market/orders/order-ui', (route) => route.fulfill({ json: { data: {
    order: { ...order, status: 'payment_pending', paymentMethod: 'upi_id' }, paymentInfo: { upiId: 'store@example' },
  } } }));
  await page.goto('/s/ui-market/orders/order-ui');
  await expect(page.getByLabel('UTR / Reference number', { exact: true })).toBeVisible();
  await checkAccessibility(page);
  await page.getByLabel('Payment screenshot', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('status').filter({ hasText: 'Choose a JPG' })).toBeVisible();
  await expect(page.getByAltText('Preview', { exact: true })).toHaveCount(0);
});

test('settings tabs, delivery area editor and switches work at 320px with accessible fields', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 320, height: 800 });
  const issues = await mockUI(page, 'store_owner');
  await page.goto('/store/settings');
  await expect(page.getByRole('heading', { name: 'Store Settings' })).toBeVisible();
  for (const name of ['Shop Info', 'Payments', 'Delivery', 'Hours', 'Orders', 'GST / Tax']) {
    await page.getByRole('button', { name, exact: true }).click();
    if (name === 'Delivery') {
      await page.getByRole('button', { name: 'Add Delivery Area' }).click();
      await page.getByLabel('Delivery area 1 name', { exact: true }).fill('Community Centre');
      await checkLayout(page, 320);
      await page.getByRole('button', { name: 'Remove delivery area 1' }).click();
    }
    await checkLayout(page, 320);
    await checkAccessibility(page);
  }
  expect(issues).toEqual([]);
});

test('every report tab remains usable on a phone', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  const issues = await mockUI(page, 'store_owner');
  await page.goto('/store/reports');
  const tabs = page.getByRole('group', { name: 'Report selection' }).getByRole('button');
  await expect(tabs).toHaveCount(11);
  for (const tab of await tabs.all()) {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await checkLayout(page, 390);
  }
  expect(issues).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`super admin and account screen audit at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const issues = await mockUI(page, 'super_admin');
    for (const [path, title] of [
      ['/super-admin/dashboard', 'System Overview'], ['/super-admin/stores', 'All Stores'],
      ['/super-admin/stores/store-ui', store.name], ['/super-admin/plans', 'Plans & Pricing'],
      ['/super-admin/audit-logs', 'System Audit Logs'],
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await checkLayout(page, width);
    }
    await page.unroute('**/api/v1/**');
    issues.push(...await mockUI(page));
    for (const [path, title] of [['/s/ui-market/account', 'My Account'], ['/s/ui-market/orders', 'My Orders']]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await checkLayout(page, width);
      await checkAccessibility(page);
    }
    expect(issues).toEqual([]);
  });
}
