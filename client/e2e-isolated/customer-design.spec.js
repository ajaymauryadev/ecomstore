import { expect } from '@playwright/test';
import { realtimeTest as test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90000 });

test('customer gets a private live inbox, responsive highlights and a pinned logout', async ({ page, storefront }, testInfo) => {
  const { store } = await storefront.seedStore('customer-design');
  const customer = await storefront.User.create({ name: 'Aarav', phone: '9876543215',
    password: 'Customer123!', role: 'customer', tenantId: store._id });
  const { generateTokens } = await import('../../server/src/utils/jwt.js');
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { data: {
    user: { _id: String(customer._id), name: customer.name, role: customer.role, tenantId: String(store._id) },
    store: { _id: String(store._id), slug: store.slug, name: store.name }, accessToken: generateTokens(customer).accessToken,
  } } }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${storefront.origin}/s/${store.slug}`);
  await expect(page.getByRole('status', { name: 'Live updates connected', exact: true })).toBeVisible({ timeout: 20000 });
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  await expect(bell).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Everyday essentials, closer to home.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('customer-home-mobile.png') });
  await page.getByRole('button', { name: 'Show highlight 2' }).click();
  await expect(page.getByRole('link', { name: 'Explore offers' })).toBeInViewport();
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const { notifyCustomer } = await import('../../server/src/services/notification.service.js');
  await notifyCustomer(store._id, customer._id, 'order_accepted', 'Your order is confirmed', 'We are getting it ready.');
  await expect(page.getByTestId('notification-unread-count')).toHaveText('1');
  await bell.click();
  const inbox = page.getByRole('region', { name: 'Notification inbox' });
  await expect(inbox.getByText('Your order is confirmed', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByTestId('notification-unread-count')).toHaveCount(0);
  await inbox.getByRole('button', { name: 'View all notifications' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByText('Store alerts', { exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Shop navigation' }).getByRole('link', { name: 'Account' }).click();
  const logout = page.getByRole('button', { name: 'Logout', exact: true });
  await expect(logout).toBeInViewport();
  const before = await logout.boundingBox();
  await page.locator('.customer-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect((await logout.boundingBox()).y).toBeCloseTo(before.y, 0);
  const navigation = await page.getByRole('navigation', { name: 'Shop navigation' }).boundingBox();
  expect(before.y + before.height).toBeLessThanOrEqual(navigation.y);
  await page.screenshot({ path: testInfo.outputPath('customer-account-mobile.png') });
  expect(errors).toEqual([]);
});

test('highlights rotate automatically and guest notifications require sign-in', async ({ page, storefront }) => {
  const { store } = await storefront.seedStore('customer-highlights');
  const inboxRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/notifications')) inboxRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${storefront.origin}/s/${store.slug}`);
  await expect(page.getByRole('button', { name: 'Show highlight 1' })).toHaveAttribute('aria-current', 'true', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Show highlight 2' })).toHaveAttribute('aria-current', 'true', { timeout: 10000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Pause highlights' })).toHaveCount(0);
  expect(inboxRequests).toEqual([]);
  await page.getByRole('link', { name: 'Sign in for notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});
