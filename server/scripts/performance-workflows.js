// Local, disposable workload only. Never loads .env or connects to a supplied URI.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.MONGOMS_DOWNLOAD_IGNORE_MISSING_HEADER = 'true';
const root = await mkdtemp(path.join(tmpdir(), 'kirana-perf-'));
let mongo, server;
try {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), IMAGE_STORAGE: 'local',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    COOKIE_SECRET: randomBytes(32).toString('hex'), SMART_KIRANA_UPLOADS_ROOT: root,
  });
  await mongoose.connect(mongo.getUri(), { monitorCommands: true, maxPoolSize: 10 });
  const { app } = await import('../src/app.js');
  if (process.env.PERF_DIAGNOSTICS === '1') {
    const { installMongoCommandTiming } = await import('../src/middleware/performanceDiagnostics.js');
    installMongoCommandTiming(mongoose.connection.getClient());
  }
  const { default: Product } = await import('../src/models/Product.js');
  const { default: Store } = await import('../src/models/Store.js');
  const { default: User } = await import('../src/models/User.js');
  const { default: Order } = await import('../src/models/Order.js');
  const { generateTokens } = await import('../src/utils/jwt.js');
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const tenantId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  await Store.create({ _id: tenantId, ownerId, name: 'Synthetic benchmark', slug: 'perf-local',
    subscription: { isActive: true, expiresAt: new Date(Date.now() + 86400000) } });
  await User.collection.insertOne({ _id: ownerId, tenantId, name: 'Synthetic owner', role: 'store_owner', isActive: true, tokenVersion: 0 });
  const owner = await User.findById(ownerId).select('+tokenVersion');
  const token = generateTokens(owner).accessToken;
  for (const tenant of [tenantId, new mongoose.Types.ObjectId()]) {
    for (let start = 0; start < 5000; start += 500) {
      await Product.collection.insertMany(Array.from({ length: 500 }, (_, j) => {
        const i = start + j;
        return { tenantId: tenant, name: `Product ${String(i).padStart(5, '0')}`, brand: 'Synthetic',
          description: 'x'.repeat(800), images: [], tags: [], isActive: true, isOnline: true,
          variants: [{ _id: new mongoose.Types.ObjectId(), name: 'Pack', unit: 'piece', isActive: true,
            stock: i % 20, lowStockLimit: 5, retailPrice: 100, purchasePrice: 60 }],
          createdAt: new Date(), updatedAt: new Date() };
      }));
    }
  }
  await Order.collection.insertMany(Array.from({ length: 200 }, (_, i) => ({
    tenantId, orderNumber: `SYNTH-${i}`, status: i % 3 === 0 ? 'accepted' : 'delivered',
    pricing: { grandTotal: 100 }, customerInfo: { name: 'Synthetic buyer' },
    createdAt: new Date(Date.now() - i * 900000), deliveredAt: new Date(Date.now() - i * 900000),
  })));
  server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = mongoose.connection.getClient();
  let commands = 0, productRows = 0, productFind;
  const started = (event) => {
    if (['find', 'aggregate', 'getMore', 'count'].includes(event.commandName)) commands++;
    if (event.commandName === 'find' && event.command.find === 'products') productFind = event.command;
  };
  const succeeded = (event) => {
    if (['find', 'getMore'].includes(event.commandName) && event.reply?.cursor?.ns?.endsWith('.products')) {
      productRows += (event.reply.cursor.firstBatch ?? event.reply.cursor.nextBatch ?? []).length;
    }
  };
  client.on('commandStarted', started);
  client.on('commandSucceeded', succeeded);
  const results = [];
  for (const route of ['/inventory/list?limit=5', '/inventory/list?limit=5&stockStatus=low_stock', '/dashboard']) {
    const call = async () => {
      const start = performance.now();
      const res = await fetch(`${origin}/api/v1${route}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      return { elapsed: performance.now() - start, body };
    };
    const warm = await call();
    commands = 0; productRows = 0; productFind = undefined;
    await call();
    const queryCommands = commands, productDocumentsTransferred = productRows;
    let plan;
    if (productFind) {
      const explain = await mongoose.connection.db.command({
        explain: Object.fromEntries(Object.entries(productFind).filter(([key]) =>
          ['find', 'filter', 'sort', 'projection', 'skip', 'limit'].includes(key))),
        verbosity: 'executionStats',
      });
      const hasSort = (node) => node && typeof node === 'object' &&
        (node.stage === 'SORT' || Object.values(node).some(hasSort));
      plan = { documentsExamined: explain.executionStats.totalDocsExamined,
        keysExamined: explain.executionStats.totalKeysExamined, returned: explain.executionStats.nReturned,
        blockingSort: Boolean(hasSort(explain.queryPlanner.winningPlan)) };
    }
    for (const concurrency of [1, 4]) {
      const samples = [];
      const cpuStart = process.cpuUsage();
      const wallStart = performance.now();
      for (let batch = 0; batch < 10; batch++) {
        const runs = await Promise.all(Array.from({ length: concurrency }, call));
        samples.push(...runs.map((run) => run.elapsed));
      }
      const elapsed = performance.now() - wallStart;
      const cpu = process.cpuUsage(cpuStart);
      samples.sort((a, b) => a - b);
      const percentile = (p) => Number(samples[Math.ceil(samples.length * p) - 1].toFixed(2));
      results.push({ route, concurrency, samples: samples.length,
        latencySamplesMs: samples.map((value) => Number(value.toFixed(2))),
        p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
        requestsPerSecond: Number((samples.length * 1000 / elapsed).toFixed(2)),
        cpuMsPerRequest: Number(((cpu.user + cpu.system) / 1000 / samples.length).toFixed(2)),
        queryCommands, productDocumentsTransferred, plan,
        responseBytes: Buffer.byteLength(JSON.stringify(warm.body)),
        total: warm.body.meta?.total, previewNames: warm.body.data?.products?.map((p) => p.name) });
    }
  }
  const report = { generatedAt: new Date().toISOString(), node: process.version,
    diagnosticsEnabled: process.env.PERF_DIAGNOSTICS === '1',
    scope: 'Disposable local MongoDB, real HTTP/auth API; 10,000 synthetic products, two tenants. Warm reads, max four concurrent users, no production traffic; not a Northflank capacity estimate. Small samples make p99 exploratory.',
    rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)), results };
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await mongoose.disconnect();
  await mongo?.stop();
  await rm(root, { recursive: true, force: true });
}
