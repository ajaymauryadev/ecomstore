import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

const password = 'Pickup-test-password-123';

async function signInForCheckout(page, phone) {
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Mobile number').fill(phone);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
}

for (const { device, width, height } of [
  { device: 'mobile', width: 390, height: 844 },
  { device: 'desktop', width: 1440, height: 900 },
]) {
  test(`shopper signs in at checkout and tracks a pickup order on ${device}`, async ({ page, storefront }) => {
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const expectedGuestRefresh = message.location().url.endsWith('/api/v1/auth/refresh') && message.text().includes('401');
      if (!expectedGuestRefresh) runtimeErrors.push(message.text());
    });
    const fallback = page.getByRole('heading', { name: 'Something went wrong' });
    const slug = 'pickup-qa-' + device;
    const { store, product } = await storefront.seedStore(slug);
    store.paymentSettings = { upiId: '6394746719@ybl', upiName: 'Ajay Maurya' };
    await store.save();
    const variant = product.variants[0];
    const phone = '9876543210';
    const customer = await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'Pickup Tester', phone, password });

    await page.setViewportSize({ width, height });
    await page.goto(storefront.origin + '/s/' + slug);
    await page.getByRole('link', { name: product.name, exact: true }).click();
    await expect(page.getByRole('heading', { name: product.name })).toBeVisible();

    const addItem = page.getByRole('button', { name: 'Add to Cart' });
    const firstItemDrawer = page.getByRole('heading', { name: 'My Cart (1)' });
    await addItem.click();
    await expect(firstItemDrawer).toBeInViewport();
    await expect(fallback).toHaveCount(0);
    await firstItemDrawer.locator('..').getByRole('button').click();

    const cartCount = (count) => page.getByRole('button', { name: 'Open cart with ' + count + ' items' });
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(cartCount(2)).toBeVisible();
    await page.getByRole('button', { name: 'Decrease quantity' }).click();
    await expect(cartCount(1)).toBeVisible();
    await page.getByRole('button', { name: 'Remove from cart' }).click();
    await expect(addItem).toBeVisible();
    await expect(cartCount(0)).toBeVisible();

    await addItem.click();
    await expect(firstItemDrawer).toBeInViewport();
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    const draftKey = 'smart-kirana:cart:v1:' + store._id + ':guest';
    const accountKey = 'smart-kirana:cart:v1:' + store._id + ':account:' + customer._id;
    await signInForCheckout(page, phone);
    await page.reload();
    await expect(page.getByText('1 kg × 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Online Order/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Wholesale/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Bank Transfer/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^UPI QR Code/ }).click();
    await expect(page.getByRole('img', { name: 'UPI QR code for 6394746719@ybl' })).toBeVisible();
    await expect(page.getByText('6394746719@ybl', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^UPI ID Transfer/ }).click();
    await expect(page.getByRole('img', { name: 'UPI QR code for 6394746719@ybl' })).toHaveCount(0);
    await expect(page.getByText('6394746719@ybl', { exact: true })).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();
    await page.getByRole('button', { name: /^Store Pickup/ }).click();
    await page.getByRole('button', { name: /^Cash on Pickup/ }).click();
    const savedDraft = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), accountKey);
    expect(savedDraft).toEqual({
      items: [{ productId: String(product._id), variantId: String(variant._id), quantity: 1 }],
      deliveryType: 'home_delivery',
    });

    const orderApiPath = '/api/v1/storefront/' + slug + '/orders';
    const [creation] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === orderApiPath && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Place Order' }).click(),
    ]);
    expect(creation.status()).toBe(201);
    const { order, guestAccessToken } = (await creation.json()).data;
    expect(order).toMatchObject({
      orderType: 'self_pickup',
      paymentMethod: 'cash_on_pickup',
      items: [{ productId: String(product._id), variantId: String(variant._id), quantity: 1 }],
    });
    expect(guestAccessToken).toBeUndefined();
    await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
    await expect(page.getByText(order.orderNumber, { exact: true })).toBeVisible();

    const [tracking] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === orderApiPath + '/' + order._id && response.request().method() === 'GET'),
      page.reload(),
    ]);
    expect(tracking.status()).toBe(200);
    expect((await tracking.json()).data.order._id).toBe(order._id);
    await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
    await expect(page.getByText(order.orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByText('Store Pickup', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open cart with 0 items' })).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();

    expect(await page.evaluate((key) => sessionStorage.getItem(key), accountKey)).toBeNull();
    const storedProduct = await storefront.Product.findById(product._id);
    expect(storedProduct.variants.id(variant._id).stock).toBe(99);
    expect(await storefront.Order.countDocuments({ tenantId: store._id })).toBe(1);
    const movements = await storefront.StockLedger.find({ tenantId: store._id, referenceId: order._id }).lean();
    expect(movements).toMatchObject([{ movementType: 'ORDER_RESERVED', quantityChange: -1, balanceBefore: 100, balanceAfter: 99 }]);
    await expect(fallback).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  });
}

test('authenticated checkout recovers a committed order and tracking after a lost response', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const slug = 'pickup-idempotency';
  const { store, product } = await storefront.seedStore(slug);
  const variant = product.variants[0];
  const phone = '9876543210';
  await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'Retry Pickup Tester', phone, password });
  const orderApiPath = '/api/v1/storefront/' + slug + '/orders';
  const isCheckout = (request) => request.method() === 'POST' && new URL(request.url()).pathname === orderApiPath;
  await page.goto(storefront.origin + '/s/' + slug);
  await page.getByRole('link', { name: product.name, exact: true }).click();
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await signInForCheckout(page, phone);
  await page.getByRole('button', { name: /^Store Pickup/ }).click();
  await page.getByRole('button', { name: /^Cash on Pickup/ }).click();

  let committed, firstRequest;
  await page.route('**' + orderApiPath, async (route) => {
    firstRequest = route.request();
    const response = await route.fetch();
    committed = { status: response.status(), body: await response.json() };
    await route.abort('failed');
  }, { times: 1 });

  await page.getByRole('button', { name: 'Place Order' }).click();
  const retry = page.getByRole('button', { name: 'Retry original order' });
  await expect(retry).toBeVisible();
  expect(committed.status).toBe(201);
  const original = committed.body.data;
  const key = (await firstRequest.allHeaders())['idempotency-key'];
  expect(key).toMatch(/^[a-f0-9]{32}$/);
  await page.getByLabel('Full Name').fill('Edited after response loss');

  const [response] = await Promise.all([
    page.waitForResponse((response) => isCheckout(response.request())),
    retry.click(),
  ]);
  expect((await response.request().allHeaders())['idempotency-key']).toBe(key);
  expect(response.request().postDataJSON()).toEqual(firstRequest.postDataJSON());
  expect(response.status()).toBe(200);
  const replay = (await response.json()).data;
  expect(replay.order._id).toBe(original.order._id);
  await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
  await expect(page.getByText(original.order.orderNumber, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(original.order.orderNumber, { exact: true })).toBeVisible();

  expect(await storefront.Order.countDocuments({ tenantId: store._id })).toBe(1);
  const movements = await storefront.StockLedger.find({ productId: product._id }).lean();
  expect(movements).toMatchObject([{ movementType: 'ORDER_RESERVED', balanceAfter: 99, quantityChange: -1 }]);
  expect(String(movements[0].referenceId)).toBe(original.order._id);
  expect((await storefront.Product.findById(product._id)).variants.id(variant._id).stock).toBe(99);
});

test('UPI QR checkout keeps the configured recipient on order tracking', async ({ page, storefront }, testInfo) => {
  const slug = 'upi-recipient-qa';
  const { store, product } = await storefront.seedStore(slug);
  store.paymentSettings = { upiId: '6394746719@ybl', upiName: 'Ajay Maurya' };
  await store.save();
  const phone = '9876543210';
  await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'UPI Tester', phone, password });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(storefront.origin + '/s/' + slug);
  await page.getByRole('link', { name: product.name, exact: true }).click();
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await signInForCheckout(page, phone);
  await page.getByRole('button', { name: /^Store Pickup/ }).click();
  await page.getByRole('button', { name: /^UPI QR Code/ }).click();
  const qr = page.getByRole('img', { name: 'UPI QR code for 6394746719@ybl' });
  await expect(qr).toBeVisible();
  await qr.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('upi-checkout-mobile.png'), fullPage: true });
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/' + slug + '/orders') && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Place & Pay' }).click(),
  ]);
  expect(response.status()).toBe(201);
  const { order, paymentInfo } = (await response.json()).data;
  expect(order).toMatchObject({ orderType: 'self_pickup', paymentMethod: 'upi_qr', status: 'payment_pending' });
  expect(paymentInfo).toMatchObject({ upiId: '6394746719@ybl', upiName: 'Ajay Maurya' });
  await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
  await expect(qr).toBeVisible();
  await expect(page.getByText('6394746719@ybl', { exact: true })).toBeVisible();
  await expect(page.getByText('Amount to Pay', { exact: true })).toBeVisible();
  await qr.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('upi-tracking-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(qr).toBeVisible();
  await expect(page.getByText('6394746719@ybl', { exact: true })).toBeVisible();
});

test('owner uploads a payment QR and UPI ID used by checkout and order tracking', async ({ page, browser, storefront }, testInfo) => {
  const email = 'payment-owner@example.test';
  const { store, product } = await storefront.seedStore('owner-payment-qa', { email, password });
  const phone = '9876543210';
  await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'Payment Settings Tester', phone, password });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(storefront.origin + '/login');
  await page.getByLabel('Email Address').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/store\/dashboard$/);
  await page.goto(storefront.origin + '/store/settings');
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await page.getByLabel('UPI ID', { exact: true }).fill('6394746719@ybl');
  await page.getByLabel('UPI Name', { exact: true }).fill('Ajay Maurya');
  const generatedQr = page.getByRole('img', { name: 'UPI QR code for 6394746719@ybl' });
  const png = await generatedQr.screenshot();
  await page.getByLabel('Upload UPI QR code').setInputFiles({ name: 'payment-qr.png', mimeType: 'image/png', buffer: png });
  const preview = page.getByRole('img', { name: 'Store UPI QR code' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  const uploadedUrl = await preview.getAttribute('src');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByLabel('UPI ID', { exact: true })).toHaveValue('6394746719@ybl');
  await expect(preview).toHaveAttribute('src', uploadedUrl);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('owner-payment-settings-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const shopper = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await shopper.goto(storefront.origin + '/s/' + store.slug);
    await shopper.getByRole('link', { name: product.name, exact: true }).click();
    await shopper.getByRole('button', { name: 'Add to Cart' }).click();
    await shopper.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await signInForCheckout(shopper, phone);
    await shopper.getByRole('button', { name: /^Store Pickup/ }).click();
    await shopper.getByRole('button', { name: /^UPI QR Code/ }).click();
    const shopperQr = shopper.getByRole('img', { name: 'Store UPI QR code' });
    await expect(shopperQr).toHaveAttribute('src', uploadedUrl);
    await expect(shopper.getByText('6394746719@ybl', { exact: true })).toBeVisible();
    await shopper.getByRole('button', { name: 'Place & Pay' }).click();
    await expect(shopper.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
    await expect(shopperQr).toHaveAttribute('src', uploadedUrl);
    await expect.poll(() => shopperQr.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Remove QR image' }).click();
    await expect(generatedQr).toBeVisible();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
    await shopper.reload();
    await expect(shopper.getByRole('img', { name: 'UPI QR code for 6394746719@ybl' })).toBeVisible();
    await expect(shopperQr).toHaveCount(0);
  } finally {
    await shopper.close();
  }
});

test('a product image is saved locally and renders for shoppers in a fresh browser session', async ({ page, browser, storefront }) => {
  const email = 'image-owner@example.test';
  const { store, product } = await storefront.seedStore('local-image-qa', { email, password });
  await page.goto(storefront.origin + '/login');
  await page.getByLabel('Email Address').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/store\/dashboard$/);
  await page.goto(storefront.origin + '/store/products/' + product._id + '/edit');

  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add Photo' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'product.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const preview = page.locator('img[src*="/uploads/"]');
  await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBe(2);
  await page.getByRole('button', { name: 'Update Product' }).first().click();
  await expect(page.getByText('Product updated successfully!')).toBeVisible();
  const saved = await storefront.Product.findById(product._id).lean();
  expect(saved.images[0]).toMatchObject({ isMain: true, url: expect.stringMatching(/^\/uploads\/.+\.webp$/) });
  await page.reload();
  await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBe(2);

  const shopper = await browser.newPage();
  try {
    await shopper.goto(storefront.origin + '/s/' + store.slug);
    await expect.poll(() => shopper.getByRole('img', { name: product.name }).evaluate((image) => image.naturalWidth)).toBe(2);
    const width = await shopper.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth;
    }, storefront.apiOrigin + saved.images[0].url);
    expect(width).toBe(2);
  } finally {
    await shopper.close();
  }

  await page.goto(storefront.origin + '/store/packing');
  await expect(page.getByRole('heading', { name: 'Packing Queue' })).toBeVisible();
});
