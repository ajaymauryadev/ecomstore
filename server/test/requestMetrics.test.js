import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { requestMetrics } from '../src/middleware/requestMetrics.js';

test('aggregates latency and failures without logging business or authentication data', () => {
  let time = 0;
  const log = { warn: vi.fn(), info: vi.fn() };
  const metrics = requestMetrics({ now: () => time, log });
  const res = Object.assign(new EventEmitter(), { statusCode: 503 });
  metrics({ originalUrl: '/secret?token=private', body: { password: 'private' } }, res, vi.fn());
  time = 61000;
  res.emit('finish');
  expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'api_summary', requests: 1, errors: 1, slow: 1, maxMs: 61000 }));
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private');
  metrics({}, res, vi.fn());
  time = 62000;
  res.emit('finish');
  expect(log.warn).toHaveBeenCalledTimes(1);
});
