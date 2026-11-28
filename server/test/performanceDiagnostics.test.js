import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { afterEach, expect, test, vi } from 'vitest';
import { installMongoCommandTiming, performanceDiagnostics, routeTemplate } from '../src/middleware/performanceDiagnostics.js';

const previous = { enabled: process.env.PERF_DIAGNOSTICS, sampleRate: process.env.PERF_DIAGNOSTICS_SAMPLE_RATE };
afterEach(() => {
  if (previous.enabled === undefined) delete process.env.PERF_DIAGNOSTICS;
  else process.env.PERF_DIAGNOSTICS = previous.enabled;
  if (previous.sampleRate === undefined) delete process.env.PERF_DIAGNOSTICS_SAMPLE_RATE;
  else process.env.PERF_DIAGNOSTICS_SAMPLE_RATE = previous.sampleRate;
  vi.restoreAllMocks();
});

test('uses fixed route templates without query values or tenant identifiers', () => {
  expect(routeTemplate('/v1/storefront/private-store/products')).toBe('/api/v1/storefront/:slug/products');
  expect(routeTemplate('/v1/reports/profit-loss')).toBe('/api/v1/reports/*');
  expect(routeTemplate('/v1/unknown/private-store')).toBe('/api/v1/other');
});

test('opt-in timing keeps status and body intact and logs no request data', async () => {
  const client = new EventEmitter();
  const app = express();
  app.use('/api', performanceDiagnostics);
  app.get('/api/v1/storefront/private-store/products', (_req, res) => {
    client.emit('commandStarted', { connectionId: 'local', requestId: 1 });
    client.emit('commandSucceeded', { connectionId: 'local', requestId: 1, duration: 3.25 });
    res.status(200).json({ ok: true });
  });
  const path = '/api/v1/storefront/private-store/products?customerName=SensitiveValue';
  delete process.env.PERF_DIAGNOSTICS;
  const plain = await request(app).get(path);
  expect(plain.headers['x-request-id']).toBeUndefined();
  process.env.PERF_DIAGNOSTICS = '1';
  process.env.PERF_DIAGNOSTICS_SAMPLE_RATE = '1';
  installMongoCommandTiming(client);
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const measured = await request(app).get(path);
  expect(measured.status).toBe(plain.status);
  expect(measured.body).toEqual(plain.body);
  expect(measured.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  const line = info.mock.calls.map(([message]) => message).find((message) => message.includes('perf_request'));
  const logged = JSON.parse(line);
  expect(logged).toMatchObject({ method: 'GET', route: '/api/v1/storefront/:slug/products',
    status: 200, dbCommands: 1, dbDurationMs: 3.25, dbFailures: 0 });
  expect(logged.responseBytes).toBe(Buffer.byteLength(JSON.stringify(plain.body)));
  expect(line).not.toContain('private-store');
  expect(line).not.toContain('SensitiveValue');
});
