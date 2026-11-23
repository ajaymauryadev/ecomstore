import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('supplier account retry settles the invoice once and exposes legacy mismatches', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const slug = 'supplier-payment-reconciliation';
  const ownerLogin = { email: slug + '@example.com', password: 'IsolatedSupplier123!' };
  const { store, product } = await storefront.seedStore(slug, ownerLogin);
  const supplier = await storefront.Supplier.create({
    tenantId: store._id, name: 'Test Supplier', totalPurchased: 1000, pendingAmount: 1000,
  });
  const legacy = await storefront.Supplier.create({
    tenantId: store._id, name: 'Legacy Supplier', totalPurchased: 1000, totalPaid: 1000, pendingAmount: 0,
  });
  const invoice = (account, invoiceNumber) => storefront.PurchaseEntry.create({
    tenantId: store._id, supplierId: account._id, invoiceNumber, createdBy: store.ownerId,
    items: [{ productId: product._id, variantId: product.variants[0]._id, quantity: 1, purchasePrice: 1000 }],
  });
  const current = await invoice(supplier, 'INV-BROWSER');
  await invoice(legacy, 'INV-LEGACY');

  await page.goto(storefront.origin + '/store/supplier-payments');
  await page.getByLabel('Email Address').fill(ownerLogin.email);
  await page.getByLabel(/^Password/).fill(ownerLogin.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await page.getByRole('button', { name: 'Reconciliation', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Supplier Reconciliation' });
  await expect(report.getByRole('heading', { name: legacy.name })).toBeVisible();
  await expect(report.getByRole('link', { name: 'INV-LEGACY' })).toBeVisible();
  await report.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Payment' });
  await expect(dialog.getByText(/oldest open invoice first/)).toBeVisible();
  await expect(dialog.getByLabel('Amount (₹)')).toHaveValue('1000');
  await dialog.getByLabel('Payment Method').selectOption('upi');

  const endpoint = '/api/v1/suppliers/' + supplier._id + '/payment';
  let committed, firstKey;
  await page.route('**' + endpoint, async (route) => {
    firstKey = (await route.request().allHeaders())['idempotency-key'];
    const response = await route.fetch();
    committed = { status: response.status(), body: await response.json() };
    await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Record Payment', exact: true }).click();
  const retry = dialog.getByRole('button', { name: 'Retry original payment' });
  await expect(retry).toBeVisible();
  expect(committed.status).toBe(200);
  expect(firstKey).toMatch(/^[a-f0-9]{32}$/);
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST'),
    retry.click(),
  ]);
  expect(response.status()).toBe(200);
  expect((await response.request().allHeaders())['idempotency-key']).toBe(firstKey);
  expect((await response.json()).data.payment._id).toBe(committed.body.data.payment._id);
  await expect(dialog).toHaveCount(0);

  await page.getByRole('link', { name: /INV-BROWSER/ }).click();
  await expect(page.getByText('PAID', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invoice Allocation History' })).toBeVisible();
  expect(await storefront.PurchaseEntry.findById(current._id)).toMatchObject({ pendingAmount: 0, paymentStatus: 'PAID' });
  expect(await storefront.Supplier.findById(supplier._id)).toMatchObject({ pendingAmount: 0, totalPaid: 1000 });
  expect((await storefront.Supplier.findById(supplier._id)).paymentHistory).toHaveLength(1);
});
