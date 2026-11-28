import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 90_000 });

const credentials = (name) => ({ email: `phase2-${name}@example.com`, password: 'Phase2Password123!' });
const holdIndexedDB = () => {
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: () => ({}) } });
};

test('public catalog becomes useful while IndexedDB never opens', async ({ page, storefront }) => {
  await storefront.seedStore('phase2-public', credentials('public'));
  await page.addInitScript(holdIndexedDB);
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) requests.push(new URL(request.url()).pathname);
  });
  await page.goto(`${storefront.origin}/s/phase2-public`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.storefront-product').first()).toBeVisible();
  expect(requests.some((path) => path.includes('/storefront/phase2-public/products'))).toBe(true);
  await expect(page.locator('#root .startup-shell')).toHaveCount(0);
});

test('a protected page stays gated when identity storage is blocked', async ({ page, storefront }) => {
  await storefront.seedStore('phase2-blocked', credentials('blocked'));
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials('blocked') });
  expect(login.status()).toBe(200);
  await page.addInitScript(holdIndexedDB);
  let refreshes = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/auth/refresh')) refreshes++;
  });
  await page.goto(`${storefront.origin}/store/dashboard`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root .startup-shell')).toBeVisible();
  await expect(page.getByText("Today's sales", { exact: true })).toHaveCount(0);
  expect(refreshes).toBe(0);
});

test('a rejected identity-marker read gates the old cookie until explicit sign-in', async ({ page, storefront }) => {
  await storefront.seedStore('phase2-rejected', credentials('rejected'));
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials('rejected') });
  expect(login.status()).toBe(200);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: {
      open: () => { throw new Error('IndexedDB denied'); },
    } });
  });
  await page.goto(`${storefront.origin}/store/dashboard`);
  await expect(page.getByText('Device storage could not be checked.')).toBeVisible();
  await expect(page.getByText("Today's sales", { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Email Address')).toBeVisible();
  await page.getByLabel('Email Address').fill(credentials('rejected').email);
  await page.locator('input').and(page.getByLabel('Password')).fill(credentials('rejected').password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText("Today's sales", { exact: true })).toBeVisible();
  await expect(page.getByText('Loading Smart Kirana...')).toHaveCount(0);
});

test('a slow refresh gates private data and issues one startup refresh', async ({ page, storefront }) => {
  await storefront.seedStore('phase2-slow', credentials('slow'));
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials('slow') });
  expect(login.status()).toBe(200);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let refreshes = 0;
  await page.route('**/api/v1/auth/refresh', async (route) => {
    refreshes++;
    await held;
    await route.continue();
  });
  try {
    await page.goto(`${storefront.origin}/store/dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root .startup-shell')).toBeVisible();
    await expect(page.getByText("Today's sales", { exact: true })).toHaveCount(0);
    await expect.poll(() => refreshes).toBe(1);
  } finally { release(); }
  await expect(page.getByText("Today's sales", { exact: true })).toBeVisible();
  expect(refreshes).toBe(1);
});

for (const [name, status] of [['expired', 401], ['limited', 429], ['unreachable', 'abort']]) {
  test(`refresh ${name} never reveals the protected dashboard`, async ({ page, storefront }) => {
    await storefront.seedStore(`phase2-${name}`, credentials(name));
    const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials(name) });
    expect(login.status()).toBe(200);
    await page.route('**/api/v1/auth/refresh', (route) => status === 'abort'
      ? route.abort('timedout')
      : route.fulfill({ status, json: { message: name, ...(status === 429 && { retryAfterSeconds: 60 }) } }));
    await page.goto(`${storefront.origin}/store/dashboard`);
    if (status === 401) await expect(page).toHaveURL(/\/login$/);
    else await expect(page.getByText('Connection interrupted')).toBeVisible();
    await expect(page.getByText("Today's sales", { exact: true })).toHaveCount(0);
  });
}

test('a second tab switching tenants clears the first tab before showing the new owner', async ({ page, storefront }) => {
  const first = await storefront.seedStore('phase2-first', credentials('first'));
  const second = await storefront.seedStore('phase2-second', credentials('second'));
  await storefront.User.updateOne({ _id: first.store.ownerId }, { $set: { name: 'First Owner' } });
  await storefront.User.updateOne({ _id: second.store.ownerId }, { $set: { name: 'Second Owner' } });
  const login = await page.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, { data: credentials('first') });
  expect(login.status()).toBe(200);
  await page.goto(`${storefront.origin}/store/dashboard`);
  await expect(page.getByRole('heading', { name: /First/ })).toBeVisible();

  const other = await page.context().newPage();
  try {
    await other.goto(`${storefront.origin}/login`);
    await other.getByLabel('Email Address').fill(credentials('second').email);
    await other.locator('input').and(other.getByLabel('Password')).fill(credentials('second').password);
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(other.getByRole('heading', { name: /Second/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /First/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
  } finally { await other.close(); }
});
