import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('pickup cart reaches checkout and submitted payments render in the owner queue', async ({ page, browser, storefront }) => {
  test.setTimeout(90000);
  const password = 'Payment-regression-123';
  const email = 'queue-owner@example.test';
  const { store, product } = await storefront.seedStore('cart-payment-regression', { email, password });
  store.paymentSettings = { upiId: '6394746719@ybl', upiName: 'Ajay Maurya' };
  await store.save();
  const phone = '9876543210';
  await storefront.User.create({ tenantId: store._id, role: 'customer', name: 'Regression Buyer', phone, password });
  const errors = [];
  const captureErrors = (surface) => {
    surface.on('pageerror', (error) => errors.push(error.message));
    surface.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text());
    });
  };
  captureErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(storefront.origin + '/s/' + store.slug + '/auth');
  await page.getByLabel('Mobile number').fill(phone);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.goto(storefront.origin + '/s/' + store.slug + '/p/' + product._id);
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await page.getByRole('heading', { name: 'My Cart (1)' }).locator('..').getByRole('button').click();
  await page.goto(storefront.origin + '/s/' + store.slug + '/cart');
  await expect(page.getByRole('heading', { name: 'My Cart', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Store Pickup', exact: true }).click();
  await page.getByRole('button', { name: 'Home Delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Store Pickup', exact: true }).click();
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Store Pickup/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^UPI ID Transfer/ }).click();
  await page.getByRole('button', { name: 'Place & Pay' }).click();
  await expect(page.getByRole('heading', { name: 'Order Tracking' })).toBeVisible();
  await page.getByLabel('UTR / Reference number').fill('TEST-REF-123');
  await page.getByRole('button', { name: 'Submit Payment Proof', exact: true }).click();
  await expect(page.getByText('Verification Pending', { exact: true })).toBeVisible();
  const order = await storefront.Order.findOne({ tenantId: store._id });

  const owner = await browser.newPage();
  captureErrors(owner);
  try {
    await owner.goto(storefront.origin + '/login');
    await owner.getByLabel('Email Address').fill(email);
    await owner.locator('input[name="password"]').fill(password);
    await owner.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(owner).toHaveURL(/\/store\/dashboard$/);
    const responsePromise = owner.waitForResponse((response) => response.url().includes('/admin/orders/payment-queue'));
    await owner.goto(storefront.origin + '/store/orders/payment-queue');
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const queue = (await response.json()).data;
    expect(queue[0].items).toEqual([{ name: product.name, quantity: 1 }]);
    expect(queue[0].paymentProof.screenshotFile).toBeUndefined();
    await expect(owner.getByRole('heading', { name: 'Payment Verification' })).toBeVisible();
    await expect(owner.getByText(order.orderNumber, { exact: true })).toBeVisible();
    await expect(owner.getByText('1 item: ' + product.name + ' ×1', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Reject', exact: true }).click();
    await owner.getByLabel('Reason for rejection *').fill('Reference could not be confirmed');
    await owner.getByRole('button', { name: 'Reject Payment', exact: true }).click();
    await expect(owner.getByText('All clear!', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByLabel('UTR / Reference number').fill('TEST-REF-456');
    await page.getByRole('button', { name: 'Submit Payment Proof', exact: true }).click();
    await expect(page.getByText('Verification Pending', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Refresh payment queue' }).click();
    await expect(owner.getByText(order.orderNumber, { exact: true })).toBeVisible();
    owner.once('dialog', (dialog) => dialog.accept());
    await owner.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(owner.getByText('All clear!', { exact: true })).toBeVisible();
    expect((await storefront.Order.findById(order._id)).status).toBe('payment_verified');
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});
