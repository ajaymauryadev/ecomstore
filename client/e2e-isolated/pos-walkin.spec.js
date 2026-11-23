import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });
test.use({ viewport: { width: 1440, height: 900 } });

const orderPath = '/api/v1/pos/order';
const isPOSSubmission = (request) => request.method() === 'POST' && new URL(request.url()).pathname === orderPath;

for (const width of [390, 1440]) {
  test('direct pack billing stays usable at ' + width + 'px without customer forms', async ({ page, storefront }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const slug = 'simple-counter-' + width;
    const password = 'SimpleCounter123!';
    const { store, product } = await storefront.seedStore(slug, { email: slug + '@example.com', password });
    product.variants.push({ name: '5 kg', unit: 'kg', retailPrice: 450, stock: 2 });
    product.variants.push({ name: '10 kg', unit: 'kg', retailPrice: 850, stock: 0 });
    await product.save();
    const login = await page.request.post(storefront.apiOrigin + '/api/v1/auth/login', { data: { email: slug + '@example.com', password } });
    expect(login.status()).toBe(200);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(storefront.origin + '/store/pos');
    const pack = page.getByRole('button', { name: /Pickup Test Rice 5 kg/ });
    await expect(pack).toBeVisible();
    await expect(page.getByRole('button', { name: /Pickup Test Rice 10 kg/ })).toBeDisabled();
    await expect(page.getByLabel('Customer name')).toHaveValue('');
    await expect(page.getByLabel('Phone number')).toHaveValue('');
    await pack.click({ clickCount: 4, delay: 40 });
    await expect(page.getByRole('spinbutton', { name: 'Quantity of Pickup Test Rice 5 kg', exact: true })).toHaveValue('2');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const checkout = page.getByRole('button', { name: /Collect Payment/ });
    await expect(checkout).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('counter-' + width + '.png') });
    const [response] = await Promise.all([
      page.waitForResponse((response) => isPOSSubmission(response.request())), checkout.click(),
    ]);
    expect(response.status()).toBe(201);
    const bill = response.request().postDataJSON();
    expect(bill.items).toHaveLength(1);
    expect(bill.items[0]).toMatchObject({ qty: 2, variantId: String(product.variants[1]._id) });
    expect(bill).not.toHaveProperty('customerPhone');
    expect(await storefront.Order.countDocuments({ tenantId: store._id })).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('minimal product form saves real stock and immediately makes it available at the counter', async ({ page, storefront }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const email = 'simple-product@example.com', password = 'SimpleProduct123!';
  await storefront.seedStore('simple-product', { email, password });
  const login = await page.request.post(storefront.apiOrigin + '/api/v1/auth/login', { data: { email, password } });
  expect(login.status()).toBe(200);
  await page.goto(storefront.origin + '/store/products/new');
  await expect(page.getByLabel('Brand')).toBeVisible();
  await page.getByLabel(/Product Name/).fill('Cheeni');
  await page.getByLabel(/Retail Price/).fill('45');
  await page.getByLabel('Initial Stock').fill('20');
  await page.getByLabel(/Variant Name/).fill('1 kg');
  await page.getByRole('combobox').filter({ has: page.locator('option[value="kg"]') }).selectOption('kg');
  await page.screenshot({ path: testInfo.outputPath('simple-product.png') });
  const [saved] = await Promise.all([
    page.waitForResponse((res) => new URL(res.url()).pathname === '/api/v1/products' && res.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save Product', exact: true }).first().click(),
  ]);
  expect(saved.status()).toBe(201);
  const created = (await saved.json()).data.product;
  expect(created.variants[0]).toMatchObject({ retailPrice: 45, stock: 20, unit: 'kg' });
  await page.goto(storefront.origin + '/store/pos');
  await expect(page.getByRole('button', { name: /Cheeni/ })).toBeVisible();
  await page.getByRole('button', { name: /Cheeni/ }).click();
  await expect(page.getByRole('button', { name: /Collect Payment/ })).toContainText('45.00');
});

async function openPOS(page, storefront, slug) {
  const ownerLogin = { email: slug + '@example.com', password: 'IsolatedPOS123!' };
  const { store, product } = await storefront.seedStore(slug, ownerLogin);
  await page.goto(storefront.origin + '/store/pos');
  await page.getByLabel('Email Address').fill(ownerLogin.email);
  await page.getByLabel(/^Password/).fill(ownerLogin.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await page.getByRole('searchbox').fill(product.name);
  await page.getByRole('button', { name: new RegExp(product.name) }).click();
  await expect(page.getByText('Bill Items (1)')).toBeVisible();
  return { store, product, variant: product.variants[0] };
}

for (const [label, paymentMethod] of [['Cash', 'counter'], ['UPI', 'upi_id']]) {
  test(label + ' walk-in with blank phone creates one bill and one movement', async ({ page, storefront }) => {
    const { store, product, variant } = await openPOS(page, storefront, 'pos-walkin-' + label.toLowerCase());
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByLabel('Phone number')).toHaveValue('');

    const [response] = await Promise.all([
      page.waitForResponse((response) => isPOSSubmission(response.request())),
      page.getByRole('button', { name: /Collect Payment/ }).click(),
    ]);
    expect(response.request().postDataJSON()).not.toHaveProperty('customerPhone');
    expect(response.status()).toBe(201);
    const { order } = (await response.json()).data;
    expect(order.paymentMethod).toBe(paymentMethod);
    expect(order.customerInfo).not.toHaveProperty('phone');
    const receipt = page.getByRole('dialog', { name: 'Bill Generated' });
    await expect(receipt.getByText('Bill#: ' + order.orderNumber, { exact: true })).toBeVisible();
    await expect(receipt.getByText('Payment: ' + label, { exact: true })).toBeVisible();

    await receipt.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('button', { name: /Collect Payment/ })).toBeDisabled();
    expect(await storefront.Order.countDocuments({ tenantId: store._id, orderType: 'counter' })).toBe(1);
    const movements = await storefront.StockLedger.find({ productId: product._id }).lean();
    expect(movements).toMatchObject([{
      variantId: variant._id,
      movementType: 'ORDER_SOLD',
      quantityChange: -1,
      balanceBefore: 100,
      balanceAfter: 99,
    }]);
    expect(String(movements[0].referenceId)).toBe(order._id);
    expect((await storefront.Product.findById(product._id)).variants.id(variant._id).stock).toBe(99);
  });
}

test('invalid phone and blank-phone Udhar show field errors without billing', async ({ page, storefront }) => {
  const { store, product, variant } = await openPOS(page, storefront, 'pos-walkin-validation');
  let submissions = 0;
  page.on('request', (request) => { if (isPOSSubmission(request)) submissions += 1; });

  const phone = page.getByLabel('Phone number');
  const pay = page.getByRole('button', { name: /Collect Payment/ });
  await phone.fill('0000000000');
  await pay.click();
  const invalidPhone = 'Enter a valid 10-digit Indian mobile number.';
  await expect(phone).toHaveAccessibleDescription(invalidPhone);
  expect(submissions).toBe(0);

  // Send an invalid number to Express once to verify the UI also maps real API field errors.
  await phone.fill('9876543210');
  await page.route('**' + orderPath, (route) => route.continue({
    postData: { ...route.request().postDataJSON(), customerPhone: '0000000000' },
  }), { times: 1 });
  const [rejected] = await Promise.all([
    page.waitForResponse((response) => isPOSSubmission(response.request())),
    pay.click(),
  ]);
  expect(rejected.status()).toBe(400);
  await expect(phone).toHaveAccessibleDescription(invalidPhone);

  await page.getByRole('button', { name: 'Udhar', exact: true }).click();
  await page.getByRole('button', { name: /Create Udhar Bill/ }).click();
  await expect(page.getByRole('alert')).toContainText('Select a customer account for Udhar.');
  expect(submissions).toBe(1);
  await expect(page.getByRole('dialog', { name: 'Bill Generated' })).toHaveCount(0);
  expect(await storefront.Order.countDocuments({ tenantId: store._id })).toBe(0);
  expect(await storefront.StockLedger.countDocuments({ productId: product._id })).toBe(0);
  expect((await storefront.Product.findById(product._id)).variants.id(variant._id).stock).toBe(100);
});

test('POS retries a committed bill after its response is lost', async ({ page, storefront }) => {
  const { store, product, variant } = await openPOS(page, storefront, 'pos-idempotency');
  let committed, firstRequest;
  await page.route('**' + orderPath, async (route) => {
    firstRequest = route.request();
    const response = await route.fetch();
    committed = { status: response.status(), body: await response.json() };
    await route.abort('failed');
  }, { times: 1 });

  await page.getByRole('button', { name: /Collect Payment/ }).click();
  const retry = page.getByRole('button', { name: 'Retry original bill' });
  await expect(retry).toBeVisible();
  expect(committed.status).toBe(201);
  const original = committed.body.data.order;
  const key = (await firstRequest.allHeaders())['idempotency-key'];
  expect(key).toMatch(/^[a-f0-9]{32}$/);
  await page.getByLabel('Customer name').fill('Edited after response loss');

  const [response] = await Promise.all([
    page.waitForResponse((response) => isPOSSubmission(response.request())),
    retry.click(),
  ]);
  expect((await response.request().allHeaders())['idempotency-key']).toBe(key);
  expect(response.request().postDataJSON()).toEqual(firstRequest.postDataJSON());
  expect(response.status()).toBe(200);
  expect((await response.json()).data.order._id).toBe(original._id);
  const receipt = page.getByRole('dialog', { name: 'Bill Generated' });
  await expect(receipt.getByText('Bill#: ' + original.orderNumber, { exact: true })).toBeVisible();
  expect(await storefront.Order.countDocuments({ tenantId: store._id })).toBe(1);
  const movements = await storefront.StockLedger.find({ productId: product._id }).lean();
  expect(movements).toMatchObject([{ movementType: 'ORDER_SOLD', balanceAfter: 99, quantityChange: -1 }]);
  expect((await storefront.Product.findById(product._id)).variants.id(variant._id).stock).toBe(99);

  await receipt.getByRole('button', { name: 'New Sale' }).click();
  await page.getByRole('searchbox').fill(product.name);
  await page.getByRole('button', { name: new RegExp(product.name) }).click();
  const [independent] = await Promise.all([
    page.waitForResponse((response) => isPOSSubmission(response.request())),
    page.getByRole('button', { name: /Collect Payment/ }).click(),
  ]);
  expect(independent.status()).toBe(201);
  expect(independent.request().postDataJSON()).toEqual(firstRequest.postDataJSON());
  expect((await independent.request().allHeaders())['idempotency-key']).not.toBe(key);
  expect((await independent.json()).data.order._id).not.toBe(original._id);
  expect(await storefront.Order.countDocuments({ tenantId: store._id })).toBe(2);
  expect(await storefront.StockLedger.countDocuments({ productId: product._id })).toBe(2);
  expect((await storefront.Product.findById(product._id)).variants.id(variant._id).stock).toBe(98);
});

test('posts a ₹100 Udhar bill to the account shown by POS', async ({ page, storefront }) => {
  const { store, product } = await openPOS(page, storefront, 'pos-udhar-account');
  const account = await storefront.UdharCustomer.create({
    tenantId: store._id, name: 'Udhar Test Buyer', phone: '9876543210', creditLimit: 200,
  });
  await page.getByRole('button', { name: 'Udhar', exact: true }).click();
  await page.getByLabel('Search customer by name or phone').fill('9876543210');
  await page.getByLabel('Select Udhar account').selectOption(String(account._id));
  await expect(page.locator('.pos-account-selected')).toContainText(account.name);

  const [response] = await Promise.all([
    page.waitForResponse((response) => isPOSSubmission(response.request())),
    page.getByRole('button', { name: /Create Udhar Bill/ }).click(),
  ]);
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().udharCustomerId).toBe(String(account._id));
  const { order } = (await response.json()).data;
  await expect(page.getByRole('dialog', { name: 'Bill Generated' }).getByText(account.name, { exact: true })).toBeVisible();
  expect((await storefront.UdharCustomer.findById(account._id)).balance).toBe(100);
  expect(await storefront.UdharEntry.find({ referenceId: order._id }).lean()).toMatchObject([
    { customerId: account._id, type: 'debit', amount: 100, balanceAfter: 100 },
  ]);
  expect(await storefront.StockLedger.countDocuments({ referenceId: order._id, productId: product._id })).toBe(1);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: /Udhar/ }).click();
  await expect(page.getByRole('heading', { name: 'Udhar accounts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legacy Credit Bills' })).toHaveCount(0);
});
