import { expect } from '@playwright/test';
import Notification from '../../server/src/models/Notification.js';
import { test } from './storefront-fixture.js';

for (const viewport of [{ width: 1365, height: 768 }, { width: 390, height: 844 }]) {
  test(`notification view stays structured across filter, error and refresh at ${viewport.width}px`, async ({ page, storefront }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    const slug = `phase3-notifications-${viewport.width}`;
    const credentials = { email: `${slug}@example.com`, password: 'Phase3Notification123!' };
    const { store } = await storefront.seedStore(slug, credentials);
    await Notification.create([
      { tenantId: store._id, role: 'admin', type: 'new_order', title: 'Unread phase 3 event', isRead: false },
      { tenantId: store._id, role: 'admin', type: 'low_stock', title: 'Read phase 3 event', isRead: true },
    ]);
    expect((await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials })).status()).toBe(200);

    let releaseInitial, releaseChanged, releaseRefresh;
    const initial = new Promise((resolve) => { releaseInitial = resolve; });
    const changed = new Promise((resolve) => { releaseChanged = resolve; });
    const refresh = new Promise((resolve) => { releaseRefresh = resolve; });
    let mode = 'initial';
    const requests = [];
    await page.route('**/api/v1/notifications?**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('limit') !== '5') return route.continue();
      const current = mode;
      requests.push({ mode: current, isRead: url.searchParams.get('isRead') });
      if (current === 'initial') await initial;
      if (current === 'changed') {
        await changed;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary failure' }) });
      }
      if (current === 'refresh') await refresh;
      return route.continue();
    });

    await page.goto(`${storefront.origin}/store/notifications`);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(main.getByText('Total unavailable')).toBeVisible();
    await expect(main.getByRole('status', { name: 'Loading notifications' })).toBeVisible();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    mode = 'ready';
    releaseInitial();
    await expect(main.getByText('2 total')).toBeVisible();
    await expect(main.getByText('Unread phase 3 event', { exact: true })).toBeVisible();
    await expect(main.getByText('Read phase 3 event', { exact: true })).toBeVisible();

    mode = 'changed';
    await main.getByRole('button', { name: 'Unread', exact: true }).click();
    await expect.poll(() => requests.some((request) => request.mode === 'changed' && request.isRead === 'false')).toBe(true);
    await expect(main.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(main.getByText('Total unavailable')).toBeVisible();
    await expect(main.getByText('Read phase 3 event', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('status', { name: 'Loading notifications' })).toBeVisible();
    mode = 'ready';
    releaseChanged();
    await expect(main.getByRole('heading', { name: 'This view is waiting for its first download' })).toBeVisible();
    await expect(main.getByText('0 total')).toHaveCount(0);
    await main.getByRole('button', { name: 'Try again' }).click();
    await expect(main.getByText('1 total')).toBeVisible();
    await expect(main.getByText('Unread phase 3 event', { exact: true })).toBeVisible();
    await expect(main.getByText('Read phase 3 event', { exact: true })).toHaveCount(0);

    mode = 'refresh';
    await main.getByRole('button', { name: 'Mark notification as read' }).click();
    await expect.poll(() => requests.some((request) => request.mode === 'refresh')).toBe(true);
    await expect(main.getByText('Unread phase 3 event', { exact: true })).toBeVisible();
    await expect(main.getByRole('status', { name: 'Loading notifications' })).toHaveCount(0);
    releaseRefresh();
    await expect(main.getByText('No notifications')).toBeVisible();
    await page.evaluate(() => { history.pushState({}, '', '/store/dashboard'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.locator('main h1').first()).toBeVisible();
    await page.goBack();
    await expect(main.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Unread', exact: true })).toHaveClass(/bg-gold-500/);
    await expect(main.getByText('No notifications')).toBeVisible();
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  });
}
