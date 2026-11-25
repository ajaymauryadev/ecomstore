import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });

async function setup(page, storefront, slug) {
  const email = slug + '@example.com', password = 'BillSettlement123!';
  const seeded = await storefront.seedStore(slug, { email, password });
  const login = await page.request.post(storefront.apiOrigin + '/api/v1/auth/login', { data: { email, password } });
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.accessToken;
  return { ...seeded, token };
}

for (const width of [390, 1440]) {
  test(`a later account receipt clears the first bill and a targeted receipt clears the next at ${width}px`, async ({ page, storefront }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const { store } = await setup(page, storefront, `bill-settlement-${width}`);
    const customer = await storefront.UdharCustomer.create({ tenantId: store._id, name: 'Mira Sharma', phone: '9876543210' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(storefront.origin + '/store/pos');
    const ids = [];
    for (const split of [true, false]) {
      await page.getByRole('button', { name: /Pickup Test Rice 1 kg/ }).click();
      await page.getByRole('button', { name: 'Udhar', exact: true }).click();
      if (split) {
        await page.getByLabel(/Cash received/).fill('20');
        await page.getByLabel(/UPI received/).fill('30');
      }
      await page.getByLabel('Select Udhar account').selectOption(String(customer._id));
      const [response] = await Promise.all([
        page.waitForResponse((row) => row.request().method() === 'POST' && row.url().endsWith('/pos/order')),
        page.getByRole('button', { name: /Create Udhar Bill/ }).click(),
      ]);
      expect(response.status()).toBe(201);
      ids.push((await response.json()).data.order._id);
      await page.getByRole('button', { name: 'New Sale', exact: true }).click();
    }
    await page.goto(storefront.origin + '/store/udhar?customerId=' + customer._id);
    await expect(page.getByRole('region', { name: 'Customer bills' }).locator('article')).toHaveCount(2);
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    const payment = page.getByRole('dialog', { name: 'Record Payment' });
    await payment.getByLabel(/Amount/).fill('70');
    await expect(payment.getByRole('region', { name: 'Payment allocation preview' })).toContainText('₹50');
    await expect(payment.getByRole('region', { name: 'Payment allocation preview' })).toContainText('₹20');
    await payment.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await expect(payment).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Customer bills' }).getByText(/^Fully paid/)).toBeVisible();
    expect((await storefront.UdharCustomer.findById(customer._id)).balance).toBe(80);
    await page.goto(storefront.origin + '/store/orders?orderId=' + ids[0]);
    let order = page.getByRole('dialog');
    await order.getByRole('button', { name: /^payment$/i }).click();
    await expect(order.getByText(/^Fully paid/)).toBeVisible();
    await expect(order).toContainText('Cash + UPI + Udhar');
    await expect(order.getByRole('region', { name: 'Bill payment history' })).toContainText('receipt ₹70');
    await page.screenshot({ path: testInfo.outputPath('cleared-bill-payment.png'), fullPage: true });
    await page.goto(storefront.origin + '/store/orders?orderId=' + ids[1]);
    order = page.getByRole('dialog');
    await order.getByRole('button', { name: /^payment$/i }).click();
    await order.getByRole('button', { name: 'Receive payment for this bill' }).click();
    await payment.getByLabel(/Amount/).fill('80');
    await payment.getByLabel('Payment Method').selectOption('upi');
    await payment.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await expect(payment).not.toBeVisible();
    await expect(page.getByRole('dialog').getByText(/^Fully paid/)).toBeVisible();
    expect((await storefront.UdharCustomer.findById(customer._id)).balance).toBe(0);
    const history = page.getByRole('region', { name: 'Bill payment history' });
    await expect(history).toContainText('UPI · Account repayment');
    await history.getByText('₹80', { exact: true }).locator('..').getByRole('button', { name: 'Correct payment' }).click();
    const correction = page.getByRole('dialog', { name: 'Correct payment' });
    await expect(correction).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(correction).not.toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('POS exposes owner, employee and later packing assignment and opens the pending packing queue', async ({ page, storefront }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { store } = await setup(page, storefront, 'pos-packing-choice');
  const employee = await storefront.User.create({ tenantId: store._id, name: 'Ravi Packer', email: 'ravi.packer@example.com', role: 'packer', password: 'PackingWorker123!' });
  await page.goto(storefront.origin + '/store/pos');
  await page.getByRole('button', { name: /Pickup Test Rice 1 kg/ }).click();
  await page.getByRole('button', { name: 'Needs packing', exact: true }).click();
  const assignee = page.getByLabel('Packing assignee');
  await expect(assignee.getByRole('option', { name: /Me/ })).toBeAttached();
  await expect(assignee.getByRole('option', { name: 'Unassigned' })).toBeAttached();
  await page.getByRole('textbox', { name: 'Search packing staff' }).fill('Ravi');
  await expect(assignee.getByRole('option', { name: /Ravi Packer/ })).toBeAttached();
  await assignee.selectOption(String(employee._id));
  await page.screenshot({ path: testInfo.outputPath('pos-packing-assignment.png'), fullPage: true });
  const [response] = await Promise.all([
    page.waitForResponse((row) => row.request().method() === 'POST' && row.url().endsWith('/pos/order')),
    page.getByRole('button', { name: /Collect Payment/ }).click(),
  ]);
  expect(response.status()).toBe(201);
  const order = (await response.json()).data.order;
  expect(order).toMatchObject({ status: 'accepted', assignedTo: String(employee._id), saleType: 'parcha' });
  await page.getByRole('link', { name: 'Open Pack Orders' }).click();
  await expect(page.getByText(order.orderNumber, { exact: true })).toBeVisible();
  expect((await storefront.Order.findById(order._id)).deliveredAt).toBeUndefined();
});

test('received payments and bill receipts load five at a time with working next and previous', async ({ page, storefront }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { store, product, token } = await setup(page, storefront, 'five-payment-pages');
  const customer = await storefront.UdharCustomer.create({ tenantId: store._id, name: 'Ajay Ledger', phone: '9876543210' });
  const headers = { Authorization: 'Bearer ' + token };
  const bill = await page.request.post(storefront.apiOrigin + '/api/v1/pos/order', { headers, data: {
    items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), qty: 1 }], paymentMethod: 'credit', udharCustomerId: String(customer._id),
  } });
  expect(bill.status()).toBe(201);
  const order = (await bill.json()).data.order;
  for (let i = 0; i < 7; i += 1) {
    const receipt = await page.request.post(storefront.apiOrigin + `/api/v1/udhar/${customer._id}/credit`, { headers: { ...headers, 'Idempotency-Key': 'five-payment-' + i }, data: { amount: 10, method: i % 2 ? 'upi' : 'cash' } });
    expect(receipt.status()).toBe(201);
  }
  await page.goto(storefront.origin + '/store/orders?orderId=' + order._id);
  await page.getByRole('button', { name: /^payment$/i }).click();
  const history = page.getByRole('region', { name: 'Bill payment history' });
  await expect(history.getByRole('button', { name: 'Correct payment' })).toHaveCount(5);
  await history.getByRole('button', { name: 'Next payments' }).click();
  await expect(history.getByRole('button', { name: 'Correct payment' })).toHaveCount(2);
  await history.getByRole('button', { name: 'Previous payments' }).click();
  await expect(history.getByRole('button', { name: 'Correct payment' })).toHaveCount(5);
  await page.goto(storefront.origin + '/store/sales');
  const list = page.getByRole('region', { name: 'Received payments' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(5);
});

test('a lost payment response survives a page reload and retries the committed receipt once', async ({ page, storefront }) => {
  const { store, product, token } = await setup(page, storefront, 'durable-payment-retry');
  const customer = await storefront.UdharCustomer.create({ tenantId: store._id, name: 'Retry Customer', phone: '9876543210' });
  const bill = await page.request.post(storefront.apiOrigin + '/api/v1/pos/order', { headers: { Authorization: 'Bearer ' + token }, data: {
    items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), qty: 1 }], paymentMethod: 'credit', udharCustomerId: String(customer._id),
  } });
  expect(bill.status()).toBe(201);
  await page.goto(storefront.origin + '/store/udhar?customerId=' + customer._id);
  await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Record Payment' });
  await payment.getByLabel(/Amount/).fill('25');
  await page.route(`**/api/v1/udhar/${customer._id}/credit`, async (route) => {
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    await route.abort('failed');
  }, { times: 1 });
  await payment.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(payment.getByRole('button', { name: 'Retry original payment' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(payment.getByLabel(/Amount/)).toHaveValue('25');
  await expect(payment.getByLabel(/Amount/)).toBeDisabled();
  await payment.getByRole('button', { name: 'Retry original payment' }).click();
  await expect(payment).not.toBeVisible();
  expect((await storefront.UdharCustomer.findById(customer._id)).balance).toBe(75);
  expect(await storefront.UdharEntry.countDocuments({ customerId: customer._id, type: 'credit' })).toBe(1);
});
