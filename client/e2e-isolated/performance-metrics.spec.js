import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('records cold and warm production loading under constrained browser conditions', async ({ page, storefront }, testInfo) => {
  test.skip(process.env.STOREFRONT_PRODUCTION !== 'true', 'Build for same-origin production and set STOREFRONT_PRODUCTION=true.');
  test.setTimeout(120000);
  await storefront.seedStore('synthetic-metrics');
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
    downloadThroughput: 200000, uploadThroughput: 93750, connectionType: 'cellular3g' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__loadingMetrics = { lcpMs: null, cls: 0, maxInteractionEventMs: 0 };
    new PerformanceObserver((list) => {
      window.__loadingMetrics.lcpMs = list.getEntries().at(-1).startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__loadingMetrics.cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.interactionId) window.__loadingMetrics.maxInteractionEventMs = Math.max(window.__loadingMetrics.maxInteractionEventMs, entry.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  const unexpected = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== storefront.origin) unexpected.push(request.url()); });
  const samples = [];
  for (const mode of ['cold', 'warm']) {
    if (mode === 'cold') await page.goto(`${storefront.origin}/s/synthetic-metrics`);
    else await page.reload();
    await expect(page.getByRole('button', { name: 'Add Pickup Test Rice to cart' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Add Pickup Test Rice to cart' }).click();
    await expect(page.getByRole('button', { name: /Open cart with 1 items/ })).toBeVisible();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    samples.push({ mode, ...await page.evaluate(() => ({
      ...window.__loadingMetrics,
      fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
      resourceCount: performance.getEntriesByType('resource').length,
      transferredBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0),
    })) });
    // Clear the cart before reload so both measurements exercise the same action.
    if (mode === 'cold') await page.getByRole('button', { name: 'Decrease quantity of Pickup Test Rice' }).first().click();
  }
  expect(unexpected).toEqual([]);
  const report = { scope: 'Single synthetic mobile page, production Vite preview; 4x CPU, 150ms RTT, 1.6Mbps down. Cold/warm sample, not field p75, Lighthouse or INP.', samples };
  console.log(JSON.stringify(report, null, 2));
  await testInfo.attach('loading-metrics.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
