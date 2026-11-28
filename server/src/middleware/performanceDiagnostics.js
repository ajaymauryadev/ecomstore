import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requests = new AsyncLocalStorage();
const pendingCommands = new Map();
const installedClients = new WeakSet();

const enabled = () => process.env.PERF_DIAGNOSTICS === '1';
const sampleRate = () => {
  const value = Number(process.env.PERF_DIAGNOSTICS_SAMPLE_RATE ?? 100);
  return Number.isInteger(value) && value >= 1 ? value : 100;
};

export function routeTemplate(path) {
  path = path.replace(/^\/api(?=\/v1(?:\/|$))/, '');
  if (/^\/v1\/auth\/refresh\/?$/.test(path)) return '/api/v1/auth/refresh';
  if (/^\/v1\/storefront\/[^/]+\/products\/?$/.test(path)) return '/api/v1/storefront/:slug/products';
  if (/^\/v1\/storefront\/[^/]+\/sync-revision\/?$/.test(path)) return '/api/v1/storefront/:slug/sync-revision';
  if (/^\/v1\/dashboard\/?$/.test(path)) return '/api/v1/dashboard';
  if (/^\/v1\/notifications(?:\/unread-count)?\/?$/.test(path)) return path.replace(/^\/v1/, '/api/v1');
  if (/^\/v1\/sync\/revision\/?$/.test(path)) return '/api/v1/sync/revision';
  if (/^\/v1\/reports(?:\/|$)/.test(path)) return '/api/v1/reports/*';
  return '/api/v1/other';
}

export function performanceDiagnostics(req, res, next) {
  if (!enabled() || Math.floor(Math.random() * sampleRate()) !== 0) return next();
  const started = process.hrtime.bigint();
  const sample = { dbCommands: 0, dbDurationMs: 0, dbFailures: 0, commandKeys: new Set(), closed: false };
  const id = randomUUID();
  const route = routeTemplate(req.path);
  let responseBytes = 0;
  const count = (chunk, encoding) => {
    if (chunk) responseBytes += Buffer.isBuffer(chunk) ? chunk.length
      : Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8');
  };
  const write = res.write;
  const end = res.end;
  res.write = function (chunk, encoding) { count(chunk, encoding); return write.apply(this, arguments); };
  res.end = function (chunk, encoding) { count(chunk, encoding); return end.apply(this, arguments); };
  res.setHeader('X-Request-ID', id);
  res.once('finish', () => {
    sample.closed = true;
    for (const key of sample.commandKeys) pendingCommands.delete(key);
    sample.commandKeys.clear();
    console.info(JSON.stringify({ type: 'perf_request', id, method: req.method,
      route, status: res.statusCode,
      durationMs: Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(2)),
      responseBytes,
      dbCommands: sample.dbCommands, dbDurationMs: Number(sample.dbDurationMs.toFixed(2)),
      dbFailures: sample.dbFailures }));
  });
  requests.run(sample, next);
}

// Requires monitorCommands on the MongoDB client. Only timing/counts are retained.
export function installMongoCommandTiming(client) {
  if (!enabled() || !client || installedClients.has(client)) return;
  installedClients.add(client);
  const key = (event) => `${event.connectionId}:${event.requestId}`;
  client.on('commandStarted', (event) => {
    const sample = requests.getStore();
    if (sample && !sample.closed) {
      const commandKey = key(event);
      pendingCommands.set(commandKey, sample);
      sample.commandKeys.add(commandKey);
    }
  });
  const finish = (event, failed) => {
    const commandKey = key(event);
    const sample = pendingCommands.get(commandKey);
    if (!sample) return;
    pendingCommands.delete(commandKey);
    sample.commandKeys.delete(commandKey);
    sample.dbCommands += 1;
    sample.dbDurationMs += event.duration ?? 0;
    if (failed) sample.dbFailures += 1;
  };
  client.on('commandSucceeded', (event) => finish(event, false));
  client.on('commandFailed', (event) => finish(event, true));
}
