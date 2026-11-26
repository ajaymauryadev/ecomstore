import { performance } from 'node:perf_hooks';
import { logger } from '../config/logger.js';

// Constant memory; no per-user map, request bodies, URLs, IPs or background timer.
export function requestMetrics({ now = () => performance.now(), log = logger } = {}) {
  let since = now(), requests = 0, errors = 0, slow = 0, totalMs = 0, maxMs = 0;
  return (req, res, next) => {
    const started = now();
    res.once('finish', () => {
      const ended = now(), duration = ended - started;
      requests++;
      errors += Number(res.statusCode >= 500);
      slow += Number(duration >= 1000);
      totalMs += duration;
      maxMs = Math.max(maxMs, duration);
      if (ended - since < 60000) return;
      const summary = { event: 'api_summary', intervalMs: Math.round(ended - since),
        requests, errors, slow, meanMs: Math.round(totalMs / requests), maxMs: Math.round(maxMs),
        rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) };
      log[errors || slow ? 'warn' : 'info'](summary);
      since = ended; requests = 0; errors = 0; slow = 0; totalMs = 0; maxMs = 0;
    });
    next();
  };
}
