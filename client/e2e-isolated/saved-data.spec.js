import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';
import { randomUUID } from 'node:crypto';

const navigate = (page, pathname) => page.evaluate((path) => {
  history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'));
}, pathname);

for (const view of ['owner', 'mobile storefront']) {
  test(`${view}: saved content stays steady through slow refresh, server failure and reconnect`, async ({ page, storefront }) => {
    test.setTimeout(90000);
    test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
    const owner = view === 'owner';
    await page.setViewportSize(owner ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
    const slug = owner ? 'steady-owner' : 'steady-customer';
    const credentials = { email: `${slug}@example.com`, password: 'SteadySaved123!' };
    const { product } = await storefront.seedStore(slug, credentials);
    if (owner) await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
    const path = owner ? '/store/products' : `/s/${slug}`;
    await page.goto(storefront.origin + path);
    const rice = page.getByText('Pickup Test Rice', { exact: true }).first();
    await expect(rice).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.waitForTimeout(400); // Let the successful snapshot transaction finish.

    let releaseFailure, releaseRecovery;
    const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let phase = 'failure';
    let started = 0;
    await page.route(owner ? /\/api\/v1\/products\?/ : /\/api\/v1\/storefront\/[^/]+\/products\?/, async (route) => {
      started++;
      const current = phase;
      await (current === 'failure' ? failureGate : recoveryGate);
      if (current === 'failure') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporarily unavailable' }) });
      else await route.continue();
    });

    await page.reload();
    await expect(rice).toBeVisible();
    await expect.poll(() => started).toBeGreaterThan(0);
    const before = await page.locator('main').boundingBox();
    await page.evaluate(() => {
      window.steadyRead = { stop: false, failures: [], samples: 0 };
      const sample = () => {
        const state = window.steadyRead;
        if (state.stop) return;
        state.samples++;
        const main = document.querySelector('main');
        if (!main?.textContent.includes('Pickup Test Rice')) state.failures.push('Saved product disappeared');
        if (main?.querySelector('.animate-pulse')) state.failures.push('Loading placeholder appeared');
        for (const element of main?.querySelectorAll('*') ?? []) {
          if (element.textContent === 'Pickup Test Rice') {
            for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor);
              if (Number(style.opacity) < 1 || style.display === 'none' || style.visibility === 'hidden') state.failures.push('Saved content faded or became hidden');
            }
          }
        }
        requestAnimationFrame(sample);
      };
      sample();
    });
    await page.waitForTimeout(300);
    expect(await page.locator('main').boundingBox()).toEqual(before);
    releaseFailure();
    await expect(page.locator(owner ? '.saved-data-status' : '.customer-store-note')).toContainText('Server unavailable');
    await expect(rice).toBeVisible();
    expect(await page.locator('main').boundingBox()).toEqual(before);

    await page.context().setOffline(true);
    await expect(page.locator(owner ? '.saved-data-summary' : '.customer-store-note')).toContainText('Offline');
    expect(await page.locator('main').boundingBox()).toEqual(before);
    phase = 'recovery';
    const failedReads = started;
    await storefront.Product.updateOne({ _id: product._id }, { $set: { name: 'Updated Test Rice' } });
    await page.context().setOffline(false);
    await expect.poll(() => started).toBeGreaterThan(failedReads);
    await page.waitForTimeout(300);
    await expect(rice).toBeVisible();
    expect(await page.locator('main').boundingBox()).toEqual(before);
    const samples = await page.evaluate(() => { window.steadyRead.stop = true; return window.steadyRead; });
    expect(samples.samples).toBeGreaterThan(10);
    expect(samples.failures).toEqual([]);
    releaseRecovery();
    await expect(page.getByText('Updated Test Rice', { exact: true }).first()).toBeVisible();
    await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  });
}

test('offline sign-out survives reload and never restores the previous private account', async ({ page, storefront }) => {
  test.setTimeout(90000);
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  const credentials = { email: 'offline-logout@example.com', password: 'OfflineLogout123!' };
  await storefront.seedStore('offline-logout', credentials);
  await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
  await page.goto(storefront.origin + '/store/products');
  await expect(page.getByText('Pickup Test Rice', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(400);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(storefront.origin + '/login');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await navigate(page, '/store/products');
  await expect(page).toHaveURL(storefront.origin + '/login');
  await expect(page.getByText('Pickup Test Rice', { exact: true })).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(page.getByText('Signed out locally — connect online to finish signing out of the server.')).toHaveCount(0, { timeout: 20000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});

test('packing changes survive an offline reload and confirm in order exactly once on reconnect', async ({ page, storefront }) => {
  test.setTimeout(90000);
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  const owner = { email: 'queued-packing-owner@example.com', password: 'PackingOffline123!' };
  const { store, product } = await storefront.seedStore('queued-packing', owner);
  const packerCredentials = { email: 'queued-packer@example.com', password: 'PackingOffline123!' };
  const packer = await storefront.User.create({ ...packerCredentials, name: 'Offline Packer', role: 'packer', tenantId: store._id });
  const ownerLogin = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: owner });
  const ownerToken = (await ownerLogin.json()).data.accessToken;
  const created = await page.request.post(`${storefront.apiOrigin}/api/v1/pos/order`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), qty: 1, price: 100 }], paymentMethod: 'counter', saleType: 'parcha', packingAssigneeId: String(packer._id) },
  });
  expect(created.status()).toBe(201);
  const orderId = (await created.json()).data.order._id;
  const packerLogin = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: packerCredentials });
  const packerToken = (await packerLogin.json()).data.accessToken;
  const start = await page.request.post(`${storefront.apiOrigin}/api/v1/packing/session/${orderId}/start`, { headers: { Authorization: `Bearer ${packerToken}` } });
  expect(start.status()).toBe(201);
  await page.goto(`${storefront.origin}/staff/packing/${orderId}`);
  await expect(page.getByRole('button', { name: 'Pick', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(400);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Pick', exact: true }).click();
  await expect(page.getByText('Draft: picked · pending sync')).toBeVisible();
  await page.getByRole('button', { name: 'Packed ✓', exact: true }).click();
  await expect(page.getByText('Draft: packed · pending sync')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Draft: packed · pending sync')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Packing', exact: true })).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(page.getByText('Draft: packed · pending sync')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Complete Packing', exact: true })).toBeVisible();
  const { default: Activity } = await import('../../server/src/models/StaffActivityLog.js');
  const logs = await Activity.find({ orderId, action: { $in: ['item_picked', 'item_packed'] } }).lean();
  expect(logs.map((entry) => entry.action)).toEqual(['item_picked', 'item_packed']);
  expect(new Set(logs.map((entry) => entry.metadata.operationId)).size).toBe(2);
});

const routes = {
  store_owner: ['/store/products', '/store/inventory', '/store/dashboard'],
  staff: ['/staff/dashboard', '/staff/orders', '/staff/pos'],
  packer: ['/staff/dashboard', '/staff/packing'],
  delivery: ['/staff/dashboard', '/staff/deliveries'],
  super_admin: ['/super-admin/dashboard', '/super-admin/stores', '/super-admin/plans'],
  customer: ['CATALOG', 'PRODUCT', 'CART'],
};

for (const [role, paths] of Object.entries(routes)) {
  test(`${role}: navigation reuses saved reads and production reload works offline`, async ({ page, storefront }) => {
    test.setTimeout(120000);
    test.skip(process.env.STOREFRONT_PRODUCTION !== 'true', 'Offline shell is emitted by the production build.');
    const slug = `saved-${role.replaceAll('_', '-')}`;
    const credentials = { email: `${slug}@saved.example.com`, password: 'SavedNavigation123!' };
    const { store, product } = await storefront.seedStore(slug, role === 'store_owner' ? credentials : {});
    if (role !== 'store_owner') await storefront.User.create({ ...credentials, name: 'Saved Operator', role,
      ...(role === 'customer' && { phone: '9876501001' }), ...(role !== 'super_admin' && { tenantId: store._id }) });
    const login = await page.request.post(`${storefront.apiOrigin}/api/v1/${role === 'customer' ? `storefront/${slug}/auth/login` : 'auth/login'}`,
      { data: role === 'customer' ? { phone: '9876501001', password: credentials.password } : credentials });
    expect(login.status()).toBe(200);
    const actual = paths.map((path) => path === 'CATALOG' ? `/s/${slug}` : path === 'PRODUCT' ? `/s/${slug}/p/${product._id}` : path === 'CART' ? `/s/${slug}/cart` : path);
    const reads = new Map();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.startsWith('/api/v1/') && !/\/auth\/me$|\/sync[/-]revision$/.test(url.pathname)) {
        const key = url.pathname + url.search;
        reads.set(key, (reads.get(key) || 0) + 1);
      }
    });
    await page.goto(storefront.origin + actual[0]);
    await expect(page.locator('main')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    for (const path of actual) {
      await navigate(page, path);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main .animate-pulse')).toHaveCount(0);
      await page.waitForTimeout(400);
    }
    const counts = [...reads];
    for (const path of [...actual].reverse()) {
      await navigate(page, path);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(150);
    }
    // The existing idle warmup may prepare a new adjacent query concurrently.
    // Already downloaded exact query variants must never be read again for routing.
    for (const [key, count] of counts) expect(reads.get(key), key).toBe(count);
    if (role === 'customer') await expect(page.locator('.saved-data-status')).toHaveCount(0);
    else await expect(page.locator('.saved-data-status')).toContainText('Last synced');
    // A fresh document has no in-memory Redux state or access token.
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator(role === 'customer' ? '.customer-store-note' : '.saved-data-status')).toContainText('Offline');
    if (role !== 'customer') await expect(page.locator('.saved-data-status')).toContainText('Last synced');
    await expect(page.getByText('This view is waiting for its first download')).toHaveCount(0);
    for (const path of actual) {
      await navigate(page, path);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByText('This view is waiting for its first download')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    await page.context().setOffline(false);
  });
}

test('saved product appears before delayed online refresh and a missing offline screen gives a download message', async ({ page, storefront }) => {
  test.setTimeout(90000);
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true');
  const credentials = { email: 'saved-slow@example.com', password: 'SavedSlow123!' };
  await storefront.seedStore('saved-slow', credentials);
  // Keep this particular view undownloaded even when workspace warmup runs.
  await page.route('**/api/v1/audit-logs?*', (route) => route.abort());
  await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials });
  await page.goto(storefront.origin + '/store/products');
  await expect(page.getByText('Pickup Test Rice', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/auth/refresh', async (route) => { await delayed; await route.continue(); });
  await page.reload();
  await expect(page.getByText('Pickup Test Rice', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.saved-data-status')).toContainText('checking your session');
  release();
  await expect(page.locator('.saved-data-status')).not.toContainText('checking your session');
  await page.context().setOffline(true);
  await navigate(page, '/store/audit-logs');
  await expect(page.getByText('This view is waiting for its first download')).toBeVisible();
  await expect(page.locator('main')).toContainText('Connect once to save this data');
  await page.context().setOffline(false);
});
