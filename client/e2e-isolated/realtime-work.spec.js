import { expect } from '@playwright/test';
import { realtimeTest as test } from './storefront-fixture.js';

async function sessionFor(user, store) {
  const { generateTokens } = await import('../../server/src/utils/jwt.js');
  return {
    user: { _id: String(user._id), name: user.name, role: user.role, tenantId: String(store._id), permissions: user.permissions || [] },
    store: { _id: String(store._id), name: store.name, slug: store.slug },
    accessToken: generateTokens(user).accessToken,
  };
}

async function openSession(page, storefront, session, path) {
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { data: session } }));
  await page.goto(storefront.origin + path);
  await expect(page.getByRole('status', { name: 'Live updates connected', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('No notifications yet', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.realtimeDocumentMarker = 'same-document'; });
}

async function setup(storefront, slug, role) {
  const { store, product } = await storefront.seedStore(slug);
  const worker = await storefront.User.create({ tenantId: store._id, role, name: 'Live ' + role, password: 'Live-test-password-123' });
  const customer = await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'Live customer', phone: '9876543210', password: 'Live-test-password-123' });
  const owner = await storefront.User.findById(store.ownerId);
  return {
    store, product, worker,
    workerSession: await sessionFor(worker, store), ownerSession: await sessionFor(owner, store),
    customerSession: await sessionFor(customer, store),
  };
}

async function place(request, storefront, fixture, type = 'self_pickup') {
  const response = await request.post(storefront.apiOrigin + '/api/v1/storefront/' + fixture.store.slug + '/orders', {
    headers: { Authorization: 'Bearer ' + fixture.customerSession.accessToken },
    data: {
      orderType: type, paymentMethod: type === 'self_pickup' ? 'cash_on_pickup' : 'cod',
      customerInfo: { name: 'Live customer', phone: '9876543210', address: { line1: '12 Market Road', city: 'Pune', pincode: '411001' } },
      items: [{ productId: String(fixture.product._id), variantId: String(fixture.product.variants[0]._id), quantity: 1 }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data.order;
}

async function ownerPatch(request, storefront, fixture, order, action, data) {
  const response = await request.patch(storefront.apiOrigin + '/api/v1/storefront/' + fixture.store.slug + '/admin/orders/' + order._id + '/' + action, {
    headers: { Authorization: 'Bearer ' + fixture.ownerSession.accessToken }, data,
  });
  expect(response.status(), await response.text()).toBe(200);
}

for (const role of ['packer', 'staff']) {
  test(`${role} receives live popups and pending packing work without refreshing`, async ({ page, request, storefront }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await setup(storefront, 'live-' + role, role);
    await openSession(page, storefront, fixture.workerSession, '/staff/dashboard');
    const order = await place(request, storefront, fixture);
    await expect(page.getByTestId('notification-popup').filter({ hasText: 'New Order Received' })).toBeVisible();
    await ownerPatch(request, storefront, fixture, order, 'assign', { staffId: String(fixture.worker._id) });
    await expect(page.getByTestId('notification-popup').filter({ hasText: 'Packing order assigned' })).toBeVisible();
    await expect(page.getByRole('main').getByText(order.orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByTestId('notification-unread-count')).toHaveText('2');
    expect(await page.evaluate(() => window.realtimeDocumentMarker)).toBe('same-document');

    await page.getByRole('navigation', { name: 'Staff navigation' }).getByRole('link', { name: 'Packing', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Accept order', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('group', { name: 'Staff navigation sections' }).getByRole('button', { name: 'Sales', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: '../output/' + role + '-packing-workspace.png' });
    await page.getByRole('button', { name: 'Accept order', exact: true }).click();
    await page.getByRole('dialog', { name: 'Accept order', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await storefront.Order.findById(order._id)).status).toBe('pending');
    await page.getByRole('button', { name: 'Accept order', exact: true }).click();
    await page.getByRole('dialog', { name: 'Accept order', exact: true }).getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start Packing', exact: true })).toBeEnabled();
    const accepted = await storefront.Order.findById(order._id);
    expect(accepted.status).toBe('accepted');
    expect(accepted.timeline.filter((entry) => entry.action === 'order_accepted')).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '../output/' + role + '-packing-mobile.png' });
    await page.getByRole('button', { name: 'Start Packing', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/staff/packing/' + order._id + '$'));
    await expect(page.getByText(fixture.product.name, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  });
}

test('delivery assignments appear immediately, become actionable when packed and keep personal unread state', async ({ page, browser, request, storefront }) => {
  test.setTimeout(60000);
  const fixture = await setup(storefront, 'live-delivery', 'delivery');
  await openSession(page, storefront, fixture.workerSession, '/staff/deliveries');
  const ownerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    await openSession(owner, storefront, fixture.ownerSession, '/store/products');
    const order = await place(request, storefront, fixture, 'home_delivery');
    await expect(owner.getByTestId('notification-popup').filter({ hasText: 'New Order Received' })).toBeVisible();
    await expect(page.getByTestId('notification-popup').filter({ hasText: 'New Order Received' })).toBeVisible();
    await ownerPatch(request, storefront, fixture, order, 'assign-delivery', { deliveryId: String(fixture.worker._id) });
    await expect(page.getByTestId('notification-popup').filter({ hasText: 'Delivery order assigned' })).toBeVisible();
    await expect(page.getByRole('main').getByText(order.orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start delivery', exact: true })).toHaveCount(0);
    await expect(page.getByText('The assigned packer or store owner must accept this order before packing.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Staff navigation sections' }).getByRole('button', { name: 'Sales', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: '../output/delivery-workspace.png' });
    await owner.getByRole('button', { name: 'Notifications', exact: true }).click();
    await owner.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(owner.getByTestId('notification-unread-count')).toHaveCount(0);
    await expect(page.getByTestId('notification-unread-count')).toHaveText('2');
    for (const status of ['accepted', 'packing', 'packed']) await ownerPatch(request, storefront, fixture, order, 'status', { status });
    await expect(page.getByRole('button', { name: 'Start delivery', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.realtimeDocumentMarker)).toBe('same-document');
  } finally { await ownerContext.close(); }
});

test('reconnection recovers a missed assignment and inbox without a page refresh', async ({ page, request, storefront }) => {
  test.setTimeout(60000);
  const fixture = await setup(storefront, 'live-reconnect', 'packer');
  await openSession(page, storefront, fixture.workerSession, '/staff/dashboard');
  await page.context().setOffline(true);
  await expect(page.getByRole('status', { name: 'Live updates reconnecting', exact: true })).toBeVisible();
  const order = await place(request, storefront, fixture);
  await ownerPatch(request, storefront, fixture, order, 'assign', { staffId: String(fixture.worker._id) });
  await page.context().setOffline(false);
  await expect(page.getByRole('status', { name: 'Live updates connected', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('main').getByText(order.orderNumber, { exact: true })).toBeVisible();
  await expect(page.getByTestId('notification-unread-count')).toHaveText('2');
  await expect(page.getByTestId('notification-popup').filter({ hasText: 'Packing order assigned' })).toBeVisible();
  expect(await page.evaluate(() => window.realtimeDocumentMarker)).toBe('same-document');
});
