import { expect } from '@playwright/test';
import { realtimeTest as test } from './storefront-fixture.js';

test('accepting then cancelling an order updates the customer bell and inbox without reload', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const { store, product } = await storefront.seedStore('order-notifications');
  const customer = await storefront.User.create({ name: 'Order Customer', phone: '9876543215',
    password: 'Customer123!', role: 'customer', tenantId: store._id });
  const owner = await storefront.User.findById(store.ownerId);
  const { generateTokens } = await import('../../server/src/utils/jwt.js');
  const accessToken = generateTokens(customer).accessToken;
  const headers = { Authorization: `Bearer ${generateTokens(owner).accessToken}` };
  const created = await page.request.post(`${storefront.apiOrigin}/api/v1/storefront/${store.slug}/orders`, {
    headers: { Authorization: `Bearer ${accessToken}` }, data: {
      orderType: 'self_pickup', paymentMethod: 'cash_on_pickup',
      customerInfo: { name: customer.name, phone: customer.phone },
      items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 1 }],
    },
  });
  expect(created.status()).toBe(201);
  const order = (await created.json()).data.order;
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { data: {
    user: { _id: String(customer._id), name: customer.name, role: 'customer', tenantId: String(store._id) },
    store: { _id: String(store._id), slug: store.slug, name: store.name }, accessToken,
  } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${storefront.origin}/s/${store.slug}`);
  await expect(page.getByRole('status', { name: 'Live updates connected', exact: true })).toBeVisible({ timeout: 20000 });
  const adminOrder = `${storefront.apiOrigin}/api/v1/storefront/${store.slug}/admin/orders/${order._id}`;
  expect((await page.request.patch(`${adminOrder}/status`, { headers, data: { status: 'accepted' } })).status()).toBe(200);
  await expect(page.getByTestId('notification-unread-count')).toHaveText('1');
  await expect(page.getByTestId('notification-popup')).toContainText('Order accepted');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Notification inbox' });
  await expect(inbox.getByText('Order accepted', { exact: true })).toBeVisible();
  expect((await page.request.post(`${adminOrder}/cancel`, { headers, data: { reason: "We don't deliver there" } })).status()).toBe(200);
  await expect(page.getByTestId('notification-unread-count')).toHaveText('2');
  await expect(inbox.getByText('Order cancelled', { exact: true })).toBeVisible();
  await expect(inbox).toContainText("We don't deliver there");
  await inbox.getByRole('button', { name: /Order cancelled/ }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${order._id}$`));
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
});
