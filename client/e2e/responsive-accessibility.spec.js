import { expect, test } from '@playwright/test';

const runtimeIssues = new WeakMap();
test.beforeEach(async ({ page }) => {
  const issues = [];
  runtimeIssues.set(page, issues);
  page.on('console', (message) => {
    const text = message.text();
    const expectedHttpRejection = /Failed to load resource:.*status of 4\d\d/i.test(text);
    if (message.type() === 'error' && !expectedHttpRejection) issues.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => issues.push(`page: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) issues.push(`http ${response.status()}: ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || '';
    if (!reason.includes('ERR_ABORTED')) issues.push(`network: ${request.url()} (${reason})`);
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeIssues.get(page) || []).toEqual([]);
});

const json = (data, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

const currentUser = (role) => ({
  _id: `${role}-user`,
  name: role === 'delivery' ? 'Delivery Partner' : role === 'super_admin' ? 'System Admin' : role === 'store_owner' ? 'Store Owner' : 'Staff Member',
  email: `${role}@example.test`,
  role,
  permissions: [],
});

const rice = {
  _id: 'rice-product', name: 'Basmati Rice', brand: 'Market Mill', isActive: true, isOnline: true, stockStatus: 'low_stock',
  categoryId: { _id: 'grains', name: 'Grains' }, images: [],
  variants: [{ _id: 'rice-variant', name: '1 kg bag', unit: 'kg', stock: 2, lowStockLimit: 3, retailPrice: 100, isActive: true }],
};
const pendingOrder = {
  _id: 'pending-1', orderNumber: 'ORD-WORKSPACE-01', status: 'pending', paymentStatus: 'pending', paymentMethod: 'cod',
  orderType: 'self_pickup', customerInfo: { name: 'Mira Sharma', phone: '9876543210' }, pricing: { grandTotal: 100 },
  items: [], createdAt: '2026-11-21T08:30:00Z', timeline: [],
};

const mockApi = async (page, role = null, options = {}) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/refresh')) {
      if (!role) return route.fulfill(json({ status: 'error', message: 'Refresh token not found.' }, 401));
      return route.fulfill(json({ status: 'success', data: {
        user: currentUser(role),
        accessToken: `mock-${role}-access`,
        store: role === 'super_admin' ? null : { _id: 'store-1', name: 'Responsive Kirana', slug: 'responsive-kirana' },
      } }));
    }
    if (path.endsWith('/dashboard')) {
      if (role === 'store_owner') return route.fulfill(json({ status: 'success', data: {
        kpis: { revenueToday: 1250, pendingOrderCount: 1, lowStockCount: 1 },
        pendingOrders: [pendingOrder],
        lowStock: [{ _id: rice._id, variantId: rice.variants[0]._id, name: rice.name, variantName: '1 kg bag', stock: 2, unit: 'kg' }],
      } }));
      if (role === 'delivery') return route.fulfill(json({ status: 'success', data: { stats: { assignedOrders: 2, deliveredToday: 1 }, pendingOrders: [] } }));
      return route.fulfill(json({ status: 'success', data: { stats: { salesToday: 500, ordersToday: 2, itemsPacked: 5, assignedOrders: 1 }, pendingOrders: [] } }));
    }
    if (path.endsWith('/super-admin/stats')) return route.fulfill(json({ status: 'success', data: { totalStores: 2, activeStores: 2, totalUsers: 8, expiringThisWeek: 0, recentStores: [], planDistribution: [] } }));
    if (path.includes('/storefront/missing-store')) return route.fulfill(json({ status: 'error', message: 'Store not found.' }, 404));
    if (path === '/api/v1/storefront/responsive-kirana') return route.fulfill(json({ status: 'success', data: { store: { _id: 'store-1', name: 'Responsive Kirana', slug: 'responsive-kirana', orderSettings: { isAcceptingOrders: true, allowGuest: true }, deliverySettings: { minOrderAmount: 100, freeDeliveryAbove: 500 } } } }));
    if (path.includes('/storefront/responsive-kirana/products')) return route.fulfill(json({ status: 'success', data: [], meta: { page: 1, totalPages: 1, hasNextPage: false } }));
    if (path.includes('/storefront/responsive-kirana/categories')) return route.fulfill(json({ status: 'success', data: { categories: [] } }));
    if (path.endsWith('/users/staff')) return route.fulfill(json({ status: 'success', data: [], meta: { page: 1, totalPages: 1 } }));
    if (path.endsWith('/delivery/orders')) return route.fulfill(json({ status: 'success', data: [], meta: { page: 1, totalPages: 1 } }));
    if (options.failProducts && path === '/api/v1/products') return route.fulfill(json({ status: 'error', message: 'Catalog service failed.' }, 422));
    if (path === '/api/v1/products') {
      const products = [rice, ...Array.from({ length: (options.catalogSize || 1) - 1 }, (_, index) => ({
        ...rice, _id: 'catalog-' + index, name: 'Samaan ' + index,
        variants: rice.variants.map((v) => ({ ...v, _id: 'pack-' + index })),
      }))];
      return route.fulfill(json({ data: products, meta: { page: 1, total: products.length, totalPages: 1 } }));
    }
    if (path === '/api/v1/products/rice-product') return route.fulfill(json({ data: { product: rice } }));
    if (path.endsWith('/products/rice-product/toggle/isOnline')) return route.fulfill(json({ data: { product: rice } }));
    if (path === '/api/v1/inventory/list') return route.fulfill(json({ data: { products: [rice] }, meta: { page: 1, total: 1, totalPages: 1 } }));
    if (path.endsWith('/admin/orders')) return route.fulfill(json({ data: [pendingOrder], meta: { page: 1, total: 1, totalPages: 1 } }));
    if (path.endsWith('/admin/orders/pending-1')) return route.fulfill(json({ data: { order: pendingOrder } }));
    if (path === '/api/v1/udhar') return route.fulfill(json({ data: [{ _id: 'credit-1', name: 'Mira Sharma', phone: '9876543210', balance: 150, creditLimit: 500 }] }));
    if (path === '/api/v1/reports/daily-sales') return route.fulfill(json({ data: { total: 1250, hours: [{ hour: 9, label: '09:00', sales: 1250, orders: 4 }] } }));
    if (path === '/api/v1/pos/order') {
      const bill = route.request().postDataJSON();
      return route.fulfill(json({ data: { order: {
        ...pendingOrder, status: 'delivered', paymentMethod: bill.paymentMethod,
        orderNumber: 'POS-WORKSPACE-01', pricing: { subtotal: 100, grandTotal: 100 },
        items: [{ _id: 'line-1', name: rice.name, quantity: 1, price: 100, total: 100 }],
      } } }, 201));
    }
    return route.fulfill(json({ status: 'success', data: [], meta: { page: 1, total: 0, totalPages: 1 } }));
  });
};

const assertNoPageOverflow = async (page, width) => {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.clientWidth).toBe(width);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`owner dashboard is usable without page clipping at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApi(page, 'store_owner');
    await page.goto('/store/dashboard');
    await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Bill' })).toBeVisible();
    await expect(page.getByText("Today's sales", { exact: true })).toBeVisible();
    await expect(page.getByText('Pending orders', { exact: true })).toBeVisible();
    await expect(page.getByText('Low stock', { exact: true })).toBeVisible();
    await assertNoPageOverflow(page, viewport.width);
    if (viewport.width < 1024) await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('dashboard-' + viewport.width + '.png'), animations: 'disabled' });
  });
}

test('super-admin provides a working mobile drawer and desktop navigation', async ({ page }) => {
  await mockApi(page, 'super_admin');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/super-admin/dashboard');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Super admin navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All Stores' })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await assertNoPageOverflow(page, 390);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Super admin navigation' })).toBeVisible();
  await assertNoPageOverflow(page, 1440);
});

test('owner drawer is keyboard accessible and dashboard links open the pending order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'store_owner');
  await page.goto('/store/dashboard');
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.press('Enter');
  const nav = page.getByRole('navigation', { name: 'Store navigation' });
  await nav.getByRole('button', { name: 'Insights', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(1);
  await expect(nav.getByRole('button', { name: 'Sales', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await page.getByRole('link', { name: /Mira Sharma/ }).click();
  await expect(page.getByRole('dialog', { name: pendingOrder.orderNumber })).toBeVisible();
  await assertNoPageOverflow(page, 390);
});

test('POS keeps search, receipt preview and payment reachable on a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'store_owner');
  await page.goto('/store/pos');
  const checkout = page.getByRole('button', { name: /Collect Payment/ });
  await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
  await expect(checkout).toBeDisabled();
  await page.getByRole('searchbox', { name: 'Search or scan barcode' }).fill('Basmati');
  await page.getByRole('button', { name: /Basmati Rice/ }).click();
  const receipt = page.getByRole('region', { name: 'Receipt preview' });
  await expect(receipt.getByRole('list', { name: 'Receipt items' })).toContainText('1 × Basmati Rice');
  await expect(receipt).toContainText('Subtotal');
  await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
  await page.getByRole('link', { name: 'Payment Cash' }).click();
  await page.getByRole('button', { name: 'UPI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'UPI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
  await assertNoPageOverflow(page, 390);
  await checkout.click();
  await expect(page.getByRole('dialog', { name: 'Bill Generated' })).toContainText('POS-WORKSPACE-01');
});

test('mobile product and inventory rows stack, and desktop table controls work by keyboard', async ({ page }) => {
  await mockApi(page, 'store_owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/store/products');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Basmati Rice' })).toHaveCSS('display', 'grid');
  await assertNoPageOverflow(page, 390);
  await page.goto('/store/inventory');
  await expect(page.getByRole('row').filter({ hasText: 'Basmati Rice' })).toHaveCSS('display', 'grid');
  await assertNoPageOverflow(page, 390);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/store/products');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  const list = page.getByRole('region', { name: 'Product list' });
  const row = list.getByRole('row').filter({ hasText: 'Basmati Rice' });
  await expect(row).toHaveCSS('display', 'table-row');
  await list.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Storefront visibility for Basmati Rice' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('status').filter({ hasText: 'Product updated' })).toBeVisible();
  await expect(page).toHaveURL(/\/store\/products$/);
  const edit = page.getByRole('link', { name: 'Edit Basmati Rice' });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
});

test('mobile orders, Udhar and reports show their data without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'store_owner');
  for (const [path, heading, detail] of [
    ['/store/orders', 'Orders', pendingOrder.orderNumber],
    ['/store/udhar', 'Udhar accounts', 'Mira Sharma'],
    ['/store/reports', 'Reports', 'Hourly Breakdown'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(detail, { exact: true })).toBeVisible();
    await assertNoPageOverflow(page, 390);
  }
});

test('a product load error shows the API message and retry action', async ({ page }) => {
  await mockApi(page, 'store_owner', { failProducts: true });
  await page.goto('/store/products');
  const error = page.getByRole('alert');
  await expect(error).toContainText('Catalog service failed.');
  await expect(error.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('owner navigation stays mounted while a slow route chunk loads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, 'store_owner');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/src/pages/store-owner/inventory/InventoryDashboard.jsx*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/store/dashboard');
  const nav = page.getByRole('navigation', { name: 'Store navigation' });
  await nav.evaluate((element) => { element.dataset.smokeIdentity = 'mounted'; });
  try {
    await nav.getByRole('button', { name: 'Catalog', exact: true }).click();
    await nav.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Loading page' })).toBeVisible();
    await expect(nav).toHaveAttribute('data-smoke-identity', 'mounted');
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect(nav).toHaveAttribute('data-smoke-identity', 'mounted');
});

test('owner warmup makes the first Products navigation reuse the first-page data', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, 'store_owner');
  let productReads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/products') productReads++;
  });
  const warmed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/products');
  await page.goto('/store/dashboard');
  await warmed;
  await page.getByRole('navigation', { name: 'Store navigation' }).getByRole('button', { name: 'Catalog', exact: true }).click();
  await page.getByRole('navigation', { name: 'Store navigation' }).getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByText('Basmati Rice', { exact: true })).toBeVisible();
  // POS and the product list have different, bounded first-page caches.
  expect(productReads).toBe(2);
});

test('packer, delivery and customer screens also fit a desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [role, destination, label] of [
    ['packer', '/staff/packing', 'Packing'],
    ['delivery', '/staff/deliveries', 'Deliveries'],
    ['customer', '/s/responsive-kirana', 'Welcome to Responsive Kirana'],
  ]) {
    await page.unroute('**/api/v1/**');
    await mockApi(page, role);
    await page.goto(destination);
    if (role === 'customer') {
      await expect(page.getByRole('heading', { name: label })).toBeVisible();
    } else {
      const nav = page.getByRole('navigation', { name: 'Staff navigation' });
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(nav.getByRole('link', { name: 'POS', exact: true })).toHaveCount(0);
    }
    await assertNoPageOverflow(page, 1440);
  }
});

test('delivery root redirect lands on its real dashboard and exposes only delivery navigation', async ({ page }) => {
  await mockApi(page, 'delivery');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/staff\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Deliveries', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /POS/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Packing/i })).toHaveCount(0);
});

test('staff and packer receive functional role-scoped workflows on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'staff');
  await page.goto('/staff/orders');
  await expect(page.getByRole('heading', { name: 'Store orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deliveries', exact: true })).toHaveCount(0);
  await assertNoPageOverflow(page, 390);

  await page.unroute('**/api/v1/**');
  await mockApi(page, 'packer');
  await page.goto('/staff/dashboard');
  await expect(page.getByRole('link', { name: /Packing/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /POS/i })).toHaveCount(0);
});

test('mobile storefront has a visible login action and distinguishes unavailable stores', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/s/responsive-kirana');
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  const welcome = page.getByRole('heading', { name: 'Welcome to Responsive Kirana' });
  await expect(welcome).toBeVisible();
  await expect(page.locator('.customer-layout')).toHaveCSS('background-color', 'rgb(244, 246, 250)');
  await expect(page.getByRole('banner')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(welcome.locator('..')).toHaveCSS('background-color', 'rgb(234, 242, 255)');
  await expect(welcome).toHaveCSS('color', 'rgb(18, 35, 62)');
  await assertNoPageOverflow(page, 390);
  await page.goto('/s/missing-store');
  await expect(page.getByRole('heading', { name: 'Store unavailable' })).toBeVisible();
  await expect(page.getByText(/inactive, expired, or the address is incorrect/i)).toBeVisible();
});

test('shared modal works by keyboard in the live responsive owner workflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'store_owner');
  await page.goto('/store/staff');
  const opener = page.getByRole('button', { name: 'Add staff' }).first();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Add staff member' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Create account' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('owner can download the tenant backup using their active session', async ({ page }) => {
  await mockApi(page, 'store_owner');
  await page.route('**/api/v1/backup/full', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer mock-store_owner-access');
    await route.fulfill({
      json: { version: '2.0', kind: 'owner' },
      headers: {
        'content-disposition': 'attachment; filename="backup-responsive-kirana.json"',
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.goto('/store/backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Full Backup' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('backup-responsive-kirana.json');
});

test('pricing fits the shared page width at phone, tablet, laptop and wide desktop sizes', async ({ page }) => {
  await mockApi(page, 'super_admin');
  await page.route('**/api/v1/plans', (route) => route.fulfill(json({ data: { plans: [
    { _id: 'test-plan', name: 'basic', displayName: 'Neighborhood Plan', price: 100, limits: {}, modules: [], isActive: true },
  ] } })));
  for (const width of [320, 480, 768, 1024, 1366, 1920, 2560]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/super-admin/plans');
    await expect(page.getByRole('heading', { name: 'Neighborhood Plan' })).toBeVisible();
    await assertNoPageOverflow(page, width);
    const pricing = await page.getByRole('main').boundingBox();
    await page.goto('/super-admin/dashboard');
    const dashboard = page.getByRole('main');
    await expect(dashboard).toBeVisible();
    expect((await dashboard.boundingBox()).width).toBe(pricing.width);
    expect((await dashboard.boundingBox()).x).toBe(pricing.x);
  }
});

test('shop bottom navigation opens categories, cart and sign-in on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockApi(page);
  await page.route('**/storefront/responsive-kirana/categories', (route) => route.fulfill(json({ data: {
    categories: [{ _id: 'grains', name: 'Grains' }],
  } })));
  await page.goto('/s/responsive-kirana');
  const nav = page.getByRole('navigation', { name: 'Shop navigation' });
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Categories' }).click();
  await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Categories' })).toHaveAttribute('aria-current', 'page');
  const filter = page.getByRole('button', { name: 'Grains' });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await assertNoPageOverflow(page, 320);

  await nav.getByRole('button', { name: 'Open cart with 0 items' }).click();
  await expect(page.getByRole('heading', { name: 'My Cart (0)' })).toBeInViewport();
  await page.getByRole('button', { name: 'Close cart' }).click();
  await nav.getByRole('link', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(nav).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to store' }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(nav).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open cart with 0 items' })).toBeVisible();
});

test('owner bottom shortcuts highlight billing and products, and More opens all tools', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mockApi(page, 'store_owner');
  await page.goto('/store/pos');
  const shortcuts = page.getByRole('navigation', { name: 'Store shortcuts' });
  await expect(shortcuts.getByRole('link', { name: 'POS', exact: true })).toHaveAttribute('aria-current', 'page');
  await assertNoPageOverflow(page, 360);
  await shortcuts.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(shortcuts.getByRole('link', { name: 'Products', exact: true })).toHaveAttribute('aria-current', 'page');
  await shortcuts.getByRole('button', { name: 'More' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'Administration', exact: true }).click();
  await expect(drawer.getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shortcuts.getByRole('button', { name: 'More' })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(shortcuts).toBeHidden();
});

for (const width of [390, 820]) {
  test('category form keeps focus while typing and submits both fields at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await mockApi(page, 'store_owner');
    let payload;
    await page.route('**/api/v1/categories', (route) => {
      if (route.request().method() === 'POST') {
        payload = route.request().postDataJSON();
        return route.fulfill(json({ data: payload }, 201));
      }
      return route.fulfill(json({ data: { categories: [] } }));
    });
    const warnings = [];
    page.on('console', (message) => {
      if (message.text().includes('Blocked aria-hidden')) warnings.push(message.text());
    });

    await page.goto('/store/categories');
    const opener = page.getByRole('button', { name: 'Add Category', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Add Category' });
    const name = dialog.getByRole('textbox', { name: 'Category Name' });
    await expect(name).toBeFocused();
    await page.keyboard.type('Rice and Grains', { delay: 25 });
    await expect(name).toHaveValue('Rice and Grains');
    await expect(name).toBeFocused();

    const description = dialog.getByRole('textbox', { name: 'Description (optional)' });
    await description.click();
    await page.keyboard.type('Basmati rice and everyday grains.', { delay: 25 });
    await expect(description).toHaveValue('Basmati rice and everyday grains.');
    await expect(description).toBeFocused();
    await name.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(payload).toMatchObject({ name: 'Rice and Grains', description: 'Basmati rice and everyday grains.', parentId: null });
    expect(warnings).toEqual([]);
  });
}

test('counter quantity controls stay responsive with 24 products and a throttled CPU', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mockApi(page, 'store_owner', { catalogSize: 24 });
  await page.goto('/store/pos');
  await expect(page.locator('.pos-product-card')).toHaveCount(24);
  await page.getByRole('button', { name: /^Basmati Rice 1 kg bag/ }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const frames = await page.evaluate(async () => {
      const frames = [];
      for (let i = 0; i < 20; i += 1) {
        const direction = i % 2 === 0 ? 'Increase' : 'Decrease';
        const button = document.querySelector(`[aria-label="${direction} quantity of Basmati Rice 1 kg bag"]`);
        const start = performance.now();
        button.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        frames.push(performance.now() - start);
      }
      return frames.sort((a, b) => a - b);
    });
    const result = { cpuSlowdown: 4, catalogItems: 24, interactions: frames.length, p95Ms: frames[18], maxMs: frames[19] };
    await testInfo.attach('counter-responsiveness', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(result.p95Ms).toBeLessThan(250);
    expect(result.maxMs).toBeLessThan(500);
    await expect(page.getByRole('spinbutton', { name: 'Quantity of Basmati Rice 1 kg bag', exact: true })).toHaveValue('1');
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  test(`POS confines long lists to their own panels at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApi(page, 'store_owner', { catalogSize: 24 });
    await page.goto('/store/pos');
    await expect(page.getByLabel('Customer name')).toBeVisible();
    await expect(page.getByLabel('Bill discount')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Instant Sale' })).toBeVisible();
    const checkout = page.getByRole('button', { name: /Collect Payment/ });
    await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
    await assertNoPageOverflow(page, viewport.width);
    for (let i = 0; i < 12; i += 1) await page.locator('.pos-pack-button').nth(i).click();
    const receipt = page.getByRole('list', { name: 'Receipt items' });
    expect(await receipt.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
    await assertNoPageOverflow(page, viewport.width);
    const nav = page.getByRole('navigation', { name: 'Store navigation', exact: true });
    await expect(nav.getByRole('button', { name: 'Sales', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await nav.getByRole('button', { name: 'Catalog', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Sales', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(nav.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
    expect(await nav.locator('button[aria-pressed="true"]').count()).toBe(1);
    await nav.getByRole('button', { name: 'Sales', exact: true }).click();
    const lastLink = nav.getByRole('link', { name: 'Returns', exact: true });
    await lastLink.scrollIntoViewIfNeeded();
    await expect(lastLink).toBeVisible();
    expect(await nav.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pos-panels-${viewport.width}.png`) });
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1152, height: 570 }]) {
  test(`POS keeps complete cards and an unobstructed payment button at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApi(page, 'store_owner', { catalogSize: 2 });
    await page.goto('/store/pos');
    await expect(page.locator('.pos-summary')).toHaveCSS('position', 'static');
    await expect(page.locator('.pos-summary')).toHaveCSS('max-height', 'none');
    await expect(page.locator('.pos-summary-scroll')).toHaveCSS('overflow-y', 'visible');
    await expect(page.locator('.pos-checkout')).toHaveCSS('position', 'static');
    const catalog = page.locator('.pos-catalog-grid');
    const packs = catalog.locator('.pos-pack-button');
    await packs.nth(0).click();
    await packs.nth(1).click();
    expect(await catalog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await page.locator('.pos-cart-list').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    for (const label of ['Cash', 'UPI', 'Udhar']) {
      const payment = page.getByRole('button', { name: label, exact: true });
      await payment.scrollIntoViewIfNeeded();
      await expect(payment).toBeVisible();
      const rect = await payment.boundingBox();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.width).toBeGreaterThan(60);
    }
    const phone = page.getByLabel('Phone number');
    await phone.scrollIntoViewIfNeeded();
    await phone.fill('9876543210');
    const checkout = page.getByRole('button', { name: /Collect Payment/ });
    await checkout.scrollIntoViewIfNeeded();
    await expect(checkout).toBeInViewport();
    expect(await checkout.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el === hit || el.contains(hit);
    })).toBe(true);
    const nav = page.getByRole('navigation', { name: 'Store navigation', exact: true });
    await nav.getByRole('button', { name: 'Catalog', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Inventory', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Purchasing', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Purchasing', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await nav.getByRole('button', { name: 'Purchasing', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Purchases', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Catalog', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({ path: testInfo.outputPath(`readable-pos-${viewport.width}.png`) });
  });
}

for (const lineCount of [2, 70]) {
  test(`prints a styled ${lineCount}-line bill as a PDF from the same receipt preview`, async ({ page }, testInfo) => {
    const { mkdir } = await import('node:fs/promises');
    const path = await import('node:path');
    await mockApi(page, 'store_owner');
    const items = lineCount === 2 ? [
      { _id: 'rusk', name: 'Rusk', variantName: '250g', quantity: 3, price: 53, total: 159 },
      { _id: 'milk', name: 'Amul Dudh', variantName: '500g', quantity: 1, price: 45, total: 45 },
    ] : Array.from({ length: lineCount }, (_, i) => ({ _id: 'long-' + i, name: 'Kirana item ' + (i + 1) + ' - long product description', variantName: 'Standard pack', quantity: 1, price: 10, total: 10 }));
    const receiptOrder = {
      _id: 'printed-order', orderNumber: 'SAMPLE-20261122-001', createdAt: '2026-11-22T07:45:00Z',
      paymentMethod: 'counter', paymentStatus: 'paid', customerInfo: { name: 'Ajay', phone: '9876543210' }, items,
      pricing: { subtotal: lineCount === 2 ? 204 : 700, couponDiscount: lineCount === 2 ? 5 : 0, grandTotal: lineCount === 2 ? 199 : 700 },
    };
    await page.route('**/api/v1/pos/order', (route) => route.fulfill(json({ data: { order: receiptOrder } }, 201)));
    await page.goto('/store/pos');
    await page.getByRole('button', { name: /^Basmati Rice 1 kg bag/ }).click();
    await page.getByRole('button', { name: /Collect Payment/ }).click();
    const modal = page.getByRole('dialog', { name: 'Bill Generated' });
    await expect(modal.getByRole('article', { name: 'Sales receipt' })).toBeVisible();
    await expect(modal.getByLabel('Bill totals')).toContainText(lineCount === 2 ? '₹199.00' : '₹700.00');
    await page.evaluate(() => {
      const originalOpen = window.open;
      window.open = function (...args) { const popup = originalOpen.apply(window, args); if (popup) popup.print = () => {}; return popup; };
    });
    const openPrint = async () => {
      const popupPromise = page.waitForEvent('popup');
      await modal.getByRole('button', { name: 'Print / Save PDF' }).click();
      const popup = await popupPromise;
      await popup.locator('.bill-receipt').waitFor();
      await expect(popup.locator('.bill-table')).toHaveCSS('table-layout', 'fixed');
      await expect(popup.locator('h2')).toHaveCSS('font-size', '23px');
      return popup;
    };
    let popup = await openPrint();
    const outputDirectory = path.resolve('../output/pdf');
    await mkdir(outputDirectory, { recursive: true });
    const pdfPath = lineCount === 2 ? path.join(outputDirectory, 'sample-bill-a4.pdf') : testInfo.outputPath('long-bill.pdf');
    await popup.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    await testInfo.attach('bill-pdf', { path: pdfPath, contentType: 'application/pdf' });
    await popup.close();
    if (lineCount === 2) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(modal.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible();
      expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('receipt-mobile.png'), animations: 'disabled' });
      await modal.getByLabel('Paper size').selectOption('thermal');
      const thermalPromise = page.waitForEvent('popup');
      await modal.getByRole('button', { name: 'Print / Save PDF' }).click();
      popup = await thermalPromise;
      await popup.locator('.bill-receipt[data-paper="thermal"]').waitFor();
      await popup.pdf({ path: path.join(outputDirectory, 'sample-bill-80mm.pdf'), printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
      await popup.close();
    }
  });
}
