import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

const matrix = {
  store_owner: [
    ['/store/dashboard', '/dashboard'], ['/store/products', '/products'],
    ['/store/pos', '/products'], ['/store/inventory', '/inventory/list'],
    ['/store/orders', '/storefront/SLUG/admin/orders'], ['/store/udhar', '/udhar'],
    ['/store/daily-closing', '/daily-closing/summary'], ['/store/reports', '/reports/daily-sales'],
    ['/store/sales', '/reports/sales-overview'], ['/store/orders/payment-queue', '/storefront/SLUG/admin/orders/payment-queue'],
    ['/store/packing/work', '/packing/my-orders'], ['/store/packing', '/packing/admin/queue'],
    ['/store/deliveries', '/delivery/orders'], ['/store/returns', '/returns'],
    ['/store/categories', '/categories'], ['/store/inventory/low-stock', '/inventory/low-stock'],
    ['/store/purchases', '/purchases'], ['/store/suppliers', '/suppliers'],
    ['/store/expenses', '/expenses'], ['/store/salary', '/salary'],
    ['/store/supplier-payments', '/suppliers'], ['/store/profit-loss', '/reports/profit-loss'],
    ['/store/staff', '/users/staff'], ['/store/staff-activity', '/packing/admin/activity'],
    ['/store/coupons', '/coupons'], ['/store/offers', '/offers'],
    ['/store/settings', '/stores/mine'], ['/store/notifications', '/notifications'],
    ['/store/backup', null], ['/store/audit-logs', '/audit-logs'],
    ['/store/dashboard', '/dashboard'],
  ],
  staff: [['/staff/dashboard', '/dashboard'], ['/staff/orders', '/storefront/SLUG/admin/orders'], ['/staff/pos', '/products'], ['/staff/packing', '/packing/my-orders']],
  packer: [['/staff/dashboard', '/dashboard'], ['/staff/packing', '/packing/my-orders'], ['/store/products', '/products']],
  delivery: [['/staff/dashboard', '/dashboard'], ['/staff/deliveries', '/delivery/orders']],
  super_admin: [['/super-admin/dashboard', '/super-admin/stats'], ['/super-admin/stores', '/super-admin/stores'],
    ['/super-admin/plans', '/plans'], ['/super-admin/audit-logs', '/super-admin/audit-logs']],
};

for (const [role, routes] of Object.entries(matrix)) {
  test(`${role} foreground pages load data without runtime or API errors`, async ({ page, storefront }, testInfo) => {
    test.setTimeout(120000);
    const slug = `navigation-${role.replaceAll('_', '-')}`;
    const credentials = { email: `${role}@navigation.example.com`, password: 'NavigationTest123!' };
    const { store } = await storefront.seedStore(slug, role === 'store_owner' ? credentials : {});
    if (role !== 'store_owner') await storefront.User.create({ ...credentials, name: 'Navigation Operator', role,
      ...(role !== 'super_admin' && { tenantId: store._id }) });
    await storefront.Product.create(Array.from({ length: 25 }, (_, i) => ({ tenantId: store._id,
      name: `Navigation product ${i}`, variants: [{ name: 'Pack', stock: 2, retailPrice: 20 }] })));
    const signedIn = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
    expect(signedIn.status()).toBe(200);
    const apiErrors = [], scriptErrors = [], seen = new Set(), measurements = [];
    page.on('pageerror', (error) => scriptErrors.push(error.message));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/v1/')) return;
      if (response.status() >= 400) apiErrors.push({ path: url.pathname, status: response.status() });
      else seen.add(url.pathname.replace('/api/v1', ''));
    });
    let first = true;
    for (const [route, primary] of routes) {
      const started = performance.now();
      if (first) { await page.goto(storefront.origin + route); first = false; }
      else await page.evaluate((pathname) => {
        history.pushState({}, '', pathname);
        dispatchEvent(new PopStateEvent('popstate'));
      }, route);
      await expect(page).toHaveURL(storefront.origin + route);
      await expect(page.locator('main h1').or(page.locator('main').getByText(/^No orders (assigned|to pack)$/)).first()).toBeVisible();
      if (primary) await expect.poll(() => seen.has(primary.replace('SLUG', slug))).toBe(true);
      await expect(page.locator('main .animate-pulse, main [aria-busy="true"]')).toHaveCount(0);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      measurements.push({ route, visibleMs: Math.round(performance.now() - started) });
      expect(scriptErrors).toEqual([]);
      expect(apiErrors).toEqual([]);
    }
    console.log(JSON.stringify({ role, scope: 'Local disposable data, client route navigation; not hosted capacity or field Web Vitals.', measurements }));
    await testInfo.attach('route-measurements.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });
}
