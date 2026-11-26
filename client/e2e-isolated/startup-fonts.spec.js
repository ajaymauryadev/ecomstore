import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('session and storefront data load even while the external font stylesheet stalls', async ({ page, storefront }) => {
  await storefront.seedStore('font-independent-startup');
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let fontRequested = false, sessionStarted = false;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/refresh') sessionStarted = true;
  });
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    fontRequested = true;
    await held;
    await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });
  const navigation = page.goto(`${storefront.origin}/s/font-independent-startup`, { waitUntil: 'domcontentloaded' });
  try {
    await expect.poll(() => fontRequested).toBe(true);
    await expect.poll(() => sessionStarted, { timeout: 5000 }).toBe(true);
    await expect(page.getByRole('button', { name: 'Add Pickup Test Rice to cart' })).toBeEnabled();
  } finally { release(); await navigation; }
});
