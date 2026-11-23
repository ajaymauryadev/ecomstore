import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

const password = 'Combined-shop-duties-123';

for (const operator of ['owner', 'employee']) {
  test(`${operator} completes packing, verification and delivery from one login`, async ({ page, request, storefront }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const slug = 'combined-duties-' + operator;
    const email = operator + '-owner@example.com';
    const { product } = await storefront.seedStore(slug, { email, password });
    const api = storefront.origin + '/api/v1';
    const ownerLogin = await page.request.post(api + '/auth/login', { data: { email, password } });
    expect(ownerLogin.status()).toBe(200);
    const ownerToken = (await ownerLogin.json()).data.accessToken;
    const customer = await request.post(api + '/storefront/' + slug + '/auth/register', {
      data: { name: 'Shop Buyer', phone: '9876543210', password },
    });
    expect(customer.status()).toBe(201);
    const customerToken = (await customer.json()).data.accessToken;
    const placed = await request.post(api + '/storefront/' + slug + '/orders', {
      headers: { Authorization: 'Bearer ' + customerToken },
      data: {
        orderType: 'home_delivery', paymentMethod: 'cod',
        customerInfo: { name: 'Shop Buyer', phone: '9876543210', address: { line1: '12 Market Road', city: 'Pune' } },
        items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 1 }],
      },
    });
    expect(placed.status()).toBe(201);
    const order = (await placed.json()).data.order;
    const accepted = await page.request.patch(api + '/storefront/' + slug + '/admin/orders/' + order._id + '/status', {
      headers: { Authorization: 'Bearer ' + ownerToken }, data: { status: 'accepted' },
    });
    expect(accepted.status()).toBe(200);

    let packingPath = '/store/packing/work';
    if (operator === 'employee') {
      await page.goto(storefront.origin + '/store/staff');
      await page.getByRole('button', { name: 'Add staff', exact: true }).first().click();
      const editor = page.getByRole('dialog', { name: 'Add staff member' });
      await editor.getByLabel('Full name').fill('One Shop Labour');
      await editor.getByRole('textbox', { name: 'Email', exact: true }).fill('combined-labour@example.com');
      await editor.getByLabel('Temporary password').fill(password);
      await editor.getByText('Delivery', { exact: true }).click();
      const included = editor.getByRole('group', { name: 'Included with role', exact: true });
      await expect(included.getByRole('checkbox', { name: 'View assigned deliveries', exact: true })).toBeChecked();
      await expect(included.getByRole('checkbox', { name: 'Update assigned deliveries', exact: true })).toBeDisabled();
      await expect(editor.getByRole('checkbox', { name: 'Pick and pack assigned orders', exact: true })).not.toBeChecked();
      await editor.getByText('Packer', { exact: true }).click();
      await expect(included.getByRole('checkbox', { name: 'Pick and pack assigned orders', exact: true })).toBeChecked();
      await expect(included.getByRole('checkbox', { name: 'Pick and pack assigned orders', exact: true })).toBeDisabled();
      await expect(editor.getByRole('checkbox', { name: 'View assigned deliveries', exact: true })).not.toBeChecked();
      await editor.getByRole('button', { name: 'Packing + delivery', exact: true }).click();
      await editor.getByRole('button', { name: 'Clear extra access', exact: true }).click();
      await expect(included.getByRole('checkbox', { name: 'Pick and pack assigned orders', exact: true })).toBeChecked();
      await expect(editor.getByRole('checkbox', { name: 'Work on all store deliveries', exact: true })).not.toBeChecked();
      await editor.getByRole('button', { name: 'Packing + delivery', exact: true }).click();
      await expect(editor.getByRole('checkbox', { name: 'Work on all packing orders', exact: true })).toBeChecked();
      await expect(editor.getByRole('checkbox', { name: 'Work on all store deliveries', exact: true })).toBeChecked();
      await editor.getByRole('button', { name: 'Create account' }).click();
      await expect(editor).not.toBeVisible();
      const login = await page.request.post(api + '/auth/login', {
        data: { email: 'combined-labour@example.com', password },
      });
      expect(login.status()).toBe(200);
      packingPath = '/staff/packing';
    }

    await page.goto(storefront.origin + packingPath);
    await expect(page.getByRole('heading', { name: 'Pack Orders', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start Packing', exact: true }).click();
    await page.getByRole('button', { name: 'Pick', exact: true }).click();
    await page.getByRole('button', { name: 'Packed ✓', exact: true }).click();
    await page.getByRole('button', { name: 'Complete Packing', exact: true }).click();
    await page.getByRole('dialog', { name: 'Submit packing for verification', exact: true })
      .getByRole('button', { name: 'Submit for verification', exact: true }).click();
    await expect(page).toHaveURL(storefront.origin + packingPath);
    await page.getByRole('navigation', { name: operator === 'owner' ? 'Store navigation' : 'Staff navigation', exact: true })
      .getByRole('link', { name: /^Packing Verification/ }).click();
    await page.getByRole('button', { name: new RegExp('Order #' + order.orderNumber) }).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('navigation', { name: 'Store navigation', exact: true }).getByRole('link', { name: 'Deliveries', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Deliveries', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm delivered', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirm delivery', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(async () => (await storefront.Order.findById(order._id)).status).toBe('delivered');
    expect((await storefront.Order.findById(order._id)).paymentStatus).toBe('paid');
    await expect(page).not.toHaveURL(/\/login$/);
  });
}
