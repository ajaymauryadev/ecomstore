import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

const password = 'Quick-flow-test-123';

test('search from product detail and Buy Now preserve the existing cart through sign in', async ({ page, storefront }) => {
  const slug = 'buy-now-search';
  const { store, product } = await storefront.seedStore(slug);
  product.variants.push({ name: '5 kg', unit: 'kg', retailPrice: 450, purchasePrice: 300, stock: 25, barcode: 'RICE5000' });
  await product.save();
  const customer = await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'Buyer', phone: '9876543210', password });
  await page.goto(storefront.origin + '/s/' + slug);
  await page.getByRole('link', { name: product.name, exact: true }).click();
  await page.getByRole('textbox', { name: 'Search store products' }).fill('RICE5000');
  await expect(page).toHaveURL(/\/search\?q=RICE5000$/);
  await expect(page.getByRole('link', { name: product.name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search store products' })).toHaveValue('RICE5000');
  await page.getByRole('link', { name: product.name, exact: true }).click();
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
  await page.getByRole('heading', { name: 'My Cart (1)' }).locator('..').getByRole('button').click();
  await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
  await page.getByRole('button', { name: /^5 kg/ }).click();
  await page.getByRole('button', { name: 'Buy Now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('5 kg × 1', { exact: true })).toBeVisible();
  const draftKey = 'smart-kirana:cart:v1:' + store._id + ':account:' + customer._id;
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).items, draftKey)).toEqual([
    { productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 2 },
  ]);
  await page.getByRole('button', { name: /^Store Pickup/ }).click();
  await page.getByRole('button', { name: /^Cash on Pickup/ }).click();
  const [created] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/' + slug + '/orders')),
    page.getByRole('button', { name: 'Place Order', exact: true }).click(),
  ]);
  expect(created.status()).toBe(201);
  expect((await created.json()).data.order.items).toMatchObject([{ variantId: String(product.variants[1]._id), quantity: 1 }]);
  await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open cart with 2 items' })).toBeVisible();
});

test('employee search and confirmed assignments show saved names in the drawer and order list', async ({ page, request, storefront }) => {
  const slug = 'assignment-search';
  const email = 'assign-owner@example.com';
  const { store, product } = await storefront.seedStore(slug, { email, password });
  const packer = await storefront.User.create({ tenantId: store._id, name: 'Ansh Packer', role: 'packer', email: 'ansh@example.com', password });
  const driver = await storefront.User.create({ tenantId: store._id, name: 'Ajay Driver', role: 'delivery', email: 'ajay@example.com', password });
  const api = storefront.origin + '/api/v1';
  const customer = await request.post(api + '/storefront/' + slug + '/auth/register', { data: { name: 'Buyer', phone: '9876543210', password } });
  expect(customer.status()).toBe(201);
  const placed = await request.post(api + '/storefront/' + slug + '/orders', {
    headers: { Authorization: 'Bearer ' + (await customer.json()).data.accessToken },
    data: { orderType: 'home_delivery', paymentMethod: 'cod', customerInfo: { name: 'Buyer', phone: '9876543210', address: { line1: '12 Road', city: 'Pune' } }, items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 1 }] },
  });
  expect(placed.status()).toBe(201);
  const order = (await placed.json()).data.order;
  expect((await page.request.post(api + '/auth/login', { data: { email, password } })).status()).toBe(200);
  await page.goto(storefront.origin + '/store/orders?orderId=' + order._id);
  const dialog = page.getByRole('dialog', { name: order.orderNumber, exact: true });
  await expect(dialog).toBeVisible();
  for (const [kind, member] of [['Packing', packer], ['Delivery', driver]]) {
    const picker = dialog.getByRole('group', { name: kind + ' assignment', exact: true });
    await picker.getByRole('textbox').fill(kind === 'Packing' ? 'ansh' : 'aja');
    await expect(picker.getByRole('option', { name: new RegExp(member.name) })).toHaveCount(1);
    await picker.getByRole('combobox').selectOption(String(member._id));
    await expect(picker.getByText(/Not saved yet/)).toBeVisible();
    await picker.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Order responsibility' })).toContainText(kind + ' assigned to: ' + member.name);
    await expect(picker.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
  }
  await page.reload();
  await expect(page.getByRole('region', { name: 'Order responsibility' })).toContainText('Ajay Driver');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('textbox', { name: 'Search orders' }).fill('9876543210');
  await expect(page.getByText('Packing: Ansh Packer (packer)', { exact: true })).toBeVisible();
  await expect(page.getByText('Delivery: Ajay Driver (delivery)', { exact: true })).toBeVisible();
});
