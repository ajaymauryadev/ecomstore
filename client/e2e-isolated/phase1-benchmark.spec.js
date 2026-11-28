import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test.describe.configure({ timeout: 240_000 });

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
};

const routeTemplate = (url) => {
  const parsed = new URL(url);
  const path = parsed.pathname
    .replace(/\/storefront\/[^/]+(?=\/|$)/, '/storefront/:slug')
    .replace(/\/s\/[^/]+(?:\/|$)/, '/s/:slug/');
  return `${path}${parsed.search ? `?${[...parsed.searchParams.keys()].sort().join('&')}` : ''}`;
};

const collect = async (browser, storefront, route, { authenticated = false, warm = false } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const idbDelayMs = Number(process.env.PHASE2_IDB_DELAY_MS || 0);
  if (idbDelayMs) await page.addInitScript((delay) => {
    const nativeOpen = indexedDB.open.bind(indexedDB);
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: {
      open(...args) {
        const actual = nativeOpen(...args);
        const delayed = {
          get result() { return actual.result; },
          get error() { return actual.error; },
        };
        actual.onupgradeneeded = (event) => delayed.onupgradeneeded?.(event);
        actual.onerror = (event) => delayed.onerror?.(event);
        actual.onblocked = (event) => delayed.onblocked?.(event);
        actual.onsuccess = (event) => setTimeout(() => delayed.onsuccess?.(event), delay);
        return delayed;
      },
    } });
  }, idbDelayMs);
  await page.addInitScript(() => {
    window.__phase1Vitals = { lcpMs: null, cls: 0, longTasksMs: [], eventsMs: [] };
    for (const [type, callback] of [
      ['largest-contentful-paint', (entry) => { window.__phase1Vitals.lcpMs = entry.startTime; }],
      ['layout-shift', (entry) => { if (!entry.hadRecentInput) window.__phase1Vitals.cls += entry.value; }],
      ['longtask', (entry) => window.__phase1Vitals.longTasksMs.push(entry.duration)],
      ['event', (entry) => { if (entry.interactionId) window.__phase1Vitals.eventsMs.push(entry.duration); }],
    ]) {
      try { new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({ type, buffered: true }); } catch { /* unsupported metric */ }
    }
  });
  if (process.env.PHASE1_CLIENT_DIAGNOSTICS === '1') {
    await page.addInitScript(() => { sessionStorage.setItem('__ecom_perf', '1'); });
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', (event) => {
    if (!event.request.url.startsWith(storefront.origin)) return;
    requests.set(event.requestId, { route: routeTemplate(event.request.url),
      method: event.request.method, initiator: event.initiator.type, start: event.timestamp });
  });
  cdp.on('Network.responseReceived', (event) => {
    const row = requests.get(event.requestId);
    if (row) row.status = event.response.status;
  });
  cdp.on('Network.loadingFinished', (event) => {
    const row = requests.get(event.requestId);
    if (row) { row.bytes = event.encodedDataLength; row.elapsedMs = Math.round((event.timestamp - row.start) * 1000); }
  });
  try {
    const useful = () => route.startsWith('/s/') ? page.locator('.storefront-product').first()
      : page.getByText("Today's sales", { exact: true }).first();
    if (authenticated) {
      const login = await context.request.post(`${storefront.apiOrigin}/api/v1/auth/login`, {
        data: { email: 'phase1-owner@example.com', password: 'Phase1Password123!' },
      });
      expect(login.status()).toBe(200);
    }
    if (warm) {
      await page.goto(`${storefront.origin}${route}`);
      await expect(useful()).toBeVisible();
      await page.goto(`${storefront.origin}/login`);
      requests.clear();
    }
    await page.goto(`${storefront.origin}${route}`, { waitUntil: 'domcontentloaded' });
    await expect(useful()).toBeVisible({ timeout: 20_000 });
    const usefulMs = await page.evaluate(() => performance.now());
    await page.waitForTimeout(350);
    const browserMetrics = await page.evaluate(async () => {
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const swReady = 'serviceWorker' in navigator ? await Promise.race([
        navigator.serviceWorker.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
      ]) : false;
      return { ...window.__phase1Vitals, startupMarks: performance.getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('ecom:')).map((entry) => ({ name: entry.name, ms: entry.startTime })),
        diagnostics: window.__ECOM_PERF ?? null,
        navigationMs: nav?.duration ?? null, domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
        resourceTransferBytes: resources.reduce((sum, item) => sum + item.transferSize, 0),
        swReady, swControlled: Boolean(navigator.serviceWorker?.controller),
        storageUsageBytes: (await navigator.storage.estimate())?.usage ?? null,
        heapBytes: performance.memory?.usedJSHeapSize ?? null };
    });
    const cdpMetrics = (await cdp.send('Performance.getMetrics')).metrics;
    const metric = (name) => cdpMetrics.find((row) => row.name === name)?.value ?? null;
    const network = [...requests.values()].filter((row) => row.bytes !== undefined)
      .map(({ start, ...row }) => row);
    const api = network.filter((row) => row.route.startsWith('/api/'));
    const counts = Object.groupBy(api, (row) => `${row.method} ${row.route}`);
    return { usefulMs, ...browserMetrics, taskDurationMs: metric('TaskDuration') * 1000,
      cdpHeapBytes: metric('JSHeapUsedSize'),
      apiRequests: api.length, apiBytes: api.reduce((sum, row) => sum + row.bytes, 0),
      duplicateApiRoutes: Object.entries(counts).filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, count: rows.length })),
      network };
  } finally {
    await context.close();
  }
};

test('records repeatable production-browser startup and route measurements', async ({ storefront, browser }) => {
  await storefront.seedStore('phase1-perf', { email: 'phase1-owner@example.com', password: 'Phase1Password123!' });
  const runs = {};
  for (const [name, route, options] of [
    ['publicCold', '/s/phase1-perf', {}],
    ['publicWarm', '/s/phase1-perf', { warm: true }],
    ['ownerCold', '/store/dashboard', { authenticated: true }],
  ]) {
    runs[name] = [];
    for (let index = 0; index < 5; index += 1) runs[name].push(await collect(browser, storefront, route, options));
  }
  const report = { generatedAt: new Date().toISOString(), browser: browser.browserType().name(),
    browserVersion: browser.version(),
    build: process.env.STOREFRONT_PRODUCTION === 'true' ? 'production preview' : 'Vite development',
    fixture: 'Disposable Mongo replica set, one store and one product; Chromium 1365x768 loopback, five sequential samples per condition',
    diagnosticsEnabled: process.env.PERF_DIAGNOSTICS === '1',
    idbDelayMs: Number(process.env.PHASE2_IDB_DELAY_MS || 0),
    clientDiagnosticsEnabled: process.env.PHASE1_CLIENT_DIAGNOSTICS === '1',
    summary: Object.fromEntries(Object.entries(runs).map(([name, rows]) => [name, {
      usefulP50Ms: percentile(rows.map((row) => row.usefulMs), 0.5),
      usefulP95Ms: percentile(rows.map((row) => row.usefulMs), 0.95),
      apiRequestsP50: percentile(rows.map((row) => row.apiRequests), 0.5),
      apiRequestsP95: percentile(rows.map((row) => row.apiRequests), 0.95),
    }])), raw: runs };
  const output = process.env.PHASE1_OUTPUT;
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await test.info().attach('phase1-browser-metrics', { body: JSON.stringify(report), contentType: 'application/json' });
});
