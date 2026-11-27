import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('account favourites show saved product images and readable cards on small screens', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const slug = 'account-favourites';
  const { store, product } = await storefront.seedStore(slug);
  product.name = 'Milk 500';
  product.images = [{ url: '/favorite-other.svg' }, { url: '/favorite-main.svg', isMain: true }];
  await product.save();
  const second = await storefront.Product.create({ tenantId: store._id, name: 'Rusk with a longer product name', isOnline: true,
    variants: [{ name: '1 pack', retailPrice: 20, stock: 20 }] });
  const customer = await storefront.User.create({ name: 'Favourite Customer', phone: '9876501122', password: 'Customer123!',
    role: 'customer', tenantId: store._id, favoriteProductIds: [product._id, second._id] });
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/storefront/${slug}/auth/login`,
    { data: { phone: customer.phone, password: 'Customer123!' } });
  expect(login.status()).toBe(200);
  await page.route('**/favorite-*.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="220" viewBox="0 0 180 220"><path fill="#d9edfc" stroke="#7eabce" d="M45 30l45-18 45 18v176H45z"/><path fill="#f9fcff" d="M46 70h88v102H46z"/><text x="90" y="119" text-anchor="middle" fill="#1f4774" font-family="sans-serif" font-size="24" font-weight="bold">MILK</text><text x="90" y="147" text-anchor="middle" fill="#1f4774" font-family="sans-serif" font-size="14">500 ml</text></svg>' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${storefront.origin}/s/${slug}/account`);
  const favourites = page.locator('#favorites-section');
  await expect(favourites.locator('.grid > a')).toHaveCount(2);
  const image = favourites.locator('img');
  await expect(image).toHaveAttribute('src', '/favorite-main.svg');
  await expect(image).toHaveJSProperty('naturalWidth', 180);
  await expect(image).toHaveCSS('object-fit', 'contain');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('.customer-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (width === 390) await favourites.screenshot({ path: '.cache/account-favourites-mobile.png' });
  }
  await favourites.getByRole('link', { name: /Milk 500/ }).click();
  await expect(page.getByRole('heading', { name: 'Milk 500', exact: true })).toBeVisible();
});
