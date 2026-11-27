import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('compact catalog cards align text and controls and retain cart and favourite actions', async ({ page, storefront }) => {
  test.setTimeout(90000);
  const slug = 'compact-card-layout';
  const { store, product } = await storefront.seedStore(slug);
  product.name = 'Nonstick Induction Frying Pan';
  product.brand = 'Pigeon';
  product.images = [{ url: '/card-pan.svg', isMain: true }];
  product.variants[0].name = '1 piece';
  product.variants[0].retailPrice = 800;
  product.variants[0].offerPrice = 765;
  await product.save();
  await storefront.Product.create([
    { name: 'Milk 500', brand: 'Amul', retail: 50, offer: 45, image: 'milk' },
    { name: 'Aashirwad Atta', brand: 'Aashirwad', retail: 270, offer: 250, image: 'atta' },
    { name: 'Rusk', brand: 'Madhur', retail: 23, offer: 20, image: 'rusk' },
  ].map(({ name, brand, retail, offer, image }) => ({ tenantId: store._id, name, brand, isOnline: true,
    images: [{ url: `/card-${image}.svg`, isMain: true }],
    variants: [{ name: '1 piece', retailPrice: retail, offerPrice: offer, stock: 50 }] })));
  const customer = await storefront.User.create({ name: 'Card Customer', phone: '9876501133', password: 'Customer123!',
    role: 'customer', tenantId: store._id });
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/storefront/${slug}/auth/login`,
    { data: { phone: customer.phone, password: 'Customer123!' } });
  expect(login.status()).toBe(200);
  await page.route('**/card-*.svg', (route) => {
    const pan = route.request().url().includes('pan');
    const art = pan
      ? '<path d="M122 67L181 13" stroke="#303536" stroke-width="14" stroke-linecap="round"/><ellipse cx="85" cy="92" rx="69" ry="36" fill="#b12d32"/><ellipse cx="85" cy="84" rx="69" ry="33" fill="#242727" stroke="#747978" stroke-width="3"/>'
      : '<path d="M63 12h75l-5 15 5 104H63l5-104z" fill="#dabc7b"/><path d="M69 45h63v62H69z" fill="#ce343a"/>';
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140">${art}</svg>` });
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const profileRoute = `**/api/v1/storefront/${slug}/customer/profile`;
  await page.route(profileRoute, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Profile temporarily unavailable' }) }));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(`${storefront.origin}/s/${slug}`);
  const cards = page.locator('.storefront-product');
  await expect(cards).toHaveCount(4);
  const pan = cards.filter({ has: page.getByRole('link', { name: product.name, exact: true }) });
  await expect(pan.locator('.storefront-favorite')).toBeDisabled();
  await expect(pan.getByRole('link', { name: product.name, exact: true })).toBeVisible();
  await page.unroute(profileRoute);
  await page.reload();
  await expect(pan.locator('.storefront-favorite')).toBeEnabled();
  await expect(pan.locator('.storefront-product-saving')).toHaveText('Save ₹35');
  for (const width of [320, 393, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.locator('.customer-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const placements = await cards.evaluateAll((nodes) => nodes.map((card) => {
      const top = card.getBoundingClientRect().top;
      return ['.storefront-product-name', '.storefront-pack-size', '.storefront-product-price-row', '.storefront-add']
        .map((selector) => Math.round((card.querySelector(selector).getBoundingClientRect().top - top) * 10) / 10);
    }));
    for (const placement of placements) expect(placement).toEqual(placements[0]);
    if (width === 393) await page.locator('.storefront-results > .grid').screenshot({ path: '.cache/compact-product-cards-393.png' });
  }
  await expect(pan.locator('.storefront-add')).toHaveText('Add to cart');
  await expect(pan.locator('.storefront-add')).toHaveCSS('font-size', '11px');
  const favorite = pan.getByRole('button', { name: `Save ${product.name} to favourites`, exact: true });
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await favorite.click();
  await expect(pan.getByRole('button', { name: `Remove ${product.name} from favourites`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await pan.boundingBox();
  await pan.getByRole('button', { name: `Add ${product.name} to cart`, exact: true }).click();
  await expect(pan.getByRole('button', { name: `Increase quantity of ${product.name}`, exact: true })).toBeEnabled();
  expect((await pan.boundingBox()).height).toBe(before.height);
  expect(errors).toEqual([]);
});
