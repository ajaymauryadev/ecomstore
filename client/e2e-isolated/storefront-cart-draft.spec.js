import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

const cartCount = (page, count) => page.getByRole('button', { name: 'Open cart with ' + count + ' items' });
const pathForProduct = (store, product) => '/s/' + store.slug + '/p/' + product._id;
const guestDraftKey = (store) => 'smart-kirana:cart:v1:' + store._id + ':guest';

async function addFromDetail(page) {
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  const drawerHeading = page.getByRole('heading', { name: /^My Cart \(/ });
  await expect(drawerHeading).toBeInViewport();
  await drawerHeading.locator('..').getByRole('button').click();
}

test('restores a guest draft and revalidates price, stock, variants and coupon', async ({ page, storefront }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { store, product } = await storefront.seedStore('draft-revalidation');
  product.variants.push({ name: '2 kg', unit: 'kg', retailPrice: 200, purchasePrice: 120, stock: 100 });
  await product.save();
  const [small, large] = product.variants;
  const coupon = await storefront.Coupon.create({ tenantId: store._id, code: 'DRAFT10', type: 'percent', value: 10 });
  const cartPath = '/s/' + store.slug + '/cart';
  const key = guestDraftKey(store);

  await page.goto(storefront.origin + pathForProduct(store, product));
  await addFromDetail(page);
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: /^2 kg/ }).click();
  await addFromDetail(page);
  await expect(cartCount(page, 3)).toBeVisible();
  await page.reload();
  await expect(cartCount(page, 3)).toBeVisible();
  await page.goto(storefront.origin + cartPath);
  await expect(cartCount(page, 3)).toBeVisible();
  await page.getByPlaceholder('Enter coupon code').fill('DRAFT10');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const cartPage = page.getByRole('main');
  await expect(cartPage.getByText('Saved ₹40', { exact: true })).toBeVisible();

  const draft = await page.evaluate((draftKey) => JSON.parse(sessionStorage.getItem(draftKey)), key);
  expect(draft).toEqual({
    couponCode: 'DRAFT10',
    deliveryType: 'home_delivery',
    items: [
      { productId: String(product._id), variantId: String(small._id), quantity: 2 },
      { productId: String(product._id), variantId: String(large._id), quantity: 1 },
    ],
  });

  const productApi = '**/api/v1/storefront/' + store.slug + '/cart/products';
  const abortProduct = (route) => route.abort('internetdisconnected');
  await page.route(productApi, abortProduct);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My Cart', exact: true })).toBeVisible();
  await expect(cartCount(page, 3)).toBeVisible();
  await expect(cartPage.getByText(/Saved cart — prices, stock and coupons need online confirmation/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cart could not be checked' })).toHaveCount(0);
  expect(await page.evaluate((draftKey) => JSON.parse(sessionStorage.getItem(draftKey)), key)).toEqual(draft);
  await page.unroute(productApi, abortProduct);
  await page.reload();
  await expect(cartPage.getByText('Saved ₹40', { exact: true })).toBeVisible();

  small.stock = 1;
  small.retailPrice = 150;
  product.variants.pull(large._id);
  await product.save();
  await page.reload();
  await expect(cartCount(page, 1)).toBeVisible();
  await expect(cartPage.getByText(/2 kg/)).toHaveCount(0);
  await expect(cartPage.getByText('₹150', { exact: true }).first()).toBeVisible();
  await expect(cartPage.getByText('Saved ₹15', { exact: true })).toBeVisible();
  await expect(cartPage.getByRole('status')).toContainText('Cart availability or coupon eligibility changed');

  await storefront.Coupon.updateOne({ _id: coupon._id }, { $set: { isActive: false } });
  await page.reload();
  await expect(cartPage.getByPlaceholder('Enter coupon code')).toBeVisible();
  await expect(cartPage.getByText('DRAFT10', { exact: true })).toHaveCount(0);
  expect(await page.evaluate((draftKey) => JSON.parse(sessionStorage.getItem(draftKey)), key)).toEqual({
    items: [{ productId: String(product._id), variantId: String(small._id), quantity: 1 }],
    deliveryType: 'home_delivery',
  });
});

test('isolates store and account drafts and clears guest carts at sign-in', async ({ page, storefront }) => {
  const first = await storefront.seedStore('draft-store-first');
  const second = await storefront.seedStore('draft-store-second');
  const password = 'Fixture-password-902';
  const firstPhone = '9876500001';
  const secondPhone = '9876500002';
  for (const phone of [firstPhone, secondPhone]) {
    await storefront.User.create({
      name: 'Cart Fixture Customer',
      tenantId: first.store._id,
      role: 'customer',
      phone,
      password,
    });
  }

  const shop = '/s/' + first.store.slug;
  const gotoProduct = ({ store, product }) => page.goto(storefront.origin + pathForProduct(store, product));
  const signIn = async (phone) => {
    await page.goto(storefront.origin + shop + '/auth');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Mobile number').fill(phone);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(storefront.origin + shop);
    await expect(page.getByRole('link', { name: 'Customer account' })).toBeVisible();
  };
  const signOut = async () => {
    await page.getByRole('link', { name: 'Customer account' }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page).toHaveURL(storefront.origin + shop);
    await expect(page.getByRole('link', { name: 'Login', exact: true })).toBeVisible();
  };

  await gotoProduct(first);
  await addFromDetail(page);
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await gotoProduct(second);
  await expect(cartCount(page, 0)).toBeVisible();
  await addFromDetail(page);
  await gotoProduct(first);
  await expect(cartCount(page, 2)).toBeVisible();

  await signIn(firstPhone);
  await expect(cartCount(page, 0)).toBeVisible();
  for (const { store } of [first, second]) {
    expect(await page.evaluate((key) => sessionStorage.getItem(key), guestDraftKey(store))).toBeNull();
  }
  await gotoProduct(first);
  await addFromDetail(page);
  await page.reload();
  await expect(cartCount(page, 1)).toBeVisible();

  await signOut();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Login', exact: true })).toBeVisible();
  await expect(cartCount(page, 0)).toBeVisible();
  await signIn(secondPhone);
  await expect(cartCount(page, 0)).toBeVisible();
  await gotoProduct(first);
  await addFromDetail(page);
  await page.getByRole('button', { name: 'Increase quantity' }).click();

  await signOut();
  await signIn(firstPhone);
  await expect(cartCount(page, 1)).toBeVisible();
  await gotoProduct(second);
  await expect(cartCount(page, 0)).toBeVisible();
});
