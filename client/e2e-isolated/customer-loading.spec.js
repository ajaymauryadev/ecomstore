import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 60000 });

for (const view of ['orders', 'product', 'checkout']) {
  test(`${view}: saved cart verification only blocks checkout`, async ({ page, storefront }) => {
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
    const slug = `cart-independent-${view}`;
    const { store, product } = await storefront.seedStore(slug);
    const customer = await storefront.User.create({ name: 'Loading Test Customer', phone: view === 'orders' ? '9876543211' : view === 'product' ? '9876543212' : '9876543213',
      password: 'Customer123!', role: 'customer', tenantId: store._id });
    const login = await page.request.post(`${storefront.apiOrigin}/api/v1/storefront/${slug}/auth/login`,
      { data: { phone: customer.phone, password: 'Customer123!' } });
    expect(login.status()).toBe(200);
    await storefront.Order.collection.insertOne({ tenantId: store._id, customerId: customer._id,
      orderNumber: `SAVED-${view}`, orderType: 'self_pickup', status: 'pending',
      items: [], pricing: { grandTotal: 100 }, createdAt: new Date() });
    await page.addInitScript(({ storeId, userId, productId, variantId }) => {
      sessionStorage.setItem(`smart-kirana:cart:v1:${storeId}:account:${userId}`, JSON.stringify({
        items: [{ productId, variantId, quantity: 1 }], deliveryType: 'self_pickup',
      }));
    }, { storeId: String(store._id), userId: String(customer._id), productId: String(product._id), variantId: String(product.variants[0]._id) });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let verifying = false;
    await page.route(`**/api/v1/storefront/${slug}/cart/products`, async (route) => {
      verifying = true;
      await held;
      await route.continue();
    });
    const path = view === 'orders' ? 'orders' : view === 'checkout' ? 'checkout' : `p/${product._id}`;
    try {
      await page.goto(`${storefront.origin}/s/${slug}/${path}`);
      await expect.poll(() => verifying).toBe(true);
      if (view === 'checkout') await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toHaveCount(0);
      else {
        await expect(page.getByRole('heading', { name: view === 'orders' ? 'My Orders' : 'Pickup Test Rice', exact: true })).toBeVisible({ timeout: 5000 });
        if (view === 'orders') await expect(page.getByText('SAVED-orders', { exact: true })).toBeVisible();
        else await expect(page.getByRole('button', { name: 'Add to Cart', exact: true })).toBeDisabled();
      }
    } finally { release(); }
    if (view === 'product') await expect(page.getByRole('button', { name: 'Increase quantity', exact: true })).toBeEnabled();
    if (view === 'checkout') await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  });
}
