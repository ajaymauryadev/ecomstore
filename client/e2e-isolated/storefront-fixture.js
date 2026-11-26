import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, preview } from 'vite';
import { test as base } from '@playwright/test';

const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const mongoose = serverRequire('mongoose');
const { MongoMemoryReplSet } = serverRequire('mongodb-memory-server');

async function withStorefrontFixture(use, { realtime = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'smart-kirana-storefront-'));
  let mongo, api, vite, sockets;
  try {
    process.env.MONGOMS_DOWNLOAD_DIR ||= fileURLToPath(
      new URL('../../server/node_modules/.cache/mongodb-memory-server', import.meta.url)
    );
    process.env.MONGOMS_DOWNLOAD_IGNORE_MISSING_HEADER ||= 'true';
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(mongo.getUri());

    api = createHttpServer().listen(0, '127.0.0.1');
    await once(api, 'listening');
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      COOKIE_SECRET: randomBytes(32).toString('hex'),
      SMART_KIRANA_UPLOADS_ROOT: path.join(root, 'uploads'),
      VITE_API_URL: '/api/v1',
      VITE_DISABLE_WEBSOCKETS: realtime ? 'false' : 'true',
      VITE_WS_URL: '',
    });
    const apiOrigin = 'http://127.0.0.1:' + api.address().port;
    if (process.env.STOREFRONT_PRODUCTION === 'true') {
      const built = await preview({ preview: {
        host: '127.0.0.1', port: 0,
        proxy: { '/api': { target: apiOrigin, changeOrigin: true }, '/uploads': { target: apiOrigin, changeOrigin: true }, '/socket.io': { target: apiOrigin, changeOrigin: true, ws: true } },
      } });
      vite = { httpServer: built.httpServer, close: () => new Promise((resolve) => built.httpServer.close(resolve)) };
    } else {
      vite = await createViteServer({
      cacheDir: path.join(root, 'vite'),
      server: {
        host: '127.0.0.1',
        port: 0,
        proxy: { '/api': { target: apiOrigin, changeOrigin: true }, '/uploads': { target: apiOrigin, changeOrigin: true }, '/socket.io': { target: apiOrigin, changeOrigin: true, ws: true } },
      },
    });
      await vite.listen();
    }
    const origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
    process.env.CORS_ORIGINS = origin;
    const { app } = await import('../../server/src/app.js');
    api.on('request', app);
    if (realtime) {
      const { initSocket } = await import('../../server/src/config/socket.js');
      sockets = initSocket(api);
    }
    const { default: Store } = await import('../../server/src/models/Store.js');
    const { default: User } = await import('../../server/src/models/User.js');
    const { default: Product } = await import('../../server/src/models/Product.js');
    const { default: Order } = await import('../../server/src/models/Order.js');
    const { default: StockLedger } = await import('../../server/src/models/StockLedger.js');
    const { default: Coupon } = await import('../../server/src/models/Coupon.js');
    const { default: UdharCustomer } = await import('../../server/src/models/UdharCustomer.js');
    const { default: UdharEntry } = await import('../../server/src/models/UdharEntry.js');
    const { default: Supplier } = await import('../../server/src/models/Supplier.js');
    const { default: PurchaseEntry } = await import('../../server/src/models/PurchaseEntry.js');
    await Promise.all([Store.init(), Product.init(), Order.init(), StockLedger.init()]);

    const seedStore = async (slug, ownerLogin = {}) => {
      const ownerId = new mongoose.Types.ObjectId();
      const store = await Store.create({
        name: 'Pickup Test Kirana',
        slug,
        ownerId,
        orderSettings: { allowGuest: true, isAcceptingOrders: true },
      });
      await User.create({
        _id: ownerId,
        name: 'Pickup Test Owner',
        role: 'store_owner',
        tenantId: store._id,
        email: ownerLogin.email,
        password: ownerLogin.password ?? randomBytes(16).toString('hex'),
      });
      const product = await Product.create({
        tenantId: store._id,
        name: 'Pickup Test Rice',
        isOnline: true,
        variants: [{ name: '1 kg', unit: 'kg', retailPrice: 100, purchasePrice: 60, stock: 100 }],
      });
      return { store, product };
    };
    await use({ origin, apiOrigin, seedStore, Product, Order, StockLedger, Coupon, User, UdharCustomer, UdharEntry, Supplier, PurchaseEntry });
  } finally {
    try {
      await vite?.close();
    } finally {
      if (sockets) await sockets.close();
      if (api?.listening) await new Promise((resolve) => api.close(resolve));
      await mongoose.disconnect();
      try {
        await mongo?.stop();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
}

export const test = base.extend({
  storefront: [async ({}, use) => withStorefrontFixture(use), { scope: 'worker', timeout: 300_000 }],
  // Independent scenarios share a disposable API process, not an auth-attempt budget.
  // Keep the production limiter enabled within each scenario.
  authBudget: [async ({ storefront }, use) => {
    const { authLimiter } = await import('../../server/src/middleware/rateLimiter.js');
    authLimiter.resetKey(new URL(storefront.origin).hostname);
    await use();
  }, { auto: true }],
});

export const realtimeTest = base.extend({
  storefront: [async ({}, use) => withStorefrontFixture(use, { realtime: true }), { scope: 'worker', timeout: 300_000 }],
});
