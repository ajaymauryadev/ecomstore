import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

for (const width of [390, 1440]) {
  test(`split bill, customer search and repayments work at ${width}px`, async ({ page, storefront }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const email = `split-${width}@example.com`, password = 'SplitCheckout123!';
    const { store } = await storefront.seedStore(`split-${width}`, { email, password });
    const customer = await storefront.UdharCustomer.create({ tenantId: store._id, name: 'Ajay Sharma', phone: '9876543210' });
    const login = await page.request.post(storefront.apiOrigin + '/api/v1/auth/login', { data: { email, password } });
    expect(login.status()).toBe(200);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(storefront.origin + '/store/pos');
    await page.getByRole('button', { name: /Pickup Test Rice 1 kg/ }).click();
    await page.getByRole('button', { name: 'Udhar', exact: true }).click();
    await page.getByLabel(/Cash received/).fill('20');
    await page.getByLabel(/UPI received/).fill('30');
    await page.getByLabel('Search customer by name or phone').fill('Ajay');
    await expect(page.getByRole('option', { name: 'Ajay Sharma · 9876543210' })).toBeAttached();
    await page.getByLabel('Select Udhar account').selectOption(String(customer._id));
    await expect(page.locator('.pos-account-selected')).toContainText('Due after this bill: ₹50.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (width > 1000) {
      await expect(page.getByRole('group', { name: 'Store navigation sections' })).toBeVisible();
      await page.getByRole('button', { name: 'Catalog', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Sales', exact: true }).click();
    }
    await page.screenshot({ path: testInfo.outputPath('split-pos.png'), fullPage: true });
    await page.getByRole('button', { name: /Create Udhar Bill/ }).click();
    const receipt = page.getByRole('dialog', { name: 'Bill Generated' });
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('Cash received');
    await expect(receipt).toContainText('UPI received');
    await expect(receipt).toContainText('Added to Udhar');
    expect((await storefront.UdharCustomer.findById(customer._id)).balance).toBe(50);
    await page.getByRole('button', { name: 'New Sale', exact: true }).click();
    await page.goto(storefront.origin + '/store/udhar');
    await page.getByRole('textbox', { name: 'Search credit customers' }).fill('76543');
    await page.getByRole('button', { name: /Ajay Sharma/ }).click();
    await expect(page.getByText('Pending on this bill', { exact: true })).toBeVisible();
    await page.getByText(/Purchase details/).click();
    await expect(page.getByText('Pickup Test Rice', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bill payment history' })).toContainText('Cash · At purchase');
    await expect(page.getByRole('button', { name: 'Give Credit', exact: true })).toHaveCount(0);
    await expect(page.getByText('Credit Limit', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    const payment = page.getByRole('dialog', { name: 'Record Payment' });
    await payment.getByLabel(/Amount/).fill('25');
    await payment.getByLabel('Payment Method').selectOption('upi');
    await payment.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await expect(payment).not.toBeVisible();
    await expect(page.locator('.ledger-bill-summary')).toContainText('₹25');
    await expect(page.getByRole('region', { name: 'Bill payment history' })).toContainText('UPI · Account repayment');
    expect((await storefront.UdharCustomer.findById(customer._id)).balance).toBe(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('udhar-history.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
}
