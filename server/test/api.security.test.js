import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Return from '../src/models/Return.js';
import Category from '../src/models/Category.js';
import Expense from '../src/models/Expense.js';
import DailyClosing from '../src/models/DailyClosing.js';
import AuditLog from '../src/models/AuditLog.js';
import Notification from '../src/models/Notification.js';
import { hashGuestOrderToken } from '../src/utils/orderAccessToken.js';
import { accountingDay } from '../src/utils/accountingDay.js';
import { parseTrustedProxies } from '../src/config/trustedProxies.js';
const settleRevisionWrites = async () => (await import('../src/middleware/savedDataSync.js')).settleRevisionWrites();

const PASSWORD = 'CorrectHorse123!';
const NEW_PASSWORD = 'NewCorrectHorse456!';
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

let replSet;
let app;
let Store;
let User;
let Product;
let Coupon;
let CouponUsage;
let Order;
let StockLedger;
let UdharCustomer;
let UdharEntry;
let Supplier;
let PurchaseEntry;
let generateTokens;
let ids;
let tokens;
let ipLimiters;
let backupTestRoot;
let sourceUploads;

const createProduct = async ({ tenantId, name = 'Rice', stock = 20, retailPrice = 100, offerPrice = 90 } = {}) => {
  const product = await Product.create({
    tenantId: tenantId || ids.storeA,
    name,
    isOnline: true,
    variants: [{ name: '1 kg', unit: 'kg', retailPrice, offerPrice, purchasePrice: 60, stock, lowStockLimit: 2 }],
  });
  return { product, variant: product.variants[0] };
};

const customerInfo = (phone = '9876543210') => ({
  name: 'Guest Buyer',
  phone,
  email: 'guest@example.com',
  address: { line1: '12 Market Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
});

const orderBody = (product, variant, overrides = {}) => ({
  orderType: 'home_delivery',
  paymentMethod: 'cod',
  deliveryArea: 'Central',
  customerInfo: customerInfo(overrides.phone),
  items: [{
    productId: product._id.toString(),
    variantId: variant._id.toString(),
    quantity: overrides.quantity || 1,
    price: overrides.fakePrice ?? 0.01,
    discount: 999999,
  }],
  deliveryCharge: -100,
  couponDiscount: 999999,
  tax: -50,
  total: 0,
  ...overrides.body,
});

const getCookie = (response) => response.headers['set-cookie']?.[0]?.split(';')[0];

const fixture = async () => {
  const password = await bcrypt.hash(PASSWORD, 4);
  ids = {
    storeA: new mongoose.Types.ObjectId(),
    storeB: new mongoose.Types.ObjectId(),
    ownerA: new mongoose.Types.ObjectId(),
    ownerB: new mongoose.Types.ObjectId(),
    staff: new mongoose.Types.ObjectId(),
    discountStaff: new mongoose.Types.ObjectId(),
    packer: new mongoose.Types.ObjectId(),
    delivery: new mongoose.Types.ObjectId(),
    customerA: new mongoose.Types.ObjectId(),
    customerA2: new mongoose.Types.ObjectId(),
    customerB: new mongoose.Types.ObjectId(),
    superAdmin: new mongoose.Types.ObjectId(),
  };
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await Store.create([
    {
      _id: ids.storeA, name: 'Store Alpha', slug: 'store-alpha', ownerId: ids.ownerA,
      deliverySettings: { defaultCharge: 25, freeDeliveryAbove: 500, minOrderAmount: 50, areas: [{ name: 'Central', charge: 15, minOrder: 50 }] },
      taxSettings: { enableGST: true, cgstPercent: 5, sgstPercent: 5 },
      subscription: { isActive: true, expiresAt },
    },
    { _id: ids.storeB, name: 'Store Beta', slug: 'store-beta', ownerId: ids.ownerB, subscription: { isActive: true, expiresAt } },
  ]);
  const now = new Date();
  await User.collection.insertMany([
    { _id: ids.ownerA, name: 'Owner Alpha', email: 'owner.alpha@example.com', password, role: 'store_owner', tenantId: ids.storeA, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.ownerB, name: 'Owner Beta', email: 'owner.beta@example.com', password, role: 'store_owner', tenantId: ids.storeB, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.staff, name: 'Counter Staff', email: 'staff@example.com', password, role: 'staff', tenantId: ids.storeA, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.discountStaff, name: 'Discount Staff', email: 'discount@example.com', password, role: 'staff', tenantId: ids.storeA, permissions: ['pos.discount'], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.packer, name: 'Packer', email: 'packer@example.com', password, role: 'packer', tenantId: ids.storeA, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.delivery, name: 'Delivery', email: 'delivery@example.com', password, role: 'delivery', tenantId: ids.storeA, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.customerA, name: 'Customer One', email: 'customer.one@example.com', phone: '9876543211', password, role: 'customer', tenantId: ids.storeA, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.customerA2, name: 'Customer Two', email: 'customer.two@example.com', phone: '9876543212', password, role: 'customer', tenantId: ids.storeA, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.customerB, name: 'Customer Beta', email: 'customer.beta@example.com', phone: '9876543213', password, role: 'customer', tenantId: ids.storeB, permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
    { _id: ids.superAdmin, name: 'System Admin', email: 'admin@example.com', password, role: 'super_admin', permissions: [], isActive: true, tokenVersion: 0, createdAt: now, updatedAt: now },
  ]);
  tokens = {};
  for (const [key, id] of Object.entries(ids)) {
    if (key.startsWith('store')) continue;
    const user = await User.findById(id).select('+tokenVersion');
    tokens[key] = generateTokens(user).accessToken;
  }
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'test-access-key-which-is-long-and-independent-123456';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-key-which-is-long-and-independent-654321';
  process.env.COOKIE_SECRET = 'test-cookie-key-which-is-long-and-independent-abcdef';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.MONGOMS_DOWNLOAD_IGNORE_MISSING_HEADER = 'true';
  backupTestRoot = await mkdtemp(path.join(tmpdir(), 'smart-kirana-backup-test-'));
  sourceUploads = path.join(backupTestRoot, 'source');
  process.env.SMART_KIRANA_UPLOADS_ROOT = sourceUploads;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replSet.getUri();
  await mongoose.connect(process.env.MONGODB_URI);
  ({ app } = await import('../src/app.js'));
  const { apiLimiter, authLimiter, refreshLimiter, uploadIpLimiter, paymentProofLimiter } = await import('../src/middleware/rateLimiter.js');
  ipLimiters = [apiLimiter, authLimiter, refreshLimiter, uploadIpLimiter, paymentProofLimiter];
  ({ default: Store } = await import('../src/models/Store.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: Coupon } = await import('../src/models/Coupon.js'));
  ({ default: CouponUsage } = await import('../src/models/CouponUsage.js'));
  ({ default: Order } = await import('../src/models/Order.js'));
  ({ default: StockLedger } = await import('../src/models/StockLedger.js'));
  ({ default: UdharCustomer } = await import('../src/models/UdharCustomer.js'));
  ({ default: UdharEntry } = await import('../src/models/UdharEntry.js'));
  ({ default: Supplier } = await import('../src/models/Supplier.js'));
  ({ default: PurchaseEntry } = await import('../src/models/PurchaseEntry.js'));
  ({ generateTokens } = await import('../src/utils/jwt.js'));
  await Promise.all([Store.syncIndexes(), User.syncIndexes(), Product.syncIndexes(), Coupon.syncIndexes(), CouponUsage.syncIndexes(), Order.syncIndexes(), StockLedger.syncIndexes()]);
}, 180000);

beforeEach(async () => {
  await nextTick();
  await Promise.all(ipLimiters.flatMap((limiter) =>
    ['127.0.0.1', '::ffff:127.0.0.1'].map((ip) => limiter.resetKey(ip))));
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await mongoose.connection.db.collection('mediaassets').deleteMany({});
  await fixture();
});

afterAll(async () => {
  await settleRevisionWrites();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await mongoose.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 500));
  // mongodb-memory-server's graceful Windows shutdown treats the expected socket
  // reset from MongoDB's shutdown command as a warning. Suppress only that exact
  // teardown condition; all other warnings remain visible.
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const error = args[0];
    if (error?.name === 'MongoNetworkError' &&
        (error?.code === 'ECONNRESET' || error?.cause?.code === 'ECONNRESET')) return;
    originalWarn(...args);
  };
  try {
    await replSet?.stop();
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    console.warn = originalWarn;
    if (backupTestRoot) await rm(backupTestRoot, { recursive: true, force: true });
  }
}, 60000);

describe('Udhar addresses and storefront payment options', () => {
  test('owners can save their UPI details and invalid UPI IDs are rejected', async () => {
    await request(app).patch('/api/v1/stores/mine').set(auth(tokens.ownerA))
      .send({ paymentSettings: { upiId: '6394746719@ybl', upiName: 'Ajay Maurya' } }).expect(200);
    const mine = await request(app).get('/api/v1/stores/mine').set(auth(tokens.ownerA)).expect(200);
    expect(mine.body.data.store.paymentSettings).toMatchObject({ upiId: '6394746719@ybl', upiName: 'Ajay Maurya' });
    expect((await Store.findById(ids.storeB)).paymentSettings.upiId).toBeUndefined();
    await request(app).patch('/api/v1/stores/mine').set(auth(tokens.ownerA))
      .send({ paymentSettings: { upiId: 'invalid upi' } }).expect(400);
    expect((await Store.findById(ids.storeA)).paymentSettings.upiId).toBe('6394746719@ybl');
    await request(app).patch('/api/v1/stores/mine').set(auth(tokens.staff))
      .send({ paymentSettings: { upiId: 'staff@ybl' } }).expect(403);
  });

  test('saves, reads, updates and clears an Udhar customer address within the store', async () => {
    const created = await request(app).post('/api/v1/udhar').set(auth(tokens.ownerA))
      .send({ name: 'Address Buyer', phone: '9876543210', address: '  12 Market Road\nPune 411001  ' }).expect(201);
    const id = created.body.data.customer._id;
    expect(created.body.data.customer.address).toBe('12 Market Road\nPune 411001');
    const listed = await request(app).get('/api/v1/udhar').set(auth(tokens.ownerA)).expect(200);
    expect(listed.body.data[0].address).toBe('12 Market Road\nPune 411001');
    await request(app).put('/api/v1/udhar/' + id).set(auth(tokens.ownerB)).send({ address: 'Other store' }).expect(404);
    await request(app).put('/api/v1/udhar/' + id).set(auth(tokens.ownerA)).send({ address: 'New address' }).expect(200);
    const ledger = await request(app).get('/api/v1/udhar/' + id + '/ledger').set(auth(tokens.ownerA)).expect(200);
    expect(ledger.body.data.customer.address).toBe('New address');
    await request(app).put('/api/v1/udhar/' + id).set(auth(tokens.ownerA)).send({ address: '' }).expect(200);
    expect((await UdharCustomer.findById(id)).address).toBe('');
    await request(app).post('/api/v1/udhar').set(auth(tokens.ownerA)).send({ name: 'Too long', address: 'x'.repeat(501) }).expect(400);
  });

  test('exposes only UPI settings and returns the same recipient after ordering', async () => {
    await Store.updateOne({ _id: ids.storeA }, { $set: { paymentSettings: {
      upiId: '6394746719@ybl', upiName: 'Ajay Maurya', bankAccount: 'private-account', bankIfsc: 'private-ifsc',
    } } });
    const info = await request(app).get('/api/v1/storefront/store-alpha').expect(200);
    expect(info.body.data.store.paymentSettings).toEqual({ upiId: '6394746719@ybl', upiName: 'Ajay Maurya' });
    const { product, variant } = await createProduct();
    for (const body of [{ orderType: 'online' }, { orderType: 'wholesale' }, { paymentMethod: 'bank_transfer' }]) {
      await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA))
        .send(orderBody(product, variant, { body })).expect(400);
    }
    expect(await Order.countDocuments()).toBe(0);
    const created = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA))
      .send(orderBody(product, variant, { body: { paymentMethod: 'upi_qr' } })).expect(201);
    expect(created.body.data.paymentInfo).toEqual(info.body.data.store.paymentSettings);
    const tracking = await request(app).get('/api/v1/storefront/store-alpha/orders/' + created.body.data.order._id)
      .set(auth(tokens.customerA)).expect(200);
    expect(tracking.body.data.paymentInfo).toEqual(info.body.data.store.paymentSettings);
  });
});

describe('deployment readiness', () => {
  test('reports a reachable primary and rejects a failed dependency check', async () => {
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready' });
    expect(ready.headers['cache-control']).toBe('no-store');

    const primary = vi.spyOn(mongoose.connection.db, 'admin').mockReturnValue({
      command: async () => ({ isWritablePrimary: false, setName: 'test-replica' }),
    });
    try {
      expect((await request(app).get('/ready')).status).toBe(503);
      expect((await request(app).get('/health')).status).toBe(200);
    } finally {
      primary.mockRestore();
    }
  });
});

describe('sales and customer ledger detail', () => {
  test('keeps inactive customer dues visible and allows repayment without extending new credit', async () => {
    const account = await UdharCustomer.create({ tenantId: ids.storeA, name: 'Inactive buyer', isActive: false, balance: 90.25, creditLimit: 500 });
    const base = '/api/v1/udhar';
    const accounts = await request(app).get(base).set(auth(tokens.ownerA)).query({ hasBalance: true }).expect(200);
    expect(accounts.body.data).toEqual([expect.objectContaining({ _id: String(account._id), balance: 90.25 })]);
    const stats = await request(app).get(base + '/stats').set(auth(tokens.ownerA)).expect(200);
    expect(stats.body.data.totalDue).toBe(90.25);
    const report = await request(app).get('/api/v1/reports/sales-overview').set(auth(tokens.ownerA)).expect(200);
    expect(report.body.data.summary.outstandingUdhar).toBe(90.25);
    await request(app).post(base + '/' + account._id + '/debit').set(auth(tokens.ownerA)).send({ amount: 5 }).expect(404);
    const payment = await request(app).post(base + '/' + account._id + '/credit').set(auth(tokens.ownerA)).send({ amount: 20, method: 'cash' }).expect(201);
    expect(payment.body.data.customer.balance).toBe(70.25);
    expect(payment.body.data.customer.isActive).toBe(false);
  });

  test('reconciles sales by source with receipts, credit collections and refunds without double counting', async () => {
    const inDay = new Date('2026-11-22T06:30:00Z');
    const yesterday = new Date('2026-11-21T06:30:00Z');
    const endBoundary = new Date('2026-11-22T18:30:00Z');
    const account = await UdharCustomer.create({ tenantId: ids.storeA, name: 'Khata Buyer', phone: '9876543210', balance: 40, creditLimit: 5000 });
    const bill = (amount, extra = {}) => Order.create({
      tenantId: ids.storeA, orderType: 'counter', status: 'delivered', paymentStatus: 'paid', paymentMethod: 'counter',
      createdAt: inDay, deliveredAt: inDay, paidAt: inDay, receivedAmount: amount,
      customerInfo: customerInfo(), items: [{ name: 'Rice', quantity: 1, price: amount, mrp: amount }],
      pricing: { subtotal: amount, grandTotal: amount }, ...extra,
    });
    await bill(100.10);
    await bill(50, { paymentMethod: 'credit', paymentStatus: 'pending', paidAt: null, receivedAmount: undefined, udharCustomerId: account._id });
    await bill(200.20, { orderType: 'home_delivery', paymentMethod: 'upi_id', paidAt: yesterday });
    await bill(75, { orderType: 'home_delivery', paymentMethod: 'upi_qr', status: 'accepted', deliveredAt: undefined });
    await bill(30.30, { orderType: 'home_delivery', paymentMethod: 'cod' });
    await bill(20, { status: 'cancelled' });
    await bill(90, { orderType: 'home_delivery', paymentMethod: 'cod', paymentStatus: 'pending', paidAt: null, receivedAmount: undefined });
    await bill(10, { paidAt: null });
    await bill(999, { tenantId: ids.storeB });
    await bill(500, { paidAt: endBoundary, deliveredAt: endBoundary, createdAt: endBoundary });
    const Entry = (await import('../src/models/UdharEntry.js')).default;
    await Entry.create([
      { tenantId: ids.storeA, customerId: account._id, type: 'credit', amount: 12.34, method: 'cash', date: inDay, referenceType: 'manual' },
      { tenantId: ids.storeA, customerId: account._id, type: 'credit', amount: 5, date: inDay, referenceType: 'pos_order' },
      { tenantId: ids.storeA, customerId: account._id, type: 'credit', amount: 11, method: 'cash', date: yesterday },
      { tenantId: ids.storeB, customerId: account._id, type: 'credit', amount: 999, method: 'cash', date: inDay },
    ]);
    await Return.create({ tenantId: ids.storeA, type: 'customer_return', status: 'processed', createdBy: ids.ownerA, createdByName: 'Owner Alpha', refundMethod: 'cash', netRefund: 25, processedAt: inDay });
    const url = '/api/v1/reports/sales-overview';
    const response = await request(app).get(url).set(auth(tokens.ownerA)).query({ startDate: '2026-11-22', endDate: '2026-11-22', limit: 2 }).expect(200);
    expect(response.body.data.summary).toMatchObject({ sales: 480.60, received: 247.74, refunds: 25, netReceived: 222.74, outstandingUdhar: 40, creditSales: 50 });
    expect(response.body.data.receiptsBySource).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'pos', amount: 130.10 }),
      expect.objectContaining({ key: 'delivery', amount: 105.30 }),
      expect.objectContaining({ key: 'udhar', amount: 12.34 }),
    ]));
    expect(response.body.data.meta).toMatchObject({ total: 6, totalPages: 3, hasNextPage: true });
    expect(response.body.data.transactions).toHaveLength(2);
    const page2 = await request(app).get(url).set(auth(tokens.ownerA)).query({ startDate: '2026-11-22', page: 2, limit: 2 }).expect(200);
    expect(page2.body.data.transactions.every((row) => !response.body.data.transactions.some((first) => first._id === row._id))).toBe(true);
    await request(app).get(url).set(auth(tokens.staff)).expect(403);
    await request(app).get(url).set(auth(tokens.ownerA)).query({ startDate: '2026-11-23', endDate: '2026-11-22' }).expect(400);
  });

  test('shows Udhar purchases, line items, recorder and complete paginated balances within the store', async () => {
    const account = await UdharCustomer.create({ tenantId: ids.storeA, name: 'Khata Buyer', phone: '9876543210', creditLimit: 5000 });
    const { product, variant } = await createProduct();
    const sold = await request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send({
      paymentMethod: 'credit', udharCustomerId: account._id, customerPhone: account.phone,
      items: [{ productId: product._id, variantId: variant._id, qty: 2 }],
    }).expect(201);
    await request(app).post('/api/v1/udhar/' + account._id + '/credit').set(auth(tokens.ownerA)).send({ amount: 50, method: 'upi' }).expect(201);
    await User.updateOne({ _id: ids.staff }, { $set: { name: 'Renamed cashier' } });
    const url = '/api/v1/udhar/' + account._id + '/ledger';
    const ledger = (await request(app).get(url).set(auth(tokens.ownerA)).query({ page: 2, limit: 1 }).expect(200)).body.data;
    expect(ledger.meta).toMatchObject({ total: 2, page: 2, totalPages: 2, hasPrevPage: true, hasNextPage: false });
    expect(ledger.customer.balance).toBe(130);
    expect(ledger.summary).toMatchObject({ totalDebits: 180, totalCredits: 50 });
    expect(ledger.entries[0]).toMatchObject({ recordedByName: 'Counter Staff', recordedByRole: 'staff',
      order: { _id: sold.body.data.order._id, items: [expect.objectContaining({ name: 'Rice', quantity: 2, price: 90, total: 180 })] },
    });
    expect(ledger.entries[0].order.items[0].unitCost).toBeUndefined();
    await request(app).get(url).set(auth(tokens.ownerB)).expect(404);
    await request(app).get(url).set(auth(tokens.customerA)).expect(403);
  });
});

describe('bounded inventory reads', () => {
  test('matches the original stock filters and totals across pages without omitting archived variants', async () => {
    const categories = await Category.create([
      { tenantId: ids.storeA, name: 'Local' }, { tenantId: ids.storeB, name: 'Foreign' },
    ]);
    const products = await Product.create(Array.from({ length: 31 }, (_, index) => ({
      tenantId: ids.storeA, name: `Item ${String(Math.floor(index / 2)).padStart(2, '0')}`,
      brand: index % 2 ? 'Brand A' : 'Brand B', isActive: index !== 30,
      categoryId: categories[0]._id, description: 'Not needed in an inventory row',
      images: [{ url: '/first.webp' }, { url: '/main.webp', isMain: true }],
      variants: [
        { name: 'Active', retailPrice: 10, stock: index % 10, lowStockLimit: 3, isActive: index % 7 !== 0 },
        { name: 'Archived', retailPrice: 20, stock: 0, lowStockLimit: 2, isActive: false },
      ],
    })));
    await createProduct({ tenantId: ids.storeB, name: 'Item foreign', stock: 0 });
    const active = products.filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name) || String(a._id).localeCompare(String(b._id)));
    for (const status of ['', 'low_stock', 'out_of_stock', 'in_stock']) {
      const matching = active.filter((p) => {
        const hasLow = p.variants.some((v) => v.isActive && v.stock > 0 && v.stock <= v.lowStockLimit);
        const hasOut = p.variants.some((v) => v.isActive && v.stock <= 0);
        return status === 'low_stock' ? hasLow : status === 'out_of_stock' ? hasOut : status === 'in_stock' ? !hasLow && !hasOut : true;
      });
      const found = [];
      for (let page = 1; page <= Math.ceil(matching.length / 5); page++) {
        const response = await request(app).get('/api/v1/inventory/list').set(auth(tokens.ownerA))
          .query({ page, limit: 5, stockStatus: status });
        expect(response.status).toBe(200);
        expect(response.body.meta).toMatchObject({ total: matching.length, page, limit: 5 });
        expect(response.body.data.products.length).toBeLessThanOrEqual(5);
        for (const product of response.body.data.products) {
          expect(product.variants[1]).toMatchObject({ name: 'Archived', isActive: false, stock: 0 });
          expect(product.mainImage).toBe('/main.webp');
          expect(product.categoryId.name).toBe('Local');
          expect(product.description).toBeUndefined();
          found.push(product._id);
        }
      }
      expect(found).toEqual(matching.map((p) => String(p._id)));
    }
    const searched = await request(app).get('/api/v1/inventory/list').set(auth(tokens.ownerA))
      .query({ search: 'Brand A', categoryId: categories[0]._id.toString(), limit: 5 });
    expect(searched.body.meta.total).toBe(15);
    const escaped = await request(app).get('/api/v1/inventory/list').set(auth(tokens.ownerA)).query({ search: '.*' });
    expect(escaped.body.meta.total).toBe(0);
    const foreign = await request(app).get('/api/v1/inventory/list').set(auth(tokens.ownerA))
      .query({ categoryId: categories[1]._id.toString() });
    expect(foreign.body.meta.total).toBe(0);
  });
});

describe('owner dashboard queues', () => {
  test('preserves day boundaries, status exclusions and revenue in combined day summaries', async () => {
    const today = accountingDay(undefined, 'Asia/Kolkata');
    const yesterday = accountingDay(new Date(today.start.getTime() - 1), 'Asia/Kolkata');
    const rows = [
      { status: 'delivered', createdAt: today.start, deliveredAt: today.start, amount: 125.25 },
      { status: 'delivered', createdAt: yesterday.start, deliveredAt: yesterday.start, amount: 70.1 },
      { status: 'accepted', createdAt: today.start, amount: 999 },
      { status: 'cancelled', createdAt: today.start, amount: 999 },
      { status: 'rejected', createdAt: yesterday.start, amount: 999 },
      { status: 'delivered', createdAt: today.end, deliveredAt: today.end, amount: 999 },
      { status: 'delivered', createdAt: new Date(yesterday.start.getTime() - 1), deliveredAt: new Date(yesterday.start.getTime() - 1), amount: 999 },
    ];
    await Order.collection.insertMany(rows.map(({ amount, ...row }, i) => ({
      ...row, tenantId: ids.storeA, orderNumber: `SUMMARY-${i}`, pricing: { grandTotal: amount },
    })));
    await Order.collection.insertOne({ tenantId: ids.storeB, orderNumber: 'FOREIGN-SUMMARY', status: 'delivered', createdAt: today.start, deliveredAt: today.start, pricing: { grandTotal: 9999 } });
    const response = await request(app).get('/api/v1/dashboard').set(auth(tokens.ownerA));
    expect(response.status).toBe(200);
    expect(response.body.data.kpis).toMatchObject({ revenueToday: 125.25, revenueYesterday: 70.1,
      ordersToday: 2, ordersYesterday: 1, ordersChange: 100 });
  });

  test('counts all tenant pending orders and low-stock variants with bounded previews', async () => {
    const orders = Array.from({ length: 9 }, (_, index) => ({
      tenantId: ids.storeA, orderNumber: `OPEN-${index}`, status: 'accepted', createdAt: new Date(index),
    }));
    await Order.collection.insertMany([
      ...orders,
      { tenantId: ids.storeA, orderNumber: 'CLOSED', status: 'delivered', createdAt: new Date() },
      { tenantId: ids.storeB, orderNumber: 'FOREIGN', status: 'pending', createdAt: new Date() },
    ]);
    for (let index = 0; index < 9; index += 1) await createProduct({ name: `Low stock ${index}`, stock: 2 });
    await createProduct({ tenantId: ids.storeB, name: 'Foreign stock', stock: 0 });
    await createProduct({ name: 'Healthy stock', stock: 20 });

    const response = await request(app).get('/api/v1/dashboard').set(auth(tokens.ownerA));
    expect(response.status).toBe(200);
    expect(response.body.data.kpis).toMatchObject({ pendingOrderCount: 9, lowStockCount: 9 });
    expect(response.body.data.pendingOrders.map((order) => order.orderNumber))
      .toEqual(orders.slice(1).reverse().map((order) => order.orderNumber));
    expect(response.body.data.lowStock.map((product) => product.name))
      .toEqual(Array.from({ length: 8 }, (_, index) => `Low stock ${index}`));
  });
});

describe('API request budgets', () => {
  const read = (path, token) => request(app).get('/api/v1' + path).set(token ? auth(token) : {});

  test('cashier bills, product searches and owner polling share an IP without sharing an account budget', async () => {
    const { product, variant } = await createProduct({ stock: 100 });
    const cashier = tokens.staff;
    const owner = tokens.ownerA;
    const sell = () => request(app).post('/api/v1/pos/order').set(auth(cashier)).send({
      items: [{ productId: product._id, variantId: variant._id, qty: 1 }],
    });
    // Replay a 15-minute workload at full speed so every request hits one window.
    for (let tick = 0; tick < 30; tick += 1) {
      const polls = await Promise.all([
        read('/notifications/unread-count', owner),
        read('/notifications/unread-count', cashier),
        read('/storefront/store-alpha/admin/orders/payment-queue?limit=1', owner),
        read('/storefront/store-alpha/admin/orders/payment-queue?page=1&limit=15', owner),
        read('/packing/admin/queue?limit=1', owner),
      ]);
      expect(polls.map(({ status }) => status)).toEqual([200, 200, 200, 200, 200]);
      for (let bill = 0; bill < 2; bill += 1) {
        const searches = await Promise.all(['R', 'Ri', 'Rice'].map((term) => read('/products?search=' + term, cashier)));
        expect(searches.map(({ status }) => status)).toEqual([200, 200, 200]);
        const sale = await sell();
        expect(sale.status, JSON.stringify(sale.body)).toBe(201);
      }
    }
    expect(await Order.countDocuments({ tenantId: ids.storeA, orderType: 'counter' })).toBe(60);
  }, 30000);

  test('public exhaustion retains signed access and a separate refresh budget', async () => {
    const publicRead = () => request(app).get('/api/unmatched')
      .set('Authorization', 'Bearer invalid.jwt.value');
    for (let i = 0; i < 200; i += 1) expect((await publicRead()).status).toBe(404);
    const blocked = await publicRead().set('Origin', 'http://localhost:5173');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ rateLimitScope: 'public', retryAfterSeconds: Number(blocked.headers['retry-after']) });
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.headers['access-control-expose-headers']).toContain('Retry-After');
    expect((await read('/storefront/store-alpha/categories', tokens.customerA)).status).toBe(429);
    expect((await read('/pos/orders', tokens.staff)).status).toBe(200);
    const refresh = await request(app).post('/api/v1/auth/refresh');
    expect(refresh.status).toBe(401);
  });

  test('an account cap survives token rotation and leaves another account on the same IP available', async () => {
    const accountRead = (token) => request(app).get('/api/unmatched').set(auth(token));
    for (let i = 0; i < 240; i += 1) expect((await accountRead(tokens.staff)).status).toBe(404);
    const rotated = generateTokens(await User.findById(ids.staff).select('+tokenVersion')).accessToken;
    const denied = await accountRead(rotated);
    expect(denied.status).toBe(429);
    expect(denied.body.rateLimitScope).toBe('business');
    expect((await read('/pos/orders', tokens.ownerA)).status).toBe(200);
  }, 15000);

  test('an exhausted owner page budget keeps session, revision and new order inbox reads available', async () => {
    const { product, variant } = await createProduct();
    for (let i = 0; i < 240; i += 1) {
      expect((await request(app).get('/api/unmatched').set(auth(tokens.ownerA))).status).toBe(404);
    }
    const denied = await read('/dashboard', tokens.ownerA);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers['retry-after'])).toBeLessThanOrEqual(60);
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders')
      .set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const orderId = placed.body.data.order._id;
    const inbox = await read('/notifications?limit=20', tokens.ownerA);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'admin', type: 'new_order', isRead: false,
        data: expect.objectContaining({ orderId }) }),
    ]));
    expect((await read('/notifications/unread-count', tokens.ownerA)).body.data.count).toBe(1);
    expect((await read('/auth/me', tokens.ownerA)).status).toBe(200);
    expect((await read('/sync/revision', tokens.ownerA)).status).toBe(200);
    expect((await read('/notifications', tokens.ownerB)).body.data).toEqual([]);
  }, 15000);

  test('live reads have a bounded account budget and cannot be used to bypass anonymous limits', async () => {
    for (let i = 0; i < 120; i += 1) expect((await read('/notifications/unread-count', tokens.ownerA)).status).toBe(200);
    const denied = await read('/sync/revision', tokens.ownerA);
    expect(denied.status).toBe(429);
    expect(denied.body.rateLimitScope).toBe('business-live');
    expect((await read('/dashboard', tokens.ownerA)).status).toBe(200);
    expect((await read('/notifications/unread-count', tokens.staff)).status).toBe(200);
    for (let i = 0; i < 200; i += 1) expect((await read('/sync/revision')).status).toBe(401);
    expect((await read('/auth/me')).status).toBe(429);
  }, 15000);

  test('validates trusted proxy CIDRs and uses the nearest untrusted hop for sensitive IP budgets', async () => {
    for (const value of ['true', '1', '*', '0.0.0.0/0', '::/0', '::ffff:0.0.0.0/96', '10.0.0.1/33', 'localhost']) {
      expect(() => parseTrustedProxies(value)).toThrow('TRUSTED_PROXY_CIDRS');
    }
    const login = (forwarded) => request(app).post('/api/v1/auth/login').set('X-Forwarded-For', forwarded).send({});
    const previous = app.get('trust proxy');
    try {
      app.set('trust proxy', parseTrustedProxies(''));
      for (let i = 1; i <= 10; i += 1) expect((await login(`198.51.100.${i}`)).status).toBe(400);
      expect((await login('198.51.100.11')).status).toBe(429);

      app.set('trust proxy', parseTrustedProxies('127.0.0.1/32, 10.40.0.12/32'));
      for (let i = 1; i <= 10; i += 1) {
        expect((await login(`198.51.100.${i}, 192.0.2.42, 10.40.0.12`)).status).toBe(400);
      }
      expect((await login('198.51.100.11, 192.0.2.42, 10.40.0.12')).status).toBe(429);
      expect((await login('192.0.2.43, 10.40.0.12')).status).toBe(400);
    } finally {
      app.set('trust proxy', previous);
    }
  });

  test('catalog uploads keep a per-account cap without exhausting a second operator', async () => {
    const upload = (token) => request(app).post('/api/v1/upload/image').set(auth(token));
    for (let i = 0; i < 30; i += 1) expect((await upload(tokens.ownerA)).status).toBe(400);
    expect((await upload(tokens.ownerA)).status).toBe(429);
    expect((await upload(tokens.ownerB)).status).toBe(400);
  });

  test('password change attempts stay capped independently of ordinary account traffic', async () => {
    const change = () => request(app).patch('/api/v1/auth/update-password').set(auth(tokens.staff)).send({});
    for (let i = 0; i < 10; i += 1) expect((await change()).status).toBe(400);
    expect((await change()).status).toBe(429);
    expect((await read('/pos/orders', tokens.staff)).status).toBe(200);
  });
});

describe('authentication and authorization', () => {
  test('registers a store owner without a phone, establishes a session, and rejects a duplicate store URL', async () => {
    const registration = {
      storeName: 'Trial Kirana',
      storeSlug: 'trial-kirana',
      name: 'Trial Owner',
      email: 'trial-owner@example.com',
      password: PASSWORD,
      role: 'store_owner',
    };
    const agent = request.agent(app);
    const created = await agent.post('/api/v1/auth/register').send(registration);
    expect(created.status).toBe(201);
    expect(created.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(created.body.data.user).toMatchObject({ email: registration.email, role: 'store_owner' });
    expect(created.body.data.store).toMatchObject({
      slug: registration.storeSlug,
      ownerId: created.body.data.user._id,
    });
    const session = await agent.post('/api/v1/auth/refresh');
    expect(session.status).toBe(200);
    expect(session.body.data.user._id).toBe(created.body.data.user._id);

    const duplicate = await request(app).post('/api/v1/auth/register').send({
      ...registration,
      email: 'another-owner@example.com',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe('Store URL is already taken.');
    expect(await User.exists({ email: 'another-owner@example.com' })).toBeNull();
  });

  test('rejects invalid login without creating a session', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({
      email: 'owner.alpha@example.com',
      password: 'Wrong password',
      rememberMe: true,
    });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password.');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('rotates refresh tokens, honors remember-me, and invalidates old access tokens after password change', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'owner.alpha@example.com', password: PASSWORD, rememberMe: true });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(login.headers['set-cookie'][0]).toMatch(/Max-Age=/i);
    const oldAccess = login.body.data.accessToken;
    const oldCookie = getCookie(login);

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).not.toBe(oldAccess);
    const reused = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(reused.status).toBe(409);

    const changed = await agent.patch('/api/v1/auth/update-password').set(auth(oldAccess)).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(auth(oldAccess))).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth(changed.body.data.accessToken))).status).toBe(200);
  });

  test('old refresh token reuse revokes only that device and leaves other logins available', async () => {
    const { default: RefreshToken } = await import('../src/models/RefreshToken.js');
    const { hashToken } = await import('../src/utils/jwt.js');
    const login = () => request(app).post('/api/v1/auth/login').send({ email: 'owner.alpha@example.com', password: PASSWORD });
    const first = await login();
    const second = await login();
    const oldCookie = getCookie(first);
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(rotated.status).toBe(200);
    await RefreshToken.updateOne({ token: hashToken(oldCookie.slice('refreshToken='.length)) }, {
      rotatedAt: new Date(Date.now() - 20_000),
    });
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', getCookie(rotated))).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', getCookie(second))).status).toBe(200);
  });

  test('a deleted refresh token does not revoke a separate active login', async () => {
    const { default: RefreshToken } = await import('../src/models/RefreshToken.js');
    const { hashToken } = await import('../src/utils/jwt.js');
    const login = () => request(app).post('/api/v1/auth/login').send({ email: 'owner.alpha@example.com', password: PASSWORD });
    const first = await login();
    const second = await login();
    const cookie = getCookie(first);
    await RefreshToken.deleteOne({ token: hashToken(cookie.slice('refreshToken='.length)) });
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', getCookie(second))).status).toBe(200);
  });

  test('enforces owner, staff, packer, delivery, customer, and super-admin boundaries', async () => {
    expect((await request(app).get('/api/v1/users/staff').set(auth(tokens.ownerA))).status).toBe(200);
    expect((await request(app).get('/api/v1/expenses').set(auth(tokens.staff))).status).toBe(403);
    expect((await request(app).get('/api/v1/packing/my-orders').set(auth(tokens.packer))).status).toBe(200);
    expect((await request(app).get('/api/v1/packing/admin/queue').set(auth(tokens.packer))).status).toBe(403);
    expect((await request(app).get('/api/v1/delivery/orders').set(auth(tokens.delivery))).status).toBe(200);
    expect((await request(app).get('/api/v1/packing/my-orders').set(auth(tokens.delivery))).status).toBe(403);
    expect((await request(app).get('/api/v1/dashboard').set(auth(tokens.customerA))).status).toBe(403);
    expect((await request(app).get('/api/v1/super-admin/stats').set(auth(tokens.superAdmin))).status).toBe(200);
  });

  test('denies extra shop duties until the owner grants their permissions', async () => {
    const sensitiveRequests = [
      () => request(app).get('/api/v1/users/staff').set(auth(tokens.staff)),
      () => request(app).get('/api/v1/salary').set(auth(tokens.staff)),
      () => request(app).get('/api/v1/backup/products').set(auth(tokens.staff)),
      () => request(app).patch('/api/v1/stores/mine').set(auth(tokens.staff)).send({ name: 'Hijacked' }),
      () => request(app).get('/api/v1/coupons').set(auth(tokens.staff)),
      () => request(app).get('/api/v1/offers').set(auth(tokens.staff)),
      () => request(app).get('/api/v1/reports/profit-loss').set(auth(tokens.staff)),
      () => request(app).get('/api/v1/audit-logs').set(auth(tokens.staff)),
      () => request(app).get('/api/v1/daily-closing').set(auth(tokens.staff)),
    ];
    const responses = await Promise.all(sensitiveRequests.map((makeRequest) => makeRequest()));
    expect(responses.map((response) => response.status)).toEqual(Array(responses.length).fill(403));
  });

  test('denies cross-tenant resource access', async () => {
    const { product } = await createProduct({ tenantId: ids.storeB, name: 'Other Tenant Product' });
    const response = await request(app).get(`/api/v1/products/${product._id}`).set(auth(tokens.ownerA));
    expect(response.status).toBe(404);

    const variant = product.variants[0];
    const createdOrder = await request(app)
      .post('/api/v1/storefront/store-beta/orders').set(auth(tokens.customerB))
      .send(orderBody(product, variant, { phone: '9876543213', body: { orderType: 'self_pickup', paymentMethod: 'cash_on_pickup', deliveryArea: undefined } }));
    expect(createdOrder.status, JSON.stringify(createdOrder.body)).toBe(201);
    const adminRead = await request(app)
      .get(`/api/v1/storefront/store-beta/admin/orders/${createdOrder.body.data.order._id}`)
      .set(auth(tokens.ownerA));
    expect(adminRead.status).toBe(404);
  });
});

describe('multipart image uploads', () => {
  test('stores cloud images, protects remote proofs and includes cloud bytes in backups', async () => {
    const { imageKitClient, MEDIA_COLLECTION } = await import('../src/services/imageStorage.service.js');
    const previousProvider = process.env.IMAGE_STORAGE;
    const previousKey = process.env.IMAGEKIT_PRIVATE_KEY;
    process.env.IMAGE_STORAGE = 'imagekit';
    process.env.IMAGEKIT_PRIVATE_KEY = 'private_test_key';
    const cloud = new Map();
    const sdk = imageKitClient();
    const fakeUpload = async (params) => {
      const url = `https://ik.imagekit.io/test${params.folder}/${params.fileName}`;
      const bytes = Buffer.from(await params.file.arrayBuffer());
      cloud.set(url, bytes);
      return { fileId: params.fileName, url, filePath: params.folder + '/' + params.fileName, isPrivateFile: params.isPrivateFile };
    };
    const upload = vi.spyOn(sdk.files, 'upload').mockImplementation(fakeUpload);
    const remove = vi.spyOn(sdk.files, 'delete').mockResolvedValue(undefined);
    const originalFetch = globalThis.fetch;
    const download = vi.spyOn(globalThis, 'fetch').mockImplementation((input, options) => {
      const url = new URL(input);
      const bytes = cloud.get(url.origin + url.pathname);
      if (!bytes) return originalFetch(input, options);
      expect(url.searchParams.get('ik-s')).toBeTruthy();
      expect(url.searchParams.get('tr')).toBe('orig-true');
      return Promise.resolve(new Response(bytes));
    });
    try {
      const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#aabbcc' } }).png().toBuffer();
      const uploaded = await request(app).post('/api/v1/upload/image').set(auth(tokens.ownerA)).attach('image', png, 'front.png').expect(201);
      const imageUrl = uploaded.body.data.url;
      const image = await request(app).get(imageUrl).expect(302);
      expect(image.headers.location).toMatch(/^https:\/\/ik\.imagekit\.io\/test\//);
      const { product, variant } = await createProduct();
      await Product.updateOne({ _id: product._id }, { $set: { images: [{ url: imageUrl, isMain: true }] } });
      const publicAsset = await mongoose.connection.db.collection(MEDIA_COLLECTION).findOne({ storageKey: 'public/' + imageUrl.slice('/uploads/'.length) });
      await expect(readFile(path.join(sourceUploads, publicAsset.storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
      const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA))
        .send(orderBody(product, variant, { body: { paymentMethod: 'upi_id' } })).expect(201);
      const proofUrl = `/api/v1/storefront/store-alpha/orders/${placed.body.data.order._id}/payment/proof`;
      await request(app).post(proofUrl).set(auth(tokens.customerA)).attach('screenshot', png, 'proof.png').expect(200);
      expect(upload.mock.calls.at(-1)[0].isPrivateFile).toBe(true);
      await request(app).get(proofUrl + '/file').expect(404);
      await request(app).get(proofUrl + '/file').set(auth(tokens.customerB)).expect(404);
      const proof = await request(app).get(proofUrl + '/file').set(auth(tokens.customerA)).expect(200);
      expect(proof.headers['cache-control']).toMatch(/private.*no-store/);
      expect(proof.headers.location).toBeUndefined();
      expect(proof.body.subarray(8, 12).toString()).toBe('WEBP');
      const { captureTenantBackup } = await import('../src/services/tenantBackup.service.js');
      const backup = await captureTenantBackup(String(ids.storeA));
      expect(backup.media.some((entry) => entry.path === publicAsset.storageKey)).toBe(true);
      expect(backup.media.some((entry) => entry.path.startsWith('private/payment-proofs/'))).toBe(true);
      for (const entry of backup.media) expect(Buffer.from(entry.content, 'base64').subarray(8, 12).toString()).toBe('WEBP');
      // A failed second file must delete the first cloud upload and its mapping.
      upload.mockImplementationOnce(fakeUpload).mockRejectedValueOnce(new Error('Simulated provider outage'));
      await request(app).post('/api/v1/upload/images').set(auth(tokens.ownerA))
        .attach('images', png, 'first.png').attach('images', png, 'failed.png').expect(400);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(await mongoose.connection.db.collection(MEDIA_COLLECTION).countDocuments()).toBe(2);
      const { uploadRemoteAsset } = await import('../src/services/imageStorage.service.js');
      const missing = vi.spyOn(sdk.files, 'get').mockRejectedValue({ status: 404 });
      try {
        const repaired = await uploadRemoteAsset({
          key: publicAsset.storageKey, buffer: cloud.get(publicAsset.url),
          isPrivate: false, tenantId: ids.storeA, repairMissing: true,
        });
        expect(repaired.url).toMatch(/^https:\/\/ik\.imagekit\.io\/test\//);
        expect(missing).toHaveBeenCalledWith(publicAsset.fileId);
      } finally { missing.mockRestore(); }
      await request(app).post('/api/v1/upload/image').set(auth(tokens.ownerA)).attach('image', png, 'orphan.png').expect(201);
      await mongoose.connection.db.collection(MEDIA_COLLECTION).updateMany({}, { $set: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } });
      const { cleanupAbandonedUploads } = await import('../src/services/uploadCleanup.service.js');
      expect(await cleanupAbandonedUploads()).toBe(1);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(await mongoose.connection.db.collection(MEDIA_COLLECTION).countDocuments()).toBe(2);
    } finally {
      upload.mockRestore(); remove.mockRestore(); download.mockRestore();
      if (previousProvider === undefined) delete process.env.IMAGE_STORAGE; else process.env.IMAGE_STORAGE = previousProvider;
      if (previousKey === undefined) delete process.env.IMAGEKIT_PRIVATE_KEY; else process.env.IMAGEKIT_PRIVATE_KEY = previousKey;
    }
  });

  test('encodes catalog images and keeps payment proofs private', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#aabbcc' },
    }).png().toBuffer();
    const uploaded = await request(app).post('/api/v1/upload/images').set(auth(tokens.ownerA))
      .attach('images', png, 'front.png').attach('images', png, 'back.png');
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body.data.urls).toHaveLength(2);
    for (const url of uploaded.body.data.urls) {
      const image = await request(app).get(url);
      expect(image.status).toBe(200);
      expect(image.headers['content-type']).toMatch(/^image\/webp/);
      expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
    }

    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA))
      .send(orderBody(product, variant, { body: { paymentMethod: 'upi_id' } }));
    expect(placed.status).toBe(201);
    const { order } = placed.body.data;
    const proof = `/api/v1/storefront/store-alpha/orders/${order._id}/payment/proof`;
    const submit = await request(app).post(proof).set(auth(tokens.customerA))
      .field('utrNumber', 'TEST-TRANSFER').attach('screenshot', png, 'payment.png');
    expect(submit.status, JSON.stringify(submit.body)).toBe(200);
    expect(submit.body.data.order).toMatchObject({
      status: 'payment_submitted', paymentProof: { utrNumber: 'TEST-TRANSFER' },
    });
    expect(submit.body.data.order.paymentProof.screenshotFile).toBeUndefined();
    expect((await request(app).get(proof + '/file')).status).toBe(404);
    const privateImage = await request(app).get(proof + '/file').set(auth(tokens.customerA));
    expect(privateImage.status).toBe(200);
    expect(privateImage.headers['content-type']).toMatch(/^image\/webp/);
  });
});

describe('owner and delegated shop duties', () => {
  const createAcceptedOrder = async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA))
      .send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    await request(app).patch('/api/v1/storefront/store-alpha/admin/orders/' + order._id + '/status')
      .set(auth(tokens.ownerA)).send({ status: 'accepted' }).expect(200);
    return order;
  };

  test.each([false, true])('owner packs, verifies and delivers without switching accounts; staff started: %s', async (staffStarted) => {
    const order = await createAcceptedOrder();
    const packing = '/api/v1/packing/session/' + order._id;
    if (staffStarted) {
      await request(app).patch('/api/v1/storefront/store-alpha/admin/orders/' + order._id + '/assign')
        .set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    }
    const started = await request(app).post(packing + '/start').set(auth(staffStarted ? tokens.packer : tokens.ownerA)).expect(201);
    const session = started.body.data.session;
    const inbox = await request(app).get('/api/v1/packing/my-orders').set(auth(tokens.ownerA)).expect(200);
    expect(inbox.body.data.orders.map((entry) => entry._id)).toContain(order._id);
    await request(app).get(packing).set(auth(tokens.ownerA)).expect(200);
    const item = packing + '/item/' + session.items[0]._id;
    await request(app).patch(item).set(auth(tokens.ownerB)).send({ action: 'pick' }).expect(404);
    await request(app).patch(item).set(auth(tokens.ownerA)).send({ action: 'pick' }).expect(200);
    await request(app).patch(item).set(auth(tokens.ownerA)).send({ action: 'pack' }).expect(200);
    await request(app).post(packing + '/complete').set(auth(tokens.ownerA)).send({}).expect(200);
    await request(app).post('/api/v1/packing/admin/session/' + session._id + '/verify')
      .set(auth(tokens.ownerA)).send({ action: 'approve' }).expect(200);
    const deliveries = await request(app).get('/api/v1/delivery/orders').set(auth(tokens.ownerA)).expect(200);
    expect(deliveries.body.data.map((entry) => entry._id)).toContain(order._id);
    const delivery = '/api/v1/delivery/orders/' + order._id + '/status';
    await request(app).patch(delivery).set(auth(tokens.ownerB)).send({ status: 'delivered' }).expect(404);
    await request(app).patch(delivery).set(auth(tokens.ownerA)).send({ status: 'delivered' }).expect(200);
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('delivered');
    expect(saved.paymentStatus).toBe('paid');
    const { default: StaffActivityLog } = await import('../src/models/StaffActivityLog.js');
    expect(await StaffActivityLog.countDocuments({ orderId: order._id, action: 'item_packed', staffId: ids.ownerA })).toBe(1);
    const inboxAfter = await request(app).get('/api/v1/notifications').set(auth(tokens.ownerA)).expect(200);
    expect(inboxAfter.body.data.map((entry) => entry.type)).toEqual(expect.arrayContaining(['packing_completed', 'delivered']));
  });

  test('one employee can pack, verify and deliver with owner-granted access, and loses extra access without logout', async () => {
    const order = await createAcceptedOrder();
    const packing = '/api/v1/packing/session/' + order._id;
    const staffUrl = '/api/v1/users/staff/' + ids.staff;
    await request(app).post(packing + '/start').set(auth(tokens.staff)).expect(404);
    await request(app).get('/api/v1/delivery/orders').set(auth(tokens.staff)).expect(403);
    const permissions = ['packing.view', 'packing.perform', 'packing.manage', 'packing.verify', 'delivery.view', 'delivery.update', 'delivery.manage'];
    await request(app).patch(staffUrl).set(auth(tokens.ownerA)).send({ permissions: [...permissions, 'staff.manage'] }).expect(400);
    await request(app).patch(staffUrl).set(auth(tokens.ownerA)).send({ permissions }).expect(200);
    await request(app).patch(staffUrl).set(auth(tokens.staff)).send({ permissions: [] }).expect(403);
    const started = await request(app).post(packing + '/start').set(auth(tokens.staff)).expect(201);
    const session = started.body.data.session;
    const item = packing + '/item/' + session.items[0]._id;
    await request(app).patch(item).set(auth(tokens.staff)).send({ action: 'pick' }).expect(200);
    await request(app).patch(item).set(auth(tokens.staff)).send({ action: 'pack' }).expect(200);
    await request(app).post(packing + '/complete').set(auth(tokens.staff)).send({}).expect(200);
    const notifications = await request(app).get('/api/v1/notifications').set(auth(tokens.staff)).expect(200);
    expect(notifications.body.data.map((entry) => entry.type)).toContain('packing_completed');
    await request(app).post('/api/v1/packing/admin/session/' + session._id + '/verify')
      .set(auth(tokens.staff)).send({ action: 'approve' }).expect(200);
    await request(app).patch('/api/v1/delivery/orders/' + order._id + '/status')
      .set(auth(tokens.staff)).send({ status: 'delivered' }).expect(200);
    await request(app).patch(staffUrl).set(auth(tokens.ownerA)).send({ permissions: [] }).expect(200);
    await request(app).get('/api/v1/delivery/orders').set(auth(tokens.staff)).expect(403);
    await request(app).get('/api/v1/auth/me').set(auth(tokens.staff)).expect(200);
  });

  test.each(['staff', 'packer', 'delivery'])('supports all optional shop duties for %s while keeping audit data in its store', async (role) => {
    const { ROLE_ALLOWED_PERMISSIONS } = await import('../src/constants/permissions.js');
    const permissions = ROLE_ALLOWED_PERMISSIONS[role];
    expect(permissions.length).toBeGreaterThan(40);
    await request(app).patch('/api/v1/users/staff/' + ids[role]).set(auth(tokens.ownerA)).send({ permissions }).expect(200);
    await AuditLog.create([
      { tenantId: ids.storeA, action: 'staff_action', description: 'Local event' },
      { tenantId: ids.storeB, action: 'staff_action', description: 'Foreign event' },
    ]);
    const response = await request(app).get('/api/v1/audit-logs?tenantId=' + ids.storeB).set(auth(tokens[role])).expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((entry) => entry.tenantId === String(ids.storeA))).toBe(true);
    await request(app).get('/api/v1/delivery/orders').set(auth(tokens[role])).expect(200);
    await request(app).get('/api/v1/packing/my-orders').set(auth(tokens[role])).expect(200);
    await request(app).get('/api/v1/super-admin/stats').set(auth(tokens[role])).expect(403);
  });
});

describe('customer delivery journey', () => {
  test('tracks one order through assigned packing, dispatch and COD settlement', async () => {
    const { product, variant } = await createProduct();
    const storefront = '/api/v1/storefront/store-alpha';
    const placed = await request(app).post(storefront + '/orders').set(auth(tokens.customerA)).send(orderBody(product, variant));
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const { order } = placed.body.data;
    const ownerOrder = storefront + '/admin/orders/' + order._id;
    const packing = '/api/v1/packing/session/' + order._id;
    const track = () => request(app).get(storefront + '/orders/' + order._id)
      .set(auth(tokens.customerA));
    expect((await track()).body.data?.order.status).toBe('pending');

    await request(app).patch(ownerOrder + '/status').set(auth(tokens.ownerA)).send({ status: 'accepted' }).expect(200);
    await request(app).post(packing + '/start').set(auth(tokens.packer)).expect(404);
    await request(app).patch(ownerOrder + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    const started = await request(app).post(packing + '/start').set(auth(tokens.packer)).expect(201);
    const session = started.body.data.session;
    const item = packing + '/item/' + session.items[0]._id;
    await request(app).patch(item).set(auth(tokens.packer)).send({ action: 'pick' }).expect(200);
    await request(app).patch(item).set(auth(tokens.packer)).send({ action: 'pack' }).expect(200);
    await request(app).post(packing + '/complete').set(auth(tokens.packer)).send({}).expect(200);
    await request(app).post('/api/v1/packing/admin/session/' + session._id + '/verify')
      .set(auth(tokens.ownerA)).send({ action: 'approve' }).expect(200);
    expect((await track()).body.data?.order.status).toBe('out_for_delivery');

    const deliver = () => request(app).patch('/api/v1/delivery/orders/' + order._id + '/status')
      .set(auth(tokens.delivery)).send({ status: 'delivered' });
    await deliver().expect(404);
    await request(app).patch(ownerOrder + '/assign-delivery').set(auth(tokens.ownerA))
      .send({ deliveryId: ids.delivery }).expect(200);
    await deliver().expect(200);
    await deliver().expect(200);
    const tracked = await track().expect(200);
    expect(tracked.body.data.order).toMatchObject({ status: 'delivered', paymentStatus: 'paid' });
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(19);
    expect(await StockLedger.countDocuments({ referenceId: order._id, movementType: 'ORDER_RESERVED' })).toBe(1);
  });
});

describe('Socket.IO transport and tenant delivery', () => {
  test.each(['polling', 'websocket'])('authenticates and delivers POS events over %s', async (transport) => {
    const { initSocket, emitToTenant } = await import('../src/config/socket.js');
    const server = createServer(app);
    const io = initSocket(server);
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const url = `http://127.0.0.1:${server.address().port}`;
    const client = (token) => connectSocket(url, {
      auth: token ? { token } : undefined,
      transports: [transport], autoConnect: false, reconnection: false, timeout: 3000,
    });
    const [owner, foreign, guest] = [client(tokens.ownerA), client(tokens.ownerB), client()];
    const nextEvent = (socket, event) => once(socket, event, { signal: AbortSignal.timeout(3000) });
    try {
      const ready = Promise.all([
        nextEvent(owner, 'connect'), nextEvent(foreign, 'connect'), nextEvent(guest, 'connect_error'),
      ]);
      for (const socket of [owner, foreign, guest]) socket.connect();
      const [, , [rejection]] = await ready;
      expect(rejection.message).toBe('Authentication required');

      const foreignEvent = vi.fn();
      foreign.on('order:new', foreignEvent);
      const { product, variant } = await createProduct();
      const delivered = nextEvent(owner, 'order:new');
      const sale = await request(server).post('/api/v1/pos/order').set(auth(tokens.staff))
        .send({ items: [{ productId: product._id, variantId: variant._id, qty: 1 }] });
      expect(sale.status).toBe(201);
      expect((await delivered)[0]).toMatchObject({ orderId: sale.body.data.order._id, orderType: 'counter' });

      const marker = nextEvent(foreign, 'test:delivery-marker');
      emitToTenant(ids.storeB, 'test:delivery-marker', true);
      expect(await marker).toEqual([true]);
      expect(foreignEvent).not.toHaveBeenCalled();
    } finally {
      for (const socket of [owner, foreign, guest]) socket.disconnect();
      await io.close();
    }
  });
});

describe('assignment inboxes and pending work', () => {
  test.each(['delivery', 'ownerA'])('records actual delivery work by %s separately from assignments and keeps history private', async (actor) => {
    const { product, variant } = await createProduct();
    const root = '/api/v1/storefront/store-alpha';
    const placed = await request(app).post(root + '/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const orderId = placed.body.data.order._id;
    const adminOrder = root + '/admin/orders/' + orderId;
    await request(app).patch(adminOrder + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    await request(app).patch(adminOrder + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids.staff }).expect(200);
    await request(app).patch(adminOrder + '/assign-delivery').set(auth(tokens.ownerA)).send({ deliveryId: ids.delivery }).expect(200);
    for (const status of ['accepted', 'packing', 'packed']) {
      await request(app).patch(adminOrder + '/status').set(auth(tokens.ownerA)).send({ status }).expect(200);
    }
    const deliveryUrl = '/api/v1/delivery/orders/' + orderId + '/status';
    await request(app).patch(deliveryUrl).set(auth(tokens.staff)).send({ status: 'delivered' }).expect(403);
    for (const status of ['out_for_delivery', 'delivered', 'delivered']) {
      await request(app).patch(deliveryUrl).set(auth(tokens[actor])).send({ status }).expect(200);
    }
    const detail = (await request(app).get(adminOrder).set(auth(tokens.ownerA)).expect(200)).body.data.order;
    expect(detail.fulfillment).toMatchObject({
      packingAssignedTo: { userId: String(ids.staff), name: 'Counter Staff' },
      packingAssignedBy: { userId: String(ids.ownerA), name: 'Owner Alpha' },
      packingCompletedBy: { userId: String(ids.ownerA), role: 'store_owner' },
      deliveryAssignedTo: { userId: String(ids.delivery), name: 'Delivery' },
      deliveryStartedBy: { userId: String(ids[actor]) },
      deliveredBy: { userId: String(ids[actor]), role: actor === 'ownerA' ? 'store_owner' : 'delivery' },
    });
    expect(detail.fulfillment.deliveredBy.at).toBeTruthy();
    expect(detail.timeline.filter((entry) => entry.action === 'delivery_completed')).toHaveLength(1);
    expect(detail.timeline.find((entry) => entry.previousAssignee)).toMatchObject({
      performedBy: { name: 'Owner Alpha' }, previousAssignee: { name: 'Packer' }, assignee: { name: 'Counter Staff' },
    });
    const activity = await request(app).get('/api/v1/packing/admin/activity?action=delivery_completed').set(auth(tokens.ownerA)).expect(200);
    expect(activity.body.data).toHaveLength(1);
    expect(activity.body.data[0].staffId).toBe(String(ids[actor]));
    await User.updateOne({ _id: ids[actor] }, { $set: { name: 'Renamed account' } });
    expect((await Order.findById(orderId)).fulfillment.deliveredBy.name).toBe(actor === 'ownerA' ? 'Owner Alpha' : 'Delivery');
    const customer = (await request(app).get(root + '/orders/' + orderId).set(auth(tokens.customerA)).expect(200)).body.data.order;
    expect(customer.fulfillment).toBeUndefined();
    expect(customer.timeline.every((entry) => !entry.performedBy && !entry.assignee && !entry.previousAssignee)).toBe(true);
  });

  test('lets an owner assign work to themselves and records unassigned owner delivery work', async () => {
    const { product, variant } = await createProduct();
    const root = '/api/v1/storefront/store-alpha';
    const placed = await request(app).post(root + '/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const orderId = placed.body.data.order._id;
    const adminOrder = root + '/admin/orders/' + orderId;
    const assigned = await request(app).patch(adminOrder + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids.ownerA }).expect(200);
    expect(assigned.body.data.order.fulfillment.packingAssignedTo).toMatchObject({ name: 'Owner Alpha', role: 'store_owner' });
    await request(app).patch(adminOrder + '/assign-delivery').set(auth(tokens.ownerA)).send({ deliveryId: ids.ownerA }).expect(200);
    await request(app).patch(adminOrder + '/assign-delivery').set(auth(tokens.ownerA)).send({ deliveryId: null }).expect(200);
    await Order.updateOne({ _id: orderId }, { $set: { status: 'packed' } });
    await request(app).patch('/api/v1/delivery/orders/' + orderId + '/status').set(auth(tokens.ownerA)).send({ status: 'out_for_delivery' }).expect(200);
    const finished = await request(app).patch('/api/v1/delivery/orders/' + orderId + '/status').set(auth(tokens.ownerA)).send({ status: 'delivered' }).expect(200);
    expect(finished.body.data.order.fulfillment.deliveredBy).toMatchObject({ name: 'Owner Alpha', role: 'store_owner' });
    expect(finished.body.data.order.deliveryAssignedTo).toBeNull();
  });

  test('live admin notifications stay in the owner role and personal assignments reach only their recipient', async () => {
    const { initSocket, emitToTenant } = await import('../src/config/socket.js');
    const { notifyAdmin, notifyStaff } = await import('../src/services/notification.service.js');
    const server = createServer(app);
    const io = initSocket(server);
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const clients = ['ownerA', 'packer', 'delivery', 'customerA', 'ownerB'].map((key) => connectSocket(`http://127.0.0.1:${server.address().port}`, {
      auth: { token: tokens[key] }, transports: ['websocket'], autoConnect: false, reconnection: false,
    }));
    const nextEvent = (client, event) => once(client, event, { signal: AbortSignal.timeout(3000) });
    try {
      const ready = clients.map((client) => nextEvent(client, 'connect'));
      clients.forEach((client) => client.connect());
      await Promise.all(ready);
      const received = clients.map(() => vi.fn());
      clients.forEach((client, index) => client.on('notification:new', received[index]));
      const adminEvent = nextEvent(clients[0], 'notification:new');
      await notifyAdmin(ids.storeA, 'low_stock', 'Private owner stock alert');
      expect((await adminEvent)[0].notification.title).toBe('Private owner stock alert');
      const personalEvent = nextEvent(clients[1], 'notification:new');
      await notifyStaff(ids.storeA, ids.packer, 'order_assigned', 'Assigned to packer');
      expect((await personalEvent)[0].notification.title).toBe('Assigned to packer');
      const markers = clients.map((client) => nextEvent(client, 'test:notification-marker'));
      emitToTenant(ids.storeA, 'test:notification-marker', true);
      emitToTenant(ids.storeB, 'test:notification-marker', true);
      await Promise.all(markers);
      expect(received.map((listener) => listener.mock.calls.length)).toEqual([1, 1, 0, 0, 0]);
    } finally {
      clients.forEach((client) => client.disconnect());
      await io.close();
    }
  });

  test.each(['staff', 'packer'])('lets the assigned %s accept a pending cash order without granting general order access', async (role) => {
    const { product, variant } = await createProduct();
    const root = '/api/v1/storefront/store-alpha';
    const placed = await request(app).post(root + '/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    const endpoint = '/api/v1/packing/orders/' + order._id + '/accept';
    await request(app).post(endpoint).set(auth(tokens[role])).expect(404);
    await request(app).post(endpoint).set(auth(tokens.ownerB)).expect(404);
    await request(app).post(endpoint).set(auth(tokens.delivery)).expect(403);
    await request(app).post(endpoint).set(auth(tokens.customerA)).expect(403);
    await request(app).patch(root + '/admin/orders/' + order._id + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids[role] }).expect(200);
    const responses = await Promise.all([1, 2].map(() => request(app).post(endpoint).set(auth(tokens[role]))));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('accepted');
    expect(saved.paymentStatus).toBe('pending');
    const actions = saved.timeline.filter((entry) => entry.action === 'order_accepted');
    expect(actions).toHaveLength(1);
    expect(String(actions[0].performedBy.userId)).toBe(String(ids[role]));
    await request(app).patch(root + '/admin/orders/' + order._id + '/status').set(auth(tokens[role])).send({ status: 'packed' }).expect(403);
    await request(app).post('/api/v1/packing/session/' + order._id + '/start').set(auth(tokens[role])).expect(201);
    await request(app).post(endpoint).set(auth(tokens[role])).expect(409);
  });

  test('packing acceptance preserves payment checks and lets the owner accept unassigned cash orders', async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    const endpoint = '/api/v1/packing/orders/' + order._id + '/accept';
    for (const status of ['payment_pending', 'payment_submitted']) {
      await Order.updateOne({ _id: order._id }, { $set: { status, assignedTo: ids.packer } });
      await request(app).post(endpoint).set(auth(tokens.packer)).expect(409);
      expect((await Order.findById(order._id)).status).toBe(status);
    }
    await Order.updateOne({ _id: order._id }, { $set: { status: 'pending', paymentMethod: 'upi_qr' } });
    await request(app).post(endpoint).set(auth(tokens.packer)).expect(409);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'payment_verified', paymentStatus: 'paid' } });
    await request(app).post(endpoint).set(auth(tokens.packer)).expect(200);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'pending', paymentMethod: 'cod', paymentStatus: 'pending' }, $unset: { assignedTo: 1 } });
    await request(app).post(endpoint).set(auth(tokens.ownerA)).expect(200);
    expect((await Order.findById(order._id)).status).toBe('accepted');
  });

  test('keeps pending packing assignments visible, notifies every worker, and prevents premature packing', async () => {
    const { product, variant } = await createProduct();
    const root = '/api/v1/storefront/store-alpha';
    const placed = await request(app).post(root + '/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    const assignment = root + '/admin/orders/' + order._id + '/assign';
    const mine = (token) => request(app).get('/api/v1/packing/my-orders').set(auth(token));
    for (const key of ['ownerA', 'staff', 'discountStaff', 'packer', 'delivery']) {
      const inbox = await request(app).get('/api/v1/notifications').set(auth(tokens[key])).expect(200);
      expect(inbox.body.data).toHaveLength(1);
      expect(inbox.body.data[0]).toMatchObject({ type: 'new_order', data: { orderId: order._id } });
    }
    await request(app).patch(assignment).set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    await request(app).patch(assignment).set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    const pending = await mine(tokens.packer).expect(200);
    expect(pending.body.data.orders).toHaveLength(1);
    expect(pending.body.data.orders[0]).toMatchObject({ _id: order._id, status: 'pending' });
    expect(pending.body.data.orders[0].items[0].purchasePrice).toBeUndefined();
    const dashboard = await request(app).get('/api/v1/dashboard').set(auth(tokens.packer)).expect(200);
    expect(dashboard.body.data.stats.assignedOrders).toBe(1);
    await request(app).post('/api/v1/packing/session/' + order._id + '/start').set(auth(tokens.packer)).expect(409);
    const inbox = await request(app).get('/api/v1/notifications').set(auth(tokens.packer)).expect(200);
    expect(inbox.body.data.filter((notification) => notification.type === 'order_assigned')).toHaveLength(1);

    await request(app).patch(assignment).set(auth(tokens.ownerA)).send({ staffId: ids.staff }).expect(200);
    expect((await mine(tokens.packer)).body.data.orders).toHaveLength(0);
    expect((await mine(tokens.staff)).body.data.orders).toHaveLength(1);
    await request(app).patch(root + '/admin/orders/' + order._id + '/status').set(auth(tokens.ownerA)).send({ status: 'accepted' }).expect(200);
    await request(app).post('/api/v1/packing/session/' + order._id + '/start').set(auth(tokens.staff)).expect(201);
    await request(app).patch(assignment).set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(409);
    expect(String((await Order.findById(order._id)).assignedTo)).toBe(String(ids.staff));
  });

  test('delivery assignment is visible before packing and recipient read state is isolated from other users and tenants', async () => {
    const { product, variant } = await createProduct();
    const root = '/api/v1/storefront/store-alpha';
    const placed = await request(app).post(root + '/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    await request(app).patch(root + '/admin/orders/' + order._id + '/assign-delivery').set(auth(tokens.ownerA)).send({ deliveryId: ids.delivery }).expect(200);
    const assigned = await request(app).get('/api/v1/delivery/orders').set(auth(tokens.delivery)).expect(200);
    expect(assigned.body.data).toHaveLength(1);
    expect(assigned.body.data[0]).toMatchObject({ _id: order._id, status: 'pending' });
    await request(app).patch('/api/v1/delivery/orders/' + order._id + '/status').set(auth(tokens.delivery)).send({ status: 'out_for_delivery' }).expect(409);
    const inbox = await request(app).get('/api/v1/notifications').set(auth(tokens.delivery)).expect(200);
    const personal = inbox.body.data.find((notification) => notification.type === 'order_assigned');
    expect(personal).toBeTruthy();
    await request(app).post('/api/v1/notifications/mark-all-read').set(auth(tokens.ownerA)).expect(200);
    await request(app).patch('/api/v1/notifications/' + personal._id + '/read').set(auth(tokens.staff)).expect(200);
    await request(app).patch('/api/v1/notifications/' + personal._id + '/read').set(auth(tokens.ownerB)).expect(200);
    const count = await request(app).get('/api/v1/notifications/unread-count').set(auth(tokens.delivery)).expect(200);
    expect(count.body.data.count).toBe(2);
    const foreign = await request(app).get('/api/v1/notifications').set(auth(tokens.ownerB)).expect(200);
    expect(foreign.body.data).toHaveLength(0);
    await request(app).patch('/api/v1/notifications/' + personal._id + '/read').set(auth(tokens.delivery)).expect(200);
    expect((await request(app).get('/api/v1/notifications/unread-count').set(auth(tokens.delivery))).body.data.count).toBe(1);
  });
});

describe('customer and guest order privacy', () => {
  test('requires a strong token for legacy guest orders and keeps internal fields private', async () => {
    const { product, variant } = await createProduct();
    const created = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { quantity: 2 }));
    expect(created.status).toBe(201);
    const { order } = created.body.data;
    const guestAccessToken = randomBytes(32).toString('base64url');
    await Order.updateOne({ _id: order._id }, {
      $unset: { customerId: 1 },
      $set: { guestAccessTokenHash: hashGuestOrderToken(guestAccessToken), guestAccessTokenCreatedAt: new Date() },
    });
    expect(order.guestAccessTokenHash).toBeUndefined();
    expect(order.assignedTo).toBeUndefined();
    expect(order.stockReservationState).toBeUndefined();

    const url = `/api/v1/storefront/store-alpha/orders/${order._id}`;
    expect((await request(app).get(url)).status).toBe(404);
    expect((await request(app).get(url).set('x-order-access-token', 'x'.repeat(64))).status).toBe(404);
    expect((await request(app).get(url).set(auth(tokens.customerA))).status).toBe(404);
    const allowed = await request(app).get(url).set('X-Order-Access-Token', guestAccessToken);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.order.guestAccessTokenHash).toBeUndefined();
    expect((await request(app).get(`/api/v1/storefront/store-beta/orders/${order._id}`).set('X-Order-Access-Token', guestAccessToken)).status).toBe(404);
  });

  test('requires a customer account from this store to place an order', async () => {
    const { product, variant } = await createProduct();
    const endpoint = '/api/v1/storefront/store-alpha/orders';
    const payload = orderBody(product, variant);
    await request(app).post(endpoint).send(payload).expect(401);
    await request(app).post(endpoint).set(auth(tokens.ownerA)).send(payload).expect(403);
    await request(app).post(endpoint).set(auth(tokens.customerB)).send(payload).expect(403);
    expect(await Order.countDocuments()).toBe(0);
  });

  test('limits authenticated customers to their own store-scoped orders', async () => {
    const { product, variant } = await createProduct();
    const created = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { phone: '9876543211' }));
    expect(created.status).toBe(201);
    const url = `/api/v1/storefront/store-alpha/orders/${created.body.data.order._id}`;
    expect((await request(app).get(url).set(auth(tokens.customerA))).status).toBe(200);
    const history = await request(app).get('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA));
    expect(history.status).toBe(200);
    expect(history.body.data[0].items[0].unitCost).toBeUndefined();
    expect((await request(app).get(url).set(auth(tokens.customerA2))).status).toBe(404);
    expect((await request(app).get(url).set(auth(tokens.customerB))).status).toBe(404);
  });

  test('rejects forged upload content before storage and validates order ownership first', async () => {
    const { product, variant } = await createProduct();
    const created = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { body: { paymentMethod: 'upi_id' } }));
    const { order } = created.body.data;
    const url = `/api/v1/storefront/store-alpha/orders/${order._id}/payment/proof`;
    expect((await request(app).post(url).attach('screenshot', Buffer.from('#!/bin/sh\necho unsafe'), { filename: 'proof.png', contentType: 'image/png' })).status).toBe(404);
    const forged = await request(app).post(url).set(auth(tokens.customerA)).attach('screenshot', Buffer.from('#!/bin/sh\necho unsafe'), { filename: 'proof.png', contentType: 'image/png' });
    expect(forged.status).toBe(400);
    expect(forged.body.message).toMatch(/signature/i);
  });
});

describe('server-authoritative checkout, coupons, stock, and rollback', () => {
  test('cart refresh returns current sellable variants for the selected store only', async () => {
    const { product, variant } = await createProduct({ stock: 3, retailPrice: 110, offerPrice: 95 });
    const { product: foreign } = await createProduct({ tenantId: ids.storeB });
    const { product: offline } = await createProduct();
    await Product.updateOne({ _id: offline._id }, { $set: { isOnline: false } });
    product.variants.push({ name: 'Outdated', unit: 'kg', retailPrice: 75, stock: 1, isActive: false });
    await product.save();

    const endpoint = '/api/v1/storefront/store-alpha/cart/products';
    const response = await request(app).post(endpoint).send({
      productIds: [product._id, foreign._id, offline._id],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.products).toEqual([{
      _id: String(product._id),
      name: product.name,
      mainImage: null,
      variants: [{
        _id: String(variant._id), name: variant.name, unit: variant.unit, stock: 3, retailPrice: 110, offerPrice: 95,
      }],
    }]);
    expect((await request(app).post(endpoint).send({ productIds: ['invalid'] })).status).toBe(400);
  });

  test('ignores manipulated client money and applies variant, area, tax, and decimal-safe totals', async () => {
    const { product, variant } = await createProduct();
    const response = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { quantity: 2, fakePrice: 0.01 }));
    expect(response.status).toBe(201);
    expect(response.body.data.order.items[0].price).toBe(90);
    expect(response.body.data.order.pricing).toEqual({ subtotal: 180, couponDiscount: 0, deliveryCharge: 15, tax: 18, grandTotal: 213 });
  });

  test('enforces coupon applicability, total usage, per-customer usage, and rolls back losing transactions', async () => {
    const { product, variant } = await createProduct({ stock: 10 });
    await Coupon.create({ tenantId: ids.storeA, code: 'ONLYONE', type: 'percent', value: 10, minOrderValue: 50, usageLimitTotal: 1, usageLimitPerUser: 1, applicableOrderTypes: ['home_delivery'] });
    const make = (token) => request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(token)).send(orderBody(product, variant, { body: { couponCode: 'ONLYONE' } }));
    const results = await Promise.all([make(tokens.customerA), make(tokens.customerA2)]);
    const statuses = results.map((result) => result.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => [400, 409].includes(status))).toHaveLength(1);
    expect((await Coupon.findOne({ code: 'ONLYONE' })).usedCount).toBe(1);
    expect(await CouponUsage.countDocuments()).toBe(1);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(9);
    expect(await Order.countDocuments({ couponCode: 'ONLYONE' })).toBe(1);

    await Coupon.create({ tenantId: ids.storeA, code: 'ONCEPER', type: 'flat', value: 10, usageLimitTotal: 10, usageLimitPerUser: 1, applicableOrderTypes: ['home_delivery'] });
    const first = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { phone: '9876543233', body: { couponCode: 'ONCEPER' } }));
    const second = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { phone: '9876543233', body: { couponCode: 'ONCEPER' } }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect((await Coupon.findOne({ code: 'ONCEPER' })).usedCount).toBe(1);
  });

  test('atomically prevents concurrent overselling', async () => {
    const { product, variant } = await createProduct({ stock: 1 });
    const make = (token) => request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(token)).send(orderBody(product, variant));
    const results = await Promise.all([make(tokens.customerA), make(tokens.customerA2)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(0);
    expect(await Order.countDocuments({ 'items.productId': product._id })).toBe(1);
  });

  test('restores cancelled stock exactly once', async () => {
    const { product, variant } = await createProduct({ stock: 5 });
    const created = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { quantity: 2 }));
    const { order } = created.body.data;
    const url = `/api/v1/storefront/store-alpha/orders/${order._id}/cancel`;
    expect((await request(app).post(url).set(auth(tokens.customerA)).send({ reason: 'Changed mind' })).status).toBe(200);
    expect((await request(app).post(url).set(auth(tokens.customerA)).send({ reason: 'Again' })).status).toBe(200);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(5);
    expect(await StockLedger.countDocuments({ referenceId: order._id, movementType: 'ORDER_CANCEL_RESTORE' })).toBe(1);
  });
});

describe('category hierarchy and deletion', () => {
  const owner = (method, endpoint) => request(app)[method]('/api/v1' + endpoint).set(auth(tokens.ownerA));
  const create = async (name, parentId) => {
    const response = await owner('post', '/categories').send({ name, parentId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.category;
  };
  const edit = (category, updates) => owner('put', '/categories/' + category._id).send(updates);
  const remove = (category) => owner('delete', '/categories/' + category._id);
  const list = async () => (await owner('get', '/categories')).body.data.categories;
  const productBody = (categoryId) => ({
    name: 'Mapped product', categoryId, variants: [{ name: 'Single', retailPrice: 100 }],
  });

  test('preserves archived children and inactive products, then deletes after explicit moves', async () => {
    const parent = await create('Parent');
    const child = await create('Child', parent._id);
    const replacement = await create('Replacement');
    const productResponse = await owner('post', '/products').send({ ...productBody(parent._id), isActive: false });
    expect(productResponse.status).toBe(201);
    const product = productResponse.body.data.product;
    expect((await edit(child, { isActive: false })).status).toBe(200);

    expect(await list()).toContainEqual(expect.objectContaining({
      _id: parent._id, productCount: 0, productReferenceCount: 1, childCount: 1,
    }));
    expect((await remove(parent)).status).toBe(409);
    expect((await edit(parent, { isActive: false })).status).toBe(200);
    expect((await Category.findById(child._id)).parentId.toString()).toBe(parent._id);
    expect((await Product.findById(product._id)).categoryId.toString()).toBe(parent._id);
    const publicList = await request(app).get('/api/v1/storefront/store-alpha/categories');
    expect(publicList.body.data.categories.map((category) => category._id)).toEqual([replacement._id]);

    expect((await edit(child, { parentId: replacement._id })).status).toBe(200);
    expect((await remove(parent)).status).toBe(409);
    expect((await owner('put', '/products/' + product._id).send({ categoryId: null })).status).toBe(200);
    expect((await remove(parent)).status).toBe(200);
    expect(await Category.findById(parent._id)).toBeNull();
    expect((await Category.findById(child._id)).parentId.toString()).toBe(replacement._id);
  });

  test('checks tenant and ancestry on both create and edit', async () => {
    const root = await create('Root');
    const child = await create('Child', root._id.toUpperCase());
    const grandchild = await create('Grandchild', child._id);
    const foreign = await Category.create({ tenantId: ids.storeB, name: 'Foreign' });
    const missing = new mongoose.Types.ObjectId();
    for (const parentId of [foreign._id, missing]) {
      expect((await owner('post', '/categories').send({ name: 'Invalid', parentId })).status).toBe(400);
      expect((await edit(root, { parentId })).status).toBe(400);
    }
    expect((await edit(root, { parentId: root._id })).status).toBe(409);
    expect((await edit(root, { parentId: grandchild._id })).status).toBe(409);
    expect((await remove(root)).status).toBe(409);
    expect((await Category.findById(root._id)).parentId).toBeNull();
  });

  test('flags legacy missing, cross-tenant and cyclic hierarchies and permits explicit repair', async () => {
    const foreign = await Category.create({ tenantId: ids.storeB, name: 'Foreign' });
    const root = await create('Good root');
    const orphan = await Category.create({ tenantId: ids.storeA, name: 'Orphan', parentId: new mongoose.Types.ObjectId() });
    const foreignChild = await Category.create({ tenantId: ids.storeA, name: 'Foreign child', parentId: foreign._id });
    const first = await create('First');
    const second = await create('Second', first._id);
    await Category.updateOne({ _id: first._id }, { $set: { parentId: second._id } });

    const statuses = new Map((await list()).map((category) => [category.name, category.parentStatus]));
    expect(statuses).toEqual(new Map([
      ['Foreign child', 'missing'], ['Orphan', 'missing'], ['First', 'cycle'], ['Second', 'cycle'], ['Good root', 'valid'],
    ]));
    expect((await edit(root, { parentId: orphan._id })).status).toBe(400);
    expect((await edit(root, { parentId: second._id })).status).toBe(409);
    expect((await edit(orphan, { parentId: root._id })).status).toBe(200);
    expect((await edit(foreignChild, { parentId: null })).status).toBe(200);
    expect((await edit(first, { parentId: null })).status).toBe(200);
    expect((await list()).every((category) => category.parentStatus === 'valid')).toBe(true);
  });

  test('concurrent reciprocal parent edits cannot create a cycle', async () => {
    const first = await create('First');
    const second = await create('Second');
    const results = await Promise.all([
      edit(first, { parentId: second._id }),
      edit(second, { parentId: first._id }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await list()).every((category) => category.parentStatus === 'valid')).toBe(true);
  });

  test.each(['category create', 'category edit', 'product create', 'product edit'])(
    'concurrent %s and deletion cannot leave a dangling reference',
    async (operation) => {
      const target = await create('Target');
      const child = await create('Existing category');
      const initialProduct = await createProduct();
      const assignments = {
        'category create': () => owner('post', '/categories').send({ name: 'New child', parentId: target._id }),
        'category edit': () => edit(child, { parentId: target._id }),
        'product create': () => owner('post', '/products').send(productBody(target._id)),
        'product edit': () => owner('put', '/products/' + initialProduct.product._id).send({ categoryId: target._id }),
      };
      const [assignment, deletion] = await Promise.all([assignments[operation](), remove(target)]);
      const parent = await Category.findById(target._id);
      const childRef = await Category.exists({ tenantId: ids.storeA, parentId: target._id });
      const productRef = await Product.exists({ tenantId: ids.storeA, categoryId: target._id });
      if (deletion.status === 200) {
        expect(assignment.status).toBe(400);
        expect(parent).toBeNull();
        expect(childRef ?? productRef).toBeNull();
      } else {
        expect(deletion.status).toBe(409);
        expect(assignment.status).toBe(operation.endsWith('create') ? 201 : 200);
        expect(parent).not.toBeNull();
        expect(childRef ?? productRef).not.toBeNull();
      }
    }
  );
});

describe('product variant edits with live stock', () => {
  const ownerRequest = (method, url) => request(app)[method](`/api/v1${url}`).set(auth(tokens.ownerA));

  const stockedProduct = async () => {
    const created = await ownerRequest('post', '/products').send({
      name: 'Stocked Rice',
      variants: [
        { name: '1 kg', unit: 'kg', retailPrice: 100, stock: 10 },
        { name: '2 kg', unit: 'kg', retailPrice: 180, stock: 8 },
      ],
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.product._id;
    const url = `/products/${productId}`;
    const read = await ownerRequest('get', url);
    expect(read.status).toBe(200);
    return { url, ...read.body.data };
  };

  const sellVariant = (product, variant, qty) => request(app)
    .post('/api/v1/pos/order')
    .set(auth(tokens.staff))
    .send({ items: [{ productId: product._id, variantId: variant._id, qty }], paymentMethod: 'counter' });

  test('merges variant edits and leaves an omitted 8-unit variant and its ledger intact', async () => {
    const { url, product } = await stockedProduct();
    const [first, second] = product.variants;
    const update = await ownerRequest('put', url).send({ variants: [{ _id: first._id, retailPrice: 110 }] });
    expect(update.status).toBe(200);
    expect(update.body.data.product.variants).toEqual([{ ...first, retailPrice: 110, sellingPrice: 110 }, second]);
    expect(second.stock).toBe(8);
    expect(await StockLedger.find({ productId: product._id, variantId: second._id }).lean()).toMatchObject([
      { movementType: 'ADJUSTMENT_ADD', quantityChange: 8, balanceBefore: 0, balanceAfter: 8 },
    ]);

    const read = await ownerRequest('get', url);
    expect(read.body.data.revision).toBe(update.body.data.revision);
    expect((await ownerRequest('put', url).send({ variants: [] })).body.data.product.variants).toHaveLength(2);
    expect((await ownerRequest('put', url).send({ variants: [{ _id: first._id }, { _id: first._id }] })).status).toBe(409);
    expect((await ownerRequest('put', url).send({ variants: [{ _id: first._id, stock: 1 }] })).status).toBe(409);
  });

  test('rejects stale form saves after a bulk price change, a variant addition, or stock adjustment', async () => {
    const { url, product, revision } = await stockedProduct();
    const [first] = product.variants;
    const price = await ownerRequest('post', '/products/bulk/prices').send({
      updates: [{ productId: product._id, variantId: first._id, retailPrice: 120 }],
    });
    expect(price.status).toBe(200);

    const staleSave = (draftRevision) => ownerRequest('put', url).send({
      revision: draftRevision,
      variants: [{ _id: first._id, retailPrice: 105 }],
    });
    expect((await staleSave(revision)).status).toBe(409);

    const afterPrice = (await ownerRequest('get', url)).body.data;
    const variantAdded = await ownerRequest('put', url).send({
      revision: afterPrice.revision,
      variants: [
        { _id: first._id, lowStockLimit: 3 },
        { name: '3 kg', unit: 'kg', retailPrice: 240, stock: 3 },
      ],
    });
    expect(variantAdded.status).toBe(200);
    const third = variantAdded.body.data.product.variants[2];
    expect(await StockLedger.findOne({ variantId: third._id }).lean()).toMatchObject({ balanceBefore: 0, balanceAfter: 3 });
    expect((await staleSave(afterPrice.revision)).status).toBe(409);

    const stock = await ownerRequest('post', '/inventory/adjust').send({
      productId: product._id, variantId: first._id, adjustmentType: 'add', quantity: 2, reason: 'manual_correction',
    });
    expect(stock.status).toBe(200);
    expect((await staleSave(variantAdded.body.data.revision)).status).toBe(409);
    const current = (await ownerRequest('get', url)).body.data.product;
    expect(current.variants[0]).toMatchObject({ _id: first._id, retailPrice: 120, stock: 12, lowStockLimit: 3 });
    expect(current.variants[2]).toMatchObject({ _id: third._id, stock: 3 });
  });

  test('reconciles variant balances with their ledgers after a concurrent POS sale and product edit', async () => {
    const { url, product, revision } = await stockedProduct();
    const [first, second] = product.variants;
    const [sale, edit] = await Promise.all([
      request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send({
        paymentMethod: 'counter',
        items: [
          { productId: product._id, variantId: first._id, qty: 2 },
          { productId: product._id, variantId: second._id, qty: 3 },
        ],
      }),
      ownerRequest('put', url).send({ revision, variants: [{ _id: first._id, retailPrice: 115 }] }),
    ]);
    expect(sale.status).toBe(201);
    expect([200, 409]).toContain(edit.status);
    const saved = (await ownerRequest('get', url)).body.data.product;
    expect(saved.variants[0]).toMatchObject({ _id: first._id, retailPrice: edit.status === 200 ? 115 : 100, stock: 8 });
    expect(saved.variants[1]).toMatchObject({ _id: second._id, stock: 5 });
    for (const variant of saved.variants) {
      const ledger = await StockLedger.find({ productId: product._id, variantId: variant._id }).lean();
      expect(ledger.reduce((sum, entry) => sum + entry.quantityChange, 0)).toBe(variant.stock);
      if (variant._id === second._id) {
        expect(ledger).toContainEqual(expect.objectContaining({
          movementType: 'ORDER_SOLD', quantityChange: -3, balanceBefore: 8, balanceAfter: 5,
        }));
      }
    }
  });

  test('keeps archived stock, reservations, bills and returns linked to the original variant ID', async () => {
    const { url, product } = await stockedProduct();
    const [, variant] = product.variants;
    const sale = await sellVariant(product, variant, 1);
    expect(sale.status).toBe(201);
    const bill = sale.body.data.order;
    const reservation = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { quantity: 2 }));
    expect(reservation.status).toBe(201);
    const { order } = reservation.body.data;

    const { revision } = (await ownerRequest('get', url)).body.data;
    const archived = await ownerRequest('put', url).send({ revision, variants: [{ _id: variant._id, isActive: false }] });
    expect(archived.status).toBe(200);
    expect(archived.body.data.product.variants[1]).toMatchObject({ _id: variant._id, stock: 5, isActive: false });
    expect((await sellVariant(product, variant, 1)).status).toBe(404);

    const cancelled = await request(app).post(`/api/v1/storefront/store-alpha/orders/${order._id}/cancel`)
      .set(auth(tokens.customerA)).send({ reason: 'Changed mind' });
    expect(cancelled.status).toBe(200);

    const history = await ownerRequest('get', '/pos/orders');
    expect(history.body.data).toContainEqual(expect.objectContaining({
      _id: bill._id, items: [expect.objectContaining({ productId: product._id, variantId: variant._id })],
    }));
    const returned = await ownerRequest('post', '/returns').send({
      type: 'customer_return',
      orderId: bill._id,
      items: [{ productId: product._id, variantId: variant._id, qty: 1, restockItem: true }],
      refundMethod: 'cash',
    });
    expect(returned.status).toBe(201);
    const processed = await ownerRequest('post', `/returns/${returned.body.data.return._id}/process`).send({ action: 'approve' });
    expect(processed.status).toBe(200);

    const inventory = await ownerRequest('get', '/inventory/list');
    expect(inventory.body.data.products[0].variants[1]).toMatchObject({ _id: variant._id, stock: 8, isActive: false });
    const ledger = await ownerRequest('get', `/inventory/ledger/${product._id}`).query({ variantId: variant._id });
    expect(ledger.body.data.entries).toHaveLength(5);
    const byMovement = Object.fromEntries(ledger.body.data.entries.map((entry) => [entry.movementType, entry.balanceAfter]));
    expect(byMovement).toEqual({ ADJUSTMENT_ADD: 8, ORDER_SOLD: 7, ORDER_RESERVED: 5, ORDER_CANCEL_RESTORE: 7, RETURN_IN: 8 });
  });
});

describe('POS walk-in billing and Udhar customer validation', () => {
  const sell = (product, variant, details) => request(app).post('/api/v1/pos/order')
    .set(auth(tokens.staff))
    .send({ items: [{ productId: product._id, variantId: variant._id, qty: 1 }], ...details });

  test.each([
    ['counter', {}],
    ['counter', { customerPhone: '   ' }],
    ['upi_id', {}],
    ['upi_id', { customerPhone: '' }],
  ])('creates one %s walk-in bill and stock movement with optional phone details %j', async (paymentMethod, details) => {
    const { product, variant } = await createProduct({ stock: 8 });
    const response = await sell(product, variant, { paymentMethod, ...details });
    expect(response.status).toBe(201);
    const { order } = response.body.data;
    expect(order).toMatchObject({
      orderType: 'counter', paymentMethod, paymentStatus: 'paid', customerInfo: { name: 'Walk-in Customer' },
    });
    expect(order.customerInfo).not.toHaveProperty('phone');

    const orders = await Order.find({ tenantId: ids.storeA, orderType: 'counter' }).lean();
    expect(orders).toHaveLength(1);
    expect(orders[0].customerInfo).not.toHaveProperty('phone');
    const movements = await StockLedger.find({ tenantId: ids.storeA, productId: product._id }).lean();
    expect(movements).toMatchObject([{
      variantId: variant._id,
      referenceId: orders[0]._id,
      movementType: 'ORDER_SOLD',
      quantityChange: -1,
      balanceBefore: 8,
      balanceAfter: 7,
    }]);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(7);
  });

  test('validates supplied phones and requires both Udhar customer fields before writing anything', async () => {
    const { product, variant } = await createProduct({ stock: 8 });
    for (const paymentMethod of ['counter', 'upi_id']) {
      const invalid = await sell(product, variant, { paymentMethod, customerPhone: '0000000000' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors).toEqual([
        { field: 'customerPhone', message: 'Enter a valid 10-digit Indian mobile number.' },
      ]);
    }
    const blankPhone = await sell(product, variant, { paymentMethod: 'credit', customerName: 'Test Buyer', customerPhone: ' ' });
    expect(blankPhone.status).toBe(400);
    expect(blankPhone.body.errors).toEqual([
      { field: 'customerPhone', message: 'Enter the customer mobile number for Udhar.' },
    ]);
    const unidentified = await sell(product, variant, { paymentMethod: 'credit' });
    expect(unidentified.status).toBe(400);
    expect(unidentified.body.errors).toEqual([
      { field: 'customerName', message: 'Enter the customer name for Udhar.' },
      { field: 'customerPhone', message: 'Enter the customer mobile number for Udhar.' },
    ]);
    expect(await Order.countDocuments()).toBe(0);
    expect(await StockLedger.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(8);

    await UdharCustomer.create({ tenantId: ids.storeA, name: 'Test Buyer', phone: '9876543210' });
    const identified = await sell(product, variant, {
      paymentMethod: 'credit', customerName: ' Test Buyer ', customerPhone: ' 9876543210 ',
    });
    expect(identified.status).toBe(201);
    expect(identified.body.data.order).toMatchObject({
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      customerInfo: { name: 'Test Buyer', phone: '9876543210' },
    });
  });
});

describe('customer refunds against the original paid bill', () => {
  const owner = (method, path) => request(app)[method](`/api/v1${path}`).set(auth(tokens.ownerA));
  const line = ({ product, variant }, qty = 1, restockItem = true) =>
    ({ productId: product._id, variantId: variant._id, qty, restockItem });
  const sell = async (items, details) => {
    const response = await owner('post', '/pos/order').send({ items, ...details });
    expect(response.status).toBe(201);
    return response.body.data.order;
  };
  const createReturn = async (order, items, refundMethod = 'cash') => {
    const response = await owner('post', '/returns').send({
      type: 'customer_return', orderId: order._id, items, refundMethod,
      totalRefundAmount: 100000,
    });
    expect(response.status).toBe(201);
    return response.body.data.return;
  };
  const approve = (ret) => owner('post', `/returns/${ret._id}/process`).send({ action: 'approve' });
  const profitLoss = async (period) => {
    const response = await owner('get', '/reports/profit-loss').query(period ?? {});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.data;
  };

  test('uses the opening stock cost for A12 despite unsold purchases and later cost edits', async () => {
    const created = await owner('post', '/products').send({
      name: 'Opening stock',
      variants: [{ name: '1 kg', unit: 'kg', retailPrice: 100, purchasePrice: 60, stock: 10 }],
    });
    expect(created.status).toBe(201);
    const opening = created.body.data.product;
    const bill = await sell([line({ product: opening, variant: opening.variants[0] })]);
    expect(bill.items[0].unitCost).toBeUndefined();
    expect((await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(bill._id) })).items[0].unitCost).toBe(60);

    const unsold = await createProduct({ name: 'Unsold stock', stock: 0 });
    const supplier = await Supplier.create({ tenantId: ids.storeA, name: 'Stock supplier' });
    const invoice = await owner('post', '/purchases').send({
      supplierId: supplier._id,
      items: [{ productId: unsold.product._id, variantId: unsold.variant._id, quantity: 5, purchasePrice: 75 }],
    });
    expect(invoice.status).toBe(201);
    const edit = await owner('post', '/products/bulk/prices').send({
      updates: [{ productId: opening._id, variantId: opening.variants[0]._id, purchasePrice: 80 }],
    });
    expect(edit.status).toBe(200);
    const returned = await owner('post', '/returns').send({
      type: 'purchase_return', supplierId: supplier._id, purchaseEntryId: invoice.body.data.purchase._id,
      items: [line(unsold)],
    });
    expect(returned.status).toBe(201);
    expect((await approve(returned.body.data.return)).status).toBe(200);

    expect(await profitLoss()).toMatchObject({
      totalSales: 100, netSales: 100, returnsTotal: 0, cogs: 60, unknownCostLines: 0,
      grossProfit: 40, grossMargin: 40, netProfit: 40,
    });
  });

  test('reports missing historical cost explicitly and accepts a saved zero cost', async () => {
    const legacy = await createProduct({ offerPrice: null });
    const bill = await sell([line(legacy)]);
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(bill._id) }, { $unset: { 'items.0.unitCost': 1 } });
    const free = await createProduct({ name: 'Zero cost', offerPrice: null });
    await Product.updateOne({ _id: free.product._id }, { $set: { 'variants.0.purchasePrice': 0 } });
    await sell([line(free)]);

    expect(await profitLoss()).toMatchObject({
      netSales: 200, knownCogs: 0, cogs: null, unknownCostLines: 1,
      grossProfit: null, grossMargin: null, netProfit: null,
    });
  });

  test.each([true, false])('posts a refund in the processing period with restock=%s', async (restockItem) => {
    const original = await createProduct({ offerPrice: null });
    const bill = await sell([line(original)]);
    const date = '2025-05-01';
    const period = { startDate: date, endDate: date };
    await Order.updateOne({ _id: bill._id }, { $set: { deliveredAt: accountingDay(date).start } });
    await Product.updateOne({ _id: original.product._id }, { $set: { 'variants.0.purchasePrice': 85 } });
    const ret = await createReturn(bill, [line(original, 1, restockItem)]);
    expect(await profitLoss()).toMatchObject({ returnsTotal: 0, cogs: 0 });
    expect((await approve(ret)).status).toBe(200);
    expect((await approve(ret)).status).toBe(200);

    expect(await profitLoss(period)).toMatchObject({ netSales: 100, cogs: 60, grossProfit: 40 });
    expect(await profitLoss()).toMatchObject({
      returnsTotal: 100, netSales: -100, cogs: restockItem ? -60 : 0,
      grossProfit: restockItem ? -40 : -100, netProfit: restockItem ? -40 : -100,
    });
  });

  test('includes exchange revenue and snapshots replacement cost when the exchange is processed', async () => {
    const original = await createProduct({ offerPrice: null });
    const replacement = await createProduct({ name: 'Replacement', retailPrice: 80, offerPrice: null });
    const bill = await sell([line(original)]);
    const { restockItem, ...exchange } = line(replacement);
    const created = await owner('post', '/returns').send({
      type: 'customer_return', orderId: bill._id, items: [line(original)],
      exchangeItems: [exchange], refundMethod: 'cash',
    });
    expect(created.status).toBe(201);
    await Product.updateOne({ _id: replacement.product._id }, { $set: { 'variants.0.purchasePrice': 50 } });
    const processed = await approve(created.body.data.return);
    expect(processed.status).toBe(200);
    expect(processed.body.data.return.exchangeItems[0].unitCost).toBeUndefined();
    await Product.updateOne({ _id: replacement.product._id }, { $set: { 'variants.0.purchasePrice': 75 } });

    expect(await profitLoss()).toMatchObject({
      totalSales: 100, returnsTotal: 20, netSales: 80, cogs: 50,
      grossProfit: 30, grossMargin: 37.5, netProfit: 30,
    });
  });

  test('caps A06 at ₹80, reprices legacy pending amounts and restocks once on concurrent approval', async () => {
    const original = await createProduct({ offerPrice: 100 });
    const bill = await sell([line(original)], { overallDiscount: 20 });
    expect(bill.pricing.grandTotal).toBe(80);
    const ret = await createReturn(bill, [{ ...line(original), refundAmount: 100 }]);
    expect(ret).toMatchObject({ netRefund: 80, totalRefundAmount: 80, items: [{ refundAmount: 80 }] });
    await Order.updateOne({ _id: bill._id }, { $unset: { 'items.0.refundBasis': 1 } });
    await Return.updateOne({ _id: ret._id }, {
      $set: { netRefund: 100, totalRefundAmount: 100, 'items.0.refundAmount': 100 },
    });
    const responses = await Promise.all([approve(ret), approve(ret)]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.data.return).toMatchObject({ status: 'processed', netRefund: 80 });
    }
    expect(await StockLedger.countDocuments({ referenceId: ret._id, movementType: 'RETURN_IN' })).toBe(1);
    expect((await Product.findById(original.product._id)).variants[0].stock).toBe(20);
  });

  test('splits paise across three partial returns even when distinct approvals race without restock', async () => {
    const original = await createProduct();
    const bill = await sell([{ ...line(original, 3), price: 50 }], { overallDiscount: 49.99 });
    expect(bill.items[0].refundBasis).toMatchObject({
      itemDiscountMinor: 15000, billDiscountMinor: 4999, eligibleMinor: 10001,
    });
    const returns = [];
    for (let index = 0; index < 3; index += 1) {
      returns.push(await createReturn(bill, [line(original, 1, false)]));
    }
    const approvals = await Promise.all(returns.map(approve));
    expect(approvals.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(approvals.map((result) => result.body.data.return.netRefund).sort((a, b) => a - b))
      .toEqual([33.33, 33.34, 33.34]);
    expect(await StockLedger.countDocuments({ movementType: 'RETURN_IN' })).toBe(0);
    expect((await Product.findById(original.product._id)).variants[0].stock).toBe(17);
    expect((await owner('post', '/returns').send({
      type: 'customer_return', orderId: bill._id, items: [line(original)],
    })).status).toBe(409);
  });

  test('records zero for pending Udhar while allowing restock', async () => {
    const original = await createProduct();
    const customer = await UdharCustomer.create({ tenantId: ids.storeA, name: 'Credit Buyer', phone: '9876543210' });
    const bill = await sell([line(original)], { paymentMethod: 'credit', udharCustomerId: customer._id });
    const ret = await createReturn(bill, [line(original)]);
    expect(ret.netRefund).toBe(0);
    const processed = await approve(ret);
    expect(processed.status).toBe(200);
    expect(processed.body.data.return).toMatchObject({ netRefund: 0, items: [{ refundAmount: 0 }] });
    expect((await UdharCustomer.findById(customer._id)).balance).toBe(90);
    expect(await StockLedger.countDocuments({ referenceId: ret._id, movementType: 'RETURN_IN' })).toBe(1);
  });

  test('leaves an unpaid fulfilled order at zero and honors no-refund even for a paid order', async () => {
    const original = await createProduct();
    const unpaid = await sell([line(original)]);
    await Order.updateOne({ _id: unpaid._id }, { $set: { paymentStatus: 'pending' } });
    const paid = await sell([line(original)]);
    for (const [order, method] of [[unpaid, 'cash'], [paid, 'no_refund']]) {
      const ret = await createReturn(order, [line(original, 1, false)], method);
      expect(ret.netRefund).toBe(0);
      const processed = await approve(ret);
      expect(processed.status).toBe(200);
      expect(processed.body.data.return.netRefund).toBe(0);
    }
  });

  test('allocates restricted coupon and merchandise tax to original lines, excluding delivery', async () => {
    const eligible = await createProduct({ offerPrice: 100 });
    const excluded = await createProduct({ name: 'Oil', offerPrice: 50 });
    await Coupon.create({
      tenantId: ids.storeA, code: 'ONLYRICE', type: 'flat', value: 20,
      applicableProductIds: [eligible.product._id],
    });
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(
      orderBody(eligible.product, eligible.variant, { body: {
        couponCode: 'ONLYRICE',
        items: [eligible, excluded].map(({ product, variant }) =>
          ({ productId: product._id, variantId: variant._id, quantity: 1 })),
      } })
    );
    expect(placed.status).toBe(201);
    const { order } = placed.body.data;
    expect(order.pricing).toMatchObject({ grandTotal: 158, tax: 13, deliveryCharge: 15 });
    await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered', paymentStatus: 'paid' } });
    const first = await createReturn(order, [line(excluded)]);
    expect(first.netRefund).toBe(55);
    expect((await approve(first)).status).toBe(200);
    const second = await createReturn(order, [line(eligible)]);
    expect(second.netRefund).toBe(88);
    expect((await approve(second)).status).toBe(200);
  });

  test('uses fulfilled quantity and keeps a partially fulfilled return from restoring stock twice', async () => {
    const original = await createProduct({ offerPrice: 100 });
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA))
      .send(orderBody(original.product, original.variant, { quantity: 2 }));
    expect(placed.status).toBe(201);
    const { order } = placed.body.data;
    expect(order.items[0].unitCost).toBeUndefined();
    expect(await profitLoss()).toMatchObject({ totalSales: 0, cogs: 0 });
    await Order.updateOne({ _id: order._id }, { $set: { status: 'packing', paymentStatus: 'paid' } });
    const path = `/storefront/store-alpha/admin/orders/${order._id}`;
    const partialBody = { fulfilledItems: [{ variantId: original.variant._id, fulfilledQty: 1 }] };
    const partial = await owner('post', `${path}/partial`).send(partialBody);
    expect(partial.status).toBe(200);
    expect(partial.body.data.order.items[0].refundBasis).toMatchObject({ quantity: 1, eligibleMinor: 11000 });
    expect(await profitLoss()).toMatchObject({ totalSales: 125, cogs: 60, grossProfit: 65 });
    const ret = await createReturn(order, [line(original)]);
    expect(ret.netRefund).toBe(110);
    expect((await approve(ret)).status).toBe(200);
    expect((await owner('post', `${path}/partial`).send(partialBody)).status).toBe(409);
    expect((await owner('post', `${path}/cancel`).send({})).status).toBe(409);
    expect((await Product.findById(original.product._id)).variants[0].stock).toBe(20);
  });

  test('consumes legacy over-refunds against the remaining order cap across variants', async () => {
    const first = await createProduct({ offerPrice: 100 });
    const second = await createProduct({ name: 'Oil', offerPrice: 100 });
    const third = await createProduct({ name: 'Flour', offerPrice: 100 });
    const bill = await sell([line(first), line(second), line(third)], { overallDiscount: 60 });
    const old = await createReturn(bill, [line(first)]);
    await Return.updateOne({ _id: old._id }, { $set: {
      status: 'processed', netRefund: 150, totalRefundAmount: 150, 'items.0.refundAmount': 150,
    } });
    const firstPending = await createReturn(bill, [line(second, 1, false)]);
    const secondPending = await createReturn(bill, [line(third, 1, false)]);
    expect([firstPending.netRefund, secondPending.netRefund]).toEqual([80, 80]);
    const approvals = await Promise.all([approve(firstPending), approve(secondPending)]);
    expect(approvals.map((result) => result.status)).toEqual([200, 200]);
    expect(approvals.map((result) => result.body.data.return.netRefund).sort((a, b) => a - b)).toEqual([10, 80]);

    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../scripts/review-refunds.js', import.meta.url)), String(ids.storeA),
    ], { env: { ...process.env, MONGODB_URI: replSet.getUri() } });
    expect(JSON.parse(stdout)).toMatchObject({
      scanned: 3,
      findings: [{
        returnId: old._id, orderId: bill._id, status: 'processed', reason: 'over_refund',
        recordedMinor: 15000, eligibleMinor: 8000, excessMinor: 7000,
      }],
    });
    expect(JSON.parse(stdout).findings).toHaveLength(1);
    expect((await Return.findById(old._id)).netRefund).toBe(150);
  });
});

describe('durable order submission idempotency', () => {
  const posEndpoint = '/api/v1/pos/order';
  const storefrontEndpoint = '/api/v1/storefront/store-alpha/orders';
  const posBody = ({ product, variant }) => ({
    paymentMethod: 'counter',
    items: [{ productId: String(product._id), variantId: String(variant._id), qty: 1 }],
  });
  const submitPOS = (target, key, body, token = tokens.staff) =>
    request(target).post(posEndpoint).set(auth(token)).set('Idempotency-Key', key).send(body);
  const submitCustomer = (target, key, body) =>
    request(target).post(storefrontEndpoint).set(auth(tokens.customerA)).set('Idempotency-Key', key).send(body);

  const expectSingleMovement = async (product, variant, orderId, movementType) => {
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(99);
    const movements = await StockLedger.find({ productId: product._id }).lean();
    expect(movements).toMatchObject([{
      variantId: variant._id, movementType, quantityChange: -1, balanceBefore: 100, balanceAfter: 99,
    }]);
    expect(String(movements[0].referenceId)).toBe(orderId);
  };

  test('advertises Idempotency-Key and guest order access in the browser preflight', async () => {
    for (const endpoint of [posEndpoint, storefrontEndpoint]) {
      const preflight = await request(app).options(endpoint)
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,idempotency-key,x-order-access-token');
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-headers'].toLowerCase().split(/,\s*/))
        .toEqual(expect.arrayContaining(['idempotency-key', 'x-order-access-token']));
    }
  });

  test('deduplicates parallel POS requests and keeps independent identical bills and tenants distinct', async () => {
    const fixture = await createProduct({ stock: 100 });
    const { product, variant } = fixture;
    const key = randomUUID();
    const body = posBody(fixture);
    const [first, second] = await Promise.all([
      submitPOS(app, key, body),
      submitPOS(app, key, { items: body.items, paymentMethod: body.paymentMethod }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const original = first.body.data.order;
    expect(second.body.data.order._id).toBe(original._id);
    expect(second.body.data.order.orderNumber).toBe(original.orderNumber);
    expect(original).not.toHaveProperty('orderSubmission');
    expect(second.body.data.order).not.toHaveProperty('orderSubmission');
    expect(await Order.countDocuments()).toBe(1);
    await expectSingleMovement(product, variant, original._id, 'ORDER_SOLD');

    expect((await submitPOS(app, key, { ...body, items: [{ ...body.items[0], qty: 2 }] })).status).toBe(409);
    expect((await submitPOS(app, key, body, tokens.ownerA)).status).toBe(409);
    expect((await submitPOS(app, 'bad key', body)).status).toBe(400);

    const independent = await submitPOS(app, randomUUID(), body);
    expect(independent.status).toBe(201);
    expect(independent.body.data.order._id).not.toBe(original._id);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(98);
    expect(await StockLedger.countDocuments({ productId: product._id })).toBe(2);

    const other = await createProduct({ tenantId: ids.storeB, stock: 100 });
    const foreign = await submitPOS(app, key, posBody(other), tokens.ownerB);
    expect(foreign.status).toBe(201);
    expect(foreign.body.data.order._id).not.toBe(original._id);
    expect(await Order.countDocuments({ tenantId: ids.storeA })).toBe(2);
    expect(await Order.countDocuments({ tenantId: ids.storeB })).toBe(1);
  });

  test('parallel customer checkout claims the coupon once and replays the original order', async () => {
    const { product, variant } = await createProduct({ stock: 100 });
    const coupon = await Coupon.create({
      tenantId: ids.storeA, code: 'RETRYONCE', type: 'flat', value: 10,
      usageLimitTotal: 1, usageLimitPerUser: 1,
    });
    const key = randomUUID();
    const body = orderBody(product, variant, { body: { couponCode: coupon.code } });
    const [first, second] = await Promise.all([submitCustomer(app, key, body), submitCustomer(app, key, body)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const { order } = first.body.data;
    expect(second.body.data.order._id).toBe(order._id);
    expect(second.body.data.guestAccessToken).toBeUndefined();
    expect(order).not.toHaveProperty('orderSubmission');
    expect(second.body.data.order).not.toHaveProperty('guestAccessTokenHash');
    expect(await Order.countDocuments()).toBe(1);
    const notices = await Notification.find({ 'data.orderId': new mongoose.Types.ObjectId(order._id) }).lean();
    expect(notices.filter((notice) => notice.role === 'admin')).toHaveLength(1);
    expect(notices.filter((notice) => notice.role === 'staff')).toHaveLength(4);
    expect(new Set(notices.filter((notice) => notice.userId).map((notice) => String(notice.userId))).size).toBe(4);
    expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);
    expect(await CouponUsage.find({ couponId: coupon._id }).lean()).toMatchObject([{ count: 1 }]);
    await expectSingleMovement(product, variant, order._id, 'ORDER_RESERVED');

    expect((await submitCustomer(app, key, { ...body, note: 'Changed after submission' })).status).toBe(409);
    const otherActor = await request(app).post(storefrontEndpoint).set(auth(tokens.customerA2))
      .set('Idempotency-Key', key).send(body);
    expect(otherActor.status).toBe(409);
    expect(otherActor.body.data).toBeUndefined();
    const tracking = await request(app).get(storefrontEndpoint + '/' + order._id)
      .set(auth(tokens.customerA));
    expect(tracking.status).toBe(200);
    expect(tracking.body.data.order._id).toBe(order._id);

    const independentBody = orderBody(product, variant);
    const independent = await Promise.all([
      submitCustomer(app, randomUUID(), independentBody), submitCustomer(app, randomUUID(), independentBody),
    ]);
    expect(independent.map((result) => result.status)).toEqual([201, 201]);
    expect(new Set(independent.map((result) => result.body.data.order._id)).size).toBe(2);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(97);
  });

  test('a failed inbox write rolls checkout and stock back, and retry saves one order with its notifications', async () => {
    const { product, variant } = await createProduct({ stock: 100 });
    const body = orderBody(product, variant);
    const key = randomUUID();
    const insert = vi.spyOn(Notification, 'insertMany').mockRejectedValueOnce(new Error('Simulated inbox write failure'));
    try {
      await submitCustomer(app, key, body).expect(500);
      expect(await Order.countDocuments()).toBe(0);
      expect(await Notification.countDocuments()).toBe(0);
      expect(await StockLedger.countDocuments()).toBe(0);
      expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(100);
    } finally { insert.mockRestore(); }
    const placed = await submitCustomer(app, key, body).expect(201);
    await submitCustomer(app, key, body).expect(200);
    await expectSingleMovement(product, variant, placed.body.data.order._id, 'ORDER_RESERVED');
    expect(await Notification.countDocuments({ type: 'new_order', role: 'admin' })).toBe(1);
    const revision = (await request(app).get('/api/v1/sync/revision').set(auth(tokens.ownerA)).expect(200)).body.data;
    expect(revision.versions).toMatchObject({ Order: 1, Notification: 1, Product: 1 });
  });

  test('replays committed POS and customer orders through a fresh API process', async () => {
    const pos = await createProduct({ stock: 100 });
    const guest = await createProduct({ stock: 100 });
    const posKey = randomUUID();
    const guestKey = randomUUID();
    const sale = posBody(pos);
    const checkout = orderBody(guest.product, guest.variant);
    const entry = fileURLToPath(new URL('./fixtures/order-restart-server.js', import.meta.url));

    const withAPI = async (requests) => {
      const child = fork(entry, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      const stopped = once(child, 'exit');
      try {
        const [port] = await once(child, 'message', { signal: AbortSignal.timeout(20000) });
        return await requests('http://127.0.0.1:' + port);
      } finally {
        child.kill();
        await stopped;
      }
    };
    const [originalPOS, originalGuest] = await withAPI((target) => Promise.all([
      submitPOS(target, posKey, sale), submitCustomer(target, guestKey, checkout),
    ]));
    expect([originalPOS.status, originalGuest.status]).toEqual([201, 201]);

    // Change mutable checkout state after the commit. A replay must skip quoting and stock writes.
    await Store.updateOne({ _id: ids.storeA }, { $set: { 'orderSettings.isAcceptingOrders': false } });
    await withAPI(async (target) => {
      const [posReplay, guestReplay] = await Promise.all([
        submitPOS(target, posKey, sale), submitCustomer(target, guestKey, checkout),
      ]);
      expect([posReplay.status, guestReplay.status]).toEqual([200, 200]);
      expect(posReplay.body.data.order._id).toBe(originalPOS.body.data.order._id);
      expect(guestReplay.body.data.order._id).toBe(originalGuest.body.data.order._id);
      const tracked = await request(target).get(storefrontEndpoint + '/' + guestReplay.body.data.order._id)
        .set(auth(tokens.customerA));
      expect(tracked.status).toBe(200);
    });
    expect(await Order.countDocuments()).toBe(2);
    await expectSingleMovement(pos.product, pos.variant, originalPOS.body.data.order._id, 'ORDER_SOLD');
    await expectSingleMovement(guest.product, guest.variant, originalGuest.body.data.order._id, 'ORDER_RESERVED');
  }, 60000);
});

describe('POS credit posting and legacy reconciliation', () => {
  const phone = '9876543210';
  const createAccount = (overrides = {}) => UdharCustomer.create({
    tenantId: ids.storeA, name: 'Account Customer', phone, creditLimit: 500, ...overrides,
  });
  const creditBody = (product, variant, overrides = {}) => ({
    items: [{ productId: product._id, variantId: variant._id, qty: 1 }],
    paymentMethod: 'credit',
    ...overrides,
  });
  const sell = (body, key = randomUUID()) => request(app).post('/api/v1/pos/order')
    .set(auth(tokens.staff)).set('Idempotency-Key', key).send(body);

  test('posts one ₹100 debit and a ₹100 balance with one stock movement, including parallel retries', async () => {
    const account = await createAccount();
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const body = creditBody(product, variant, { udharCustomerId: account._id });
    const key = randomUUID();
    const replies = await Promise.all([sell(body, key), sell(body, key)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 201]);
    const { order } = replies[0].body.data;
    expect(replies[1].body.data.order._id).toBe(order._id);
    expect(order).toMatchObject({
      udharCustomerId: String(account._id),
      customerInfo: { name: account.name, phone },
      pricing: { grandTotal: 100 },
      paymentStatus: 'pending',
    });
    expect(await Order.countDocuments()).toBe(1);
    expect(await UdharEntry.find({ tenantId: ids.storeA }).lean()).toMatchObject([{
      customerId: account._id,
      type: 'debit', amount: 100, balanceAfter: 100, referenceType: 'pos_order',
      referenceId: new mongoose.Types.ObjectId(order._id),
    }]);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(100);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(99);
    expect(await StockLedger.find({ productId: product._id }).lean()).toMatchObject([
      { referenceId: new mongoose.Types.ObjectId(order._id), quantityChange: -1, balanceAfter: 99 },
    ]);
  });

  test('rejects absent, inactive, foreign and ambiguous accounts before creating a credit bill', async () => {
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const foreign = await createAccount({ tenantId: ids.storeB });
    const inactive = await createAccount({ isActive: false });
    const fallback = creditBody(product, variant, { customerName: 'Account Customer', customerPhone: phone });
    const missing = await sell(fallback);
    expect(missing.status).toBe(404);
    expect(missing.body.errors[0]).toMatchObject({ field: 'customerPhone' });
    expect((await sell(creditBody(product, variant, { udharCustomerId: foreign._id }))).status).toBe(404);
    expect((await sell(creditBody(product, variant, { udharCustomerId: inactive._id }))).status).toBe(404);

    const first = await createAccount();
    await createAccount({ name: 'Duplicate Customer' });
    expect((await sell(fallback)).status).toBe(409);
    const lookup = await request(app).get('/api/v1/pos/udhar-customer').set(auth(tokens.staff)).query({ phone });
    expect(lookup.status).toBe(409);
    expect(lookup.body.message).toMatch(/Multiple active Udhar accounts/);
    expect(await Order.countDocuments()).toBe(0);
    expect(await UdharEntry.countDocuments()).toBe(0);
    expect(await StockLedger.countDocuments()).toBe(0);

    const explicit = await sell(creditBody(product, variant, { udharCustomerId: first._id }));
    expect(explicit.status).toBe(201);
    expect(explicit.body.data.order.udharCustomerId).toBe(String(first._id));
  });

  test('posts concurrent independent bills without a credit limit', async () => {
    const account = await createAccount({ creditLimit: 100 });
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const second = await createProduct({ name: 'Other product', stock: 100, offerPrice: null });
    const replies = await Promise.all([
      sell(creditBody(product, variant, { udharCustomerId: account._id })),
      sell(creditBody(second.product, second.variant, { udharCustomerId: account._id })),
    ]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 201]);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(200);
    expect(await Order.countDocuments()).toBe(2);
    expect(await UdharEntry.countDocuments()).toBe(2);
    expect(await StockLedger.countDocuments()).toBe(2);
  });

  test('records split receipts once, allocates repayments over whole history and reconciles Day Close', async () => {
    const account = await createAccount();
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const body = creditBody(product, variant, { udharCustomerId: account._id, payments: { cash: 20, upi: 30 } });
    const key = randomUUID();
    const posted = await sell(body, key);
    expect(posted.status).toBe(201);
    const order = posted.body.data.order;
    expect(order).toMatchObject({ receivedAmount: 50, udharAmount: 50, paymentStatus: 'partial',
      checkoutPayments: [{ method: 'cash', amount: 20 }, { method: 'upi', amount: 30 }] });
    expect((await sell(body, key)).status).toBe(200);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(50);
    const second = await sell(creditBody(product, variant, { udharCustomerId: account._id }));
    expect(second.status).toBe(201);
    const payment = await request(app).post(`/api/v1/udhar/${account._id}/credit`).set(auth(tokens.ownerA))
      .send({ amount: 70, method: 'upi' });
    expect(payment.status).toBe(201);
    const ledger = await request(app).get(`/api/v1/udhar/${account._id}/ledger`).set(auth(tokens.ownerA)).query({ limit: 1, page: 3 });
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.entries).toHaveLength(1);
    expect(ledger.body.data.entries[0].order.paymentSummary).toMatchObject({ originalUdhar: 50, pending: 0,
      initialPaid: 50, payments: [{ method: 'upi', amount: 50 }, { method: 'upi', amount: 30, atCheckout: true }, { method: 'cash', amount: 20, atCheckout: true }] });
    const secondPage = await request(app).get(`/api/v1/udhar/${account._id}/ledger`).set(auth(tokens.ownerA)).query({ limit: 1, page: 2 });
    expect(secondPage.body.data.entries[0].order.paymentSummary).toMatchObject({ originalUdhar: 100, pending: 80, payments: [{ method: 'upi', amount: 20 }] });
    const date = accountingDay(new Date()).key.toISOString().slice(0, 10);
    const closing = await request(app).get('/api/v1/daily-closing/summary').set(auth(tokens.ownerA)).query({ date });
    expect(closing.status).toBe(200);
    expect(closing.body.data).toMatchObject({ cashSales: 20, upiSales: 30, creditSales: 150, totalSales: 200,
      movements: { upi: { udharCollections: 70 } } });
    const sales = await request(app).get('/api/v1/reports/sales-overview').set(auth(tokens.ownerA)).query({ startDate: date });
    expect(sales.status).toBe(200);
    expect(sales.body.data.summary).toMatchObject({ sales: 200, received: 120, creditSales: 150, outstandingUdhar: 80 });
  });

  test('accepts fully paid split cash and UPI and rejects excess or unassigned debt without stock changes', async () => {
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const base = { items: [{ productId: product._id, variantId: variant._id, qty: 1 }], paymentMethod: 'counter' };
    for (const payments of [{ cash: 101 }, { cash: 20 }, { cash: -1 }, { cash: 0.001 }]) {
      expect((await sell({ ...base, payments })).status).toBe(400);
    }
    expect(await Order.countDocuments()).toBe(0);
    expect(await StockLedger.countDocuments()).toBe(0);
    const posted = await sell({ ...base, payments: { cash: 40, upi: 60 } });
    expect(posted.status).toBe(201);
    expect(posted.body.data.order).toMatchObject({ paymentStatus: 'paid', receivedAmount: 100, udharAmount: 0 });
    expect(await UdharEntry.countDocuments()).toBe(0);
  });

  test('finds active POS accounts by name or partial number with tenant isolation and pagination', async () => {
    const account = await createAccount({ name: 'Ajay Sharma' });
    await createAccount({ tenantId: ids.storeB, name: 'Ajay Foreign' });
    await createAccount({ name: 'Ajay Inactive', isActive: false });
    for (const search of ['Ajay', '76543']) {
      const result = await request(app).get('/api/v1/pos/udhar-customers').set(auth(tokens.staff)).query({ search, limit: 1 });
      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject([{ _id: String(account._id), name: 'Ajay Sharma', phone }]);
      expect(result.body.meta.total).toBe(1);
    }
  });

  test('cancels only the unpaid part of a split Udhar parcha', async () => {
    const account = await createAccount();
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const posted = await sell(creditBody(product, variant, { udharCustomerId: account._id,
      saleType: 'parcha', payments: { cash: 20, upi: 30 } }));
    expect(posted.status).toBe(201);
    const cancelled = await request(app).post(`/api/v1/storefront/store-alpha/admin/orders/${posted.body.data.order._id}/cancel`).set(auth(tokens.ownerA)).send({ reason: 'Cancel parcha' });
    expect(cancelled.status).toBe(200);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(0);
    expect(await UdharEntry.find({ referenceId: posted.body.data.order._id }).sort({ _id: 1 }).lean()).toMatchObject([
      { type: 'debit', amount: 50 }, { type: 'credit', amount: 50 },
    ]);
  });

  test('rolls back the bill, balance and stock when the Udhar ledger insert fails', async () => {
    const account = await createAccount();
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const body = creditBody(product, variant, { udharCustomerId: account._id });
    const key = randomUUID();
    const insert = vi.spyOn(UdharEntry, 'create').mockRejectedValueOnce(new Error('Injected Udhar write failure'));
    try {
      const failed = await sell(body, key);
      expect(failed.status).toBe(500);
      expect(insert).toHaveBeenCalledOnce();
    } finally {
      insert.mockRestore();
    }
    expect(await Order.countDocuments()).toBe(0);
    expect(await StockLedger.countDocuments()).toBe(0);
    expect(await UdharEntry.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(100);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(0);

    expect((await sell(body, key)).status).toBe(201);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(100);
    expect(await UdharEntry.countDocuments()).toBe(1);
  });

  test.each(['cancel', 'reject'])('reverses an Udhar parcha once on %s, alongside stock restoration', async (action) => {
    const account = await createAccount();
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const posted = await sell(creditBody(product, variant, { udharCustomerId: account._id, saleType: 'parcha' }));
    expect(posted.status).toBe(201);
    const { order } = posted.body.data;
    const reverse = () => request(app).post('/api/v1/storefront/store-alpha/admin/orders/' + order._id + '/' + action)
      .set(auth(tokens.ownerA)).send({ reason: 'Reversed test parcha' });
    expect((await reverse()).status).toBe(200);
    expect((await reverse()).status).toBe(200);
    expect(await UdharEntry.find({ referenceId: order._id }).sort({ _id: 1 }).lean()).toMatchObject([
      { type: 'debit', amount: 100, balanceAfter: 100 },
      { type: 'credit', amount: 100, balanceAfter: 0 },
    ]);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(0);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(100);
  });

  test('adjusts a partially fulfilled Udhar parcha only by the change in bill total', async () => {
    await Store.updateOne({ _id: ids.storeA }, { $set: { 'taxSettings.enableGST': false } });
    const account = await createAccount();
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const posted = await sell(creditBody(product, variant, {
      udharCustomerId: account._id,
      saleType: 'parcha',
      items: [{ productId: product._id, variantId: variant._id, qty: 2 }],
    }));
    expect(posted.status).toBe(201);
    const { order } = posted.body.data;
    const url = '/api/v1/storefront/store-alpha/admin/orders/' + order._id;
    const packing = await request(app).patch(url + '/status').set(auth(tokens.ownerA)).send({ status: 'packing' });
    expect(packing.status).toBe(200);
    const partiallyFulfill = () => request(app).post(url + '/partial').set(auth(tokens.ownerA))
      .send({ fulfilledItems: [{ variantId: variant._id, fulfilledQty: 1 }] });
    const partial = await partiallyFulfill();
    expect(partial.status).toBe(200);
    expect(partial.body.data.order.pricing.grandTotal).toBe(100);
    expect((await partiallyFulfill()).status).toBe(200);
    expect(await UdharEntry.find({ referenceId: order._id }).sort({ _id: 1 }).lean()).toMatchObject([
      { type: 'debit', amount: 200, balanceAfter: 200 },
      { type: 'credit', amount: 100, balanceAfter: 100 },
    ]);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(100);
    expect((await Product.findById(product._id)).variants.id(variant._id).stock).toBe(99);
  });

  test('lists only the tenant’s open legacy credit bills and leaves their accounting unchanged', async () => {
    const account = await createAccount({ balance: 100 });
    const { product, variant } = await createProduct({ stock: 100, offerPrice: null });
    const legacy = (overrides = {}) => Order.create({
      tenantId: ids.storeA, orderType: 'counter', saleType: 'instant', status: 'delivered',
      paymentMethod: 'credit', paymentStatus: 'pending',
      customerInfo: { name: 'Legacy Customer', phone },
      items: [{ productId: product._id, variantId: variant._id, name: 'Rice', quantity: 1, price: 100, mrp: 100 }],
      pricing: { grandTotal: 100 },
      ...overrides,
    });
    const missing = await legacy();
    const linked = await legacy();
    await UdharEntry.create({
      tenantId: ids.storeA, customerId: account._id, type: 'debit', amount: 100,
      referenceType: 'order', referenceId: linked._id, balanceAfter: 100,
    });
    await legacy({ paymentStatus: 'paid' });
    await legacy({ status: 'cancelled' });
    await legacy({ tenantId: ids.storeB });
    expect((await sell(creditBody(product, variant, { udharCustomerId: account._id }))).status).toBe(201);

    const report = '/api/v1/udhar/legacy-credit-bills';
    expect((await request(app).get(report).set(auth(tokens.staff))).status).toBe(403);
    const read = await request(app).get(report).set(auth(tokens.ownerA));
    expect(read.status).toBe(200);
    expect(read.body.meta.total).toBe(1);
    expect(read.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: String(missing._id), amount: 100, reconciliation: 'missing_debit', debits: [] }),
    ]));
    expect(await UdharEntry.countDocuments()).toBe(2);
    expect((await UdharCustomer.findById(account._id)).balance).toBe(200);
    expect((await Order.findById(missing._id)).udharCustomerId).toBeUndefined();
    expect(String((await Order.findById(linked._id)).udharCustomerId)).toBe(String(account._id));
  });
});

describe('durable bill settlement and POS packing', () => {
  const owner = (method, path) => request(app)[method]('/api/v1' + path).set(auth(tokens.ownerA));
  const account = () => UdharCustomer.create({ tenantId: ids.storeA, name: 'Bill Customer', phone: '9876543210' });
  const sell = async (customer, price = 100, extra = {}) => {
    const { product, variant } = await createProduct({ retailPrice: price, offerPrice: null, stock: 100 });
    const response = await owner('post', '/pos/order').set('Idempotency-Key', randomUUID()).send({
      items: [{ productId: product._id, variantId: variant._id, qty: 1 }],
      paymentMethod: customer ? 'credit' : 'counter', ...(customer && { udharCustomerId: customer._id }), ...extra,
    });
    expect(response.status).toBe(201);
    return { order: response.body.data.order, product, variant };
  };
  const pay = (customer, amount, extra = {}, key = randomUUID()) => owner('post', `/udhar/${customer._id}/credit`)
    .set('Idempotency-Key', key).send({ amount, method: 'cash', ...extra });

  test('freezes receipt allocations, clears the original bill and counts an account receipt only once', async () => {
    const customer = await account();
    const { order: first } = await sell(customer, 461, { payments: { cash: 50, upi: 200 } });
    const { order: second } = await sell(customer, 300);
    const preview = await owner('get', `/udhar/${customer._id}/payment-preview`).query({ amount: 400 });
    expect(preview.status).toBe(200);
    expect(preview.body.data.allocations).toMatchObject([{ orderId: first._id, amount: 211 }, { orderId: second._id, amount: 189 }]);
    const key = randomUUID();
    const replies = await Promise.all([pay(customer, 400, {}, key), pay(customer, 400, {}, key)]);
    expect(replies.map((row) => row.status).sort()).toEqual([200, 201]);
    expect(await UdharEntry.countDocuments({ customerId: customer._id, type: 'credit' })).toBe(1);
    const stored = await UdharEntry.findOne({ customerId: customer._id, type: 'credit' }).lean();
    expect(stored).toMatchObject({ amount: 400, allocationMode: 'oldest_first', allocations: [
      { orderId: new mongoose.Types.ObjectId(first._id), amount: 211 }, { orderId: new mongoose.Types.ObjectId(second._id), amount: 189 },
    ] });
    const firstRead = await owner('get', `/storefront/store-alpha/admin/orders/${first._id}`);
    expect(firstRead.status).toBe(200);
    expect(firstRead.body.data.order).toMatchObject({ paymentStatus: 'paid', receivedAmount: 250,
      paymentSummary: { pending: 0, totalPaid: 461, collected: 211, state: 'paid' } });
    expect(firstRead.body.data.order.paymentSummary.clearedAt).toBeTruthy();
    expect((await Order.findById(second._id)).settlement).toMatchObject({ pending: 111, collected: 189 });
    expect((await UdharCustomer.findById(customer._id)).balance).toBe(111);
    const payments = await owner('get', `/storefront/store-alpha/admin/orders/${first._id}/payments`);
    expect(payments.body.data.data).toHaveLength(3);
    expect(payments.body.data.data.find((row) => row.entryId === String(stored._id))).toMatchObject({ amount: 211, receiptAmount: 400 });
    const report = await owner('get', '/reports/sales-overview');
    expect(report.body.data.summary).toMatchObject({ sales: 761, received: 650, outstandingUdhar: 111 });
    expect(report.body.data.receiptsByMethod).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'cash', amount: 450 }), expect.objectContaining({ key: 'upi', amount: 200 }),
    ]));
  });

  test('a targeted bill payment leaves older bills alone and rejects duplicate-key changes and overpayments', async () => {
    const customer = await account();
    const { order: first } = await sell(customer);
    const { order: second } = await sell(customer);
    const key = randomUUID();
    const payment = await pay(customer, 50, { orderId: second._id, method: 'upi' }, key);
    expect(payment.status).toBe(201);
    expect(payment.body.data.entry).not.toHaveProperty('paymentSubmission');
    expect((await Order.findById(first._id)).settlement.pending).toBe(100);
    expect((await Order.findById(second._id)).settlement.pending).toBe(50);
    expect((await pay(customer, 60, { orderId: second._id, method: 'upi' }, key)).status).toBe(409);
    expect((await pay(customer, 60, { orderId: second._id })).status).toBe(409);
    const foreign = await UdharCustomer.create({ tenantId: ids.storeB, name: 'Foreign', balance: 100 });
    expect((await pay(foreign, 10)).status).toBe(404);
    const outsider = await account();
    expect((await pay(outsider, 10, { orderId: first._id })).status).toBe(404);
    const races = await Promise.all([pay(customer, 50, { orderId: second._id }), pay(customer, 50, { orderId: second._id })]);
    expect(races.map((row) => row.status).sort()).toEqual([201, 409]);
    expect((await Order.findById(second._id)).paymentStatus).toBe('paid');
    expect((await UdharCustomer.findById(customer._id)).balance).toBe(100);
  });

  test('correction restores every affected bill once, preserves the receipt and removes it from cash collections', async () => {
    const customer = await account();
    const { order: first } = await sell(customer);
    const { order: second } = await sell(customer);
    const receipt = await pay(customer, 150);
    const id = receipt.body.data.entry._id;
    const reverse = () => owner('post', `/udhar/${customer._id}/payments/${id}/reverse`).send({ reason: 'Recorded against the wrong customer' });
    expect((await reverse()).status).toBe(200);
    expect((await reverse()).status).toBe(200);
    expect((await UdharCustomer.findById(customer._id)).balance).toBe(200);
    expect((await Order.findById(first._id)).settlement).toMatchObject({ pending: 100, collected: 0 });
    expect((await Order.findById(second._id)).settlement).toMatchObject({ pending: 100, collected: 0 });
    expect((await UdharEntry.findById(id)).voidedAt).toBeTruthy();
    expect(await UdharEntry.countDocuments({ reversalOf: id })).toBe(1);
    expect((await owner('get', '/reports/sales-overview')).body.data.summary.received).toBe(0);
    const history = await owner('get', `/storefront/store-alpha/admin/orders/${first._id}/payments`);
    expect(history.body.data.data[0]).toMatchObject({ amount: 100, receiptAmount: 150, voidReason: 'Recorded against the wrong customer' });
  });

  test('backfills old account repayments once and retains the original ledger snapshots', async () => {
    const customer = await UdharCustomer.create({ tenantId: ids.storeA, name: 'Older Customer', phone: '9876543210', balance: 50 });
    const order = await Order.create({ tenantId: ids.storeA, udharCustomerId: customer._id, orderType: 'counter',
      status: 'delivered', paymentMethod: 'credit', customerInfo: { name: customer.name, phone: customer.phone },
      items: [{ name: 'Old rice', quantity: 1, mrp: 100, price: 100 }], pricing: { grandTotal: 100 } });
    const debit = await UdharEntry.create({ tenantId: ids.storeA, customerId: customer._id, type: 'debit', amount: 100, referenceType: 'pos_order', referenceId: order._id, balanceAfter: 100 });
    const receipt = await UdharEntry.create({ tenantId: ids.storeA, customerId: customer._id, type: 'credit', amount: 50, method: 'upi', balanceAfter: 50 });
    const read = await owner('get', `/storefront/store-alpha/admin/orders/${order._id}`);
    expect(read.status).toBe(200);
    expect(read.body.data.order.paymentSummary).toMatchObject({ totalPaid: 50, pending: 50, state: 'partial' });
    expect((await UdharCustomer.findById(customer._id)).allocationVersion).toBe(1);
    expect((await UdharEntry.findById(debit._id))).toMatchObject({ amount: 100, balanceAfter: 100, remainingAmount: 50 });
    const migrated = (await UdharEntry.findById(receipt._id)).toObject();
    expect(migrated).toMatchObject({ allocationMode: 'reconstructed', allocations: [{ orderId: order._id, amount: 50 }] });
    await owner('get', `/udhar/${customer._id}/ledger`);
    expect((await UdharEntry.findById(receipt._id)).allocations.toObject()).toEqual(migrated.allocations);
  });

  test('pages five receipts and five orders without duplicates, including split tenders with identical timestamps', async () => {
    for (let index = 0; index < 7; index += 1) await sell(null, 100, index === 0 ? { payments: { cash: 40, upi: 60 } } : {});
    const orders = await owner('get', '/storefront/store-alpha/admin/orders');
    expect(orders.body.data).toHaveLength(5);
    expect(orders.body.meta.nextCursor).toBeTruthy();
    const nextOrders = await owner('get', '/storefront/store-alpha/admin/orders').query({ cursor: orders.body.meta.nextCursor });
    expect(nextOrders.body.data).toHaveLength(2);
    expect(new Set([...orders.body.data, ...nextOrders.body.data].map((row) => row._id)).size).toBe(7);
    const report = await owner('get', '/reports/sales-overview');
    expect(report.body.data.transactions).toHaveLength(5);
    expect(report.body.data.summary.received).toBe(700);
    const next = await owner('get', '/reports/sales-overview').query({ cursor: report.body.data.meta.nextCursor });
    expect(next.body.data.transactions).toHaveLength(3);
    expect(new Set([...report.body.data.transactions, ...next.body.data.transactions].map((row) => row.receiptKey)).size).toBe(8);
    expect((await owner('get', '/reports/sales-overview').query({ cursor: 'invalid' })).status).toBe(400);
  });

  test('keeps bill history to five records and uses the pending-debt index for allocation', async () => {
    const customer = await account();
    const { order } = await sell(customer);
    for (let index = 0; index < 7; index += 1) expect((await pay(customer, 10)).status).toBe(201);
    const history = await owner('get', `/storefront/store-alpha/admin/orders/${order._id}/payments`);
    expect(history.body.data.data).toHaveLength(5);
    const next = await owner('get', `/storefront/store-alpha/admin/orders/${order._id}/payments`).query({ cursor: history.body.data.meta.nextCursor });
    expect(next.body.data.data).toHaveLength(2);
    expect(new Set([...history.body.data.data, ...next.body.data.data].map((row) => row.receiptKey)).size).toBe(7);
    expect(history.body.data.summary).toMatchObject({ pending: 30, totalPaid: 70 });
    await UdharEntry.init();
    const plan = await UdharEntry.find({ tenantId: ids.storeA, customerId: customer._id, type: 'debit', remainingAmount: { $gt: 0 } })
      .sort({ createdAt: 1, _id: 1 }).hint('pending_udhar_lots').explain('queryPlanner');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('pending_udhar_lots');
  });

  test('payment throttling is per account and does not consume a different cashier’s payment budget or block POS', async () => {
    const customer = await account();
    for (let i = 0; i < 30; i += 1) expect((await pay(customer, 0)).status).toBe(400);
    const limited = await pay(customer, 0);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const other = await request(app).post(`/api/v1/udhar/${customer._id}/credit`).set(auth(tokens.ownerB)).send({ amount: 0 });
    expect(other.status).toBe(400);
    await sell(null);
  });

  test('a pending COD order remains unpaid in the new bill summary', async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant));
    expect(placed.status).toBe(201);
    const detail = await owner('get', `/storefront/store-alpha/admin/orders/${placed.body.data.order._id}`);
    expect(detail.body.data.order.paymentSummary).toMatchObject({ state: 'unpaid', totalPaid: 0, pending: placed.body.data.order.pricing.grandTotal });
  });

  test.each(['self', 'staff', 'later'])('POS packing choice %s records responsibility and stays pending until handover', async (assignment) => {
    const target = assignment === 'self' ? ids.ownerA : assignment === 'staff' ? ids.staff : null;
    const { order } = await sell(null, 100, { saleType: 'parcha', packingAssigneeId: target });
    expect(order.status).toBe('accepted');
    expect(order.deliveredAt).toBeUndefined();
    expect(order.assignedTo || null).toBe(target?.toString() || null);
    if (assignment === 'later') return;
    const token = assignment === 'staff' ? tokens.staff : tokens.ownerA;
    const started = await request(app).post(`/api/v1/packing/session/${order._id}/start`).set(auth(token));
    expect(started.status).toBe(201);
    const item = started.body.data.session.items[0];
    for (const action of ['pick', 'pack']) expect((await request(app).patch(`/api/v1/packing/session/${order._id}/item/${item._id}`).set(auth(token)).send({ action })).status).toBe(200);
    expect((await request(app).post(`/api/v1/packing/session/${order._id}/complete`).set(auth(token)).send({})).status).toBe(200);
    const verified = await owner('post', `/packing/admin/session/${started.body.data.session._id}/verify`).send({ action: 'approve', nextStatus: 'ready_for_pickup' });
    expect(verified.status).toBe(200);
    expect(verified.body.data.order.status).toBe('ready_for_pickup');
    expect(verified.body.data.order.pricing.grandTotal).toBe(100);
    const handed = await owner('patch', `/storefront/store-alpha/admin/orders/${order._id}/status`).send({ status: 'delivered' });
    expect(handed.status).toBe(200);
    expect(handed.body.data.order.fulfillment).toMatchObject({ packingCompletedBy: { userId: String(target) }, deliveredBy: { userId: String(ids.ownerA) } });
  });
});

describe('supplier payment allocation and reconciliation', () => {
  const owner = (method, endpoint) => request(app)[method]('/api/v1' + endpoint).set(auth(tokens.ownerA));
  const makeSupplier = (details = {}) => Supplier.create({ tenantId: ids.storeA, name: 'Test Supplier', ...details });
  const pay = (endpoint, amount, key = randomUUID(), method = 'upi') =>
    owner('post', endpoint).set('Idempotency-Key', key).send({ amount, method, note: 'Supplier test payment' });
  const accountPayment = (supplier) => '/suppliers/' + supplier._id + '/payment';
  const invoicePayment = (purchase) => '/purchases/' + purchase._id + '/payment';

  const createInvoice = async ({ supplier, price = 1000, number = 'INV-1000', date, paidAmount = 0 } = {}) => {
    const { product, variant } = await createProduct({ stock: 100 });
    const response = await owner('post', '/purchases').send({
      supplierId: supplier?._id, invoiceNumber: number, purchaseDate: date, paidAmount,
      items: [{ productId: product._id, variantId: variant._id, quantity: 1, purchasePrice: price }],
    });
    expect(response.status).toBe(201);
    return response.body.data.purchase;
  };

  test('a ₹1,000 account payment leaves both the invoice and supplier at ₹0 due', async () => {
    const supplier = await makeSupplier();
    const invoice = await createInvoice({ supplier });
    const before = new Date();
    const response = await pay(accountPayment(supplier), 1000);
    expect(response.status).toBe(200);
    const { payment } = response.body.data;
    expect(payment).toMatchObject({
      amount: 1000, method: 'upi', allocations: [{ purchaseId: invoice._id, invoiceNumber: 'INV-1000', amount: 1000 }],
    });
    expect(Date.parse(payment.paidAt)).toBeGreaterThanOrEqual(before.getTime());
    expect(response.body.data.supplier).toMatchObject({ pendingAmount: 0, totalPaid: 1000, totalPurchased: 1000 });
    const saved = await PurchaseEntry.findById(invoice._id).lean();
    expect(saved).toMatchObject({
      paidAmount: 1000, pendingAmount: 0, paymentStatus: 'PAID',
      accountEntries: [{
        type: 'payment', amount: 1000, method: 'upi',
        postedAt: new Date(payment.paidAt), referenceId: new mongoose.Types.ObjectId(payment._id),
      }],
    });
    expect((await owner('get', '/suppliers/reconciliation')).body.data).toEqual([]);
  });

  test('allocates account payments oldest first and direct payments only to the requested invoice', async () => {
    const supplier = await makeSupplier();
    const recent = await createInvoice({ supplier, number: 'NEWER', price: 800, date: '2025-02-10' });
    const oldest = await createInvoice({ supplier, number: 'OLDER', price: 500, date: '2025-01-10' });
    const allocated = await pay(accountPayment(supplier), 700);
    expect(allocated.status).toBe(200);
    expect(allocated.body.data.payment.allocations).toEqual([
      { purchaseId: oldest._id, invoiceNumber: 'OLDER', amount: 500 },
      { purchaseId: recent._id, invoiceNumber: 'NEWER', amount: 200 },
    ]);
    expect(await PurchaseEntry.findById(oldest._id)).toMatchObject({ pendingAmount: 0, paymentStatus: 'PAID' });
    expect(await PurchaseEntry.findById(recent._id)).toMatchObject({ pendingAmount: 600, paymentStatus: 'PARTIAL' });

    const another = await createInvoice({ supplier, number: 'OLDEST', price: 250, date: '2024-12-01' });
    const direct = await pay(invoicePayment(recent), 300, randomUUID(), 'bank_transfer');
    expect(direct.status).toBe(200);
    expect(direct.body.data.payment).toMatchObject({
      method: 'bank_transfer', targetPurchaseId: recent._id,
      allocations: [{ purchaseId: recent._id, amount: 300 }],
    });
    expect(direct.body.data.purchase).toMatchObject({ paidAmount: 500, pendingAmount: 300, paymentStatus: 'PARTIAL' });
    expect(await PurchaseEntry.findById(another._id)).toMatchObject({ paidAmount: 0, pendingAmount: 250 });
    expect(await Supplier.findById(supplier._id)).toMatchObject({ totalPurchased: 1550, totalPaid: 1000, pendingAmount: 550 });
  });

  test('preserves the opening payment and replays concurrent retries without adding another allocation', async () => {
    const supplier = await makeSupplier();
    const invoice = await createInvoice({ supplier, paidAmount: 250 });
    expect(invoice).toMatchObject({ paidAmount: 250, pendingAmount: 750, paymentStatus: 'PARTIAL' });
    expect(invoice.accountEntries).toHaveLength(1);
    const key = randomUUID();
    const [first, retry] = await Promise.all([pay(invoicePayment(invoice), 750, key), pay(invoicePayment(invoice), 750, key)]);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(retry.body.data.payment._id).toBe(first.body.data.payment._id);
    expect(retry.body.data.payment.paidAt).toBe(first.body.data.payment.paidAt);
    expect((await pay(invoicePayment(invoice), 500, key)).status).toBe(409);
    expect((await pay(accountPayment(supplier), 750, key)).status).toBe(409);
    expect(await PurchaseEntry.findById(invoice._id)).toMatchObject({ pendingAmount: 0, paymentStatus: 'PAID' });
    const saved = await Supplier.findById(supplier._id);
    expect(saved).toMatchObject({ pendingAmount: 0, totalPaid: 1000 });
    expect(saved.paymentHistory).toHaveLength(2);
  });

  test('serializes independent invoice and account payments and prevents an overpayment', async () => {
    const supplier = await makeSupplier();
    const invoice = await createInvoice({ supplier });
    const [first, second] = await Promise.all([
      pay(invoicePayment(invoice), 1000), pay(accountPayment(supplier), 1000),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await Supplier.findById(supplier._id)).paymentHistory).toHaveLength(1);
    expect(await PurchaseEntry.findById(invoice._id)).toMatchObject({
      paidAmount: 1000, pendingAmount: 0, paymentStatus: 'PAID',
    });
  });

  test('keeps standalone invoice payments keyed and records their method and time without a supplier account', async () => {
    const invoice = await createInvoice();
    const key = randomUUID();
    const first = await pay(invoicePayment(invoice), 1000, key, 'cheque');
    const second = await pay(invoicePayment(invoice), 1000, key, 'cheque');
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.data.payment).toMatchObject({
      _id: first.body.data.payment._id, method: 'cheque', paidAt: first.body.data.payment.paidAt,
    });
    const saved = await PurchaseEntry.findById(invoice._id);
    expect(saved).toMatchObject({ paidAmount: 1000, pendingAmount: 0, paymentStatus: 'PAID' });
    expect(saved.accountEntries).toHaveLength(1);
  });

  test('rolls back invoice allocations when the supplier payment save fails', async () => {
    const supplier = await makeSupplier();
    const invoice = await createInvoice({ supplier });
    const save = vi.spyOn(Supplier.prototype, 'save').mockRejectedValueOnce(new Error('Injected supplier payment failure'));
    try {
      expect((await pay(accountPayment(supplier), 1000)).status).toBe(500);
      expect(save).toHaveBeenCalledOnce();
    } finally {
      save.mockRestore();
    }
    expect(await PurchaseEntry.findById(invoice._id)).toMatchObject({ pendingAmount: 1000, paidAmount: 0, accountEntries: [] });
    expect(await Supplier.findById(supplier._id)).toMatchObject({ pendingAmount: 1000, totalPaid: 0, paymentHistory: [] });
  });

  test('lists legacy discrepancies read-only and prevents another payment against an already reduced account', async () => {
    const supplier = await makeSupplier();
    const invoice = await createInvoice({ supplier });
    await Supplier.updateOne({ _id: supplier._id }, {
      $set: { pendingAmount: 0, totalPaid: 1000 },
      $push: { paymentHistory: { amount: 1000, method: 'cash', note: 'Old unallocated payment' } },
    });
    const foreign = await makeSupplier({ tenantId: ids.storeB, pendingAmount: 100 });
    const route = '/suppliers/reconciliation';
    const before = await Supplier.findById(supplier._id).lean();
    const report = await owner('get', route);
    expect(report.status).toBe(200);
    expect(report.body.data).toMatchObject([{
      supplierId: String(supplier._id),
      stored: { pendingAmount: 0, totalPaid: 1000 },
      expected: { pendingAmount: 1000, totalPaid: 0 },
      invoices: [{ purchaseId: invoice._id, expectedPending: 1000, storedStatus: 'UNPAID' }],
    }]);
    expect((await owner('get', route).query({ supplierId: foreign._id.toString() })).body.data).toEqual([]);
    expect((await pay(invoicePayment(invoice), 1000)).status).toBe(409);
    expect(await Supplier.findById(supplier._id).lean()).toEqual(before);
    expect(await PurchaseEntry.findById(invoice._id)).toMatchObject({ pendingAmount: 1000, paymentStatus: 'UNPAID' });
  });

  test('applies a supplier return credit to the invoice and leaves the payment history unchanged', async () => {
    const supplier = await makeSupplier();
    const invoice = await createInvoice({ supplier });
    const [item] = invoice.items;
    const created = await owner('post', '/returns').send({
      type: 'purchase_return', supplierId: supplier._id, purchaseEntryId: invoice._id,
      items: [{ productId: item.productId, variantId: item.variantId, qty: 1 }],
    });
    expect(created.status).toBe(201);
    const ret = created.body.data.return;
    expect((await owner('post', '/returns/' + ret._id + '/process').send({ action: 'approve' })).status).toBe(200);
    expect(await PurchaseEntry.findById(invoice._id)).toMatchObject({
      paymentStatus: 'PAID', pendingAmount: 0, paidAmount: 0,
      accountEntries: [{ type: 'return_credit', amount: 1000, referenceId: new mongoose.Types.ObjectId(ret._id) }],
    });
    expect(await Supplier.findById(supplier._id)).toMatchObject({ pendingAmount: 0, totalPurchased: 0, totalPaid: 0, paymentHistory: [] });
  });
});

describe('daily closing cash movements', () => {
  const owner = (method, path) => request(app)[method](`/api/v1${path}`).set(auth(tokens.ownerA));
  const dateKey = (value) => accountingDay(value).key.toISOString().slice(0, 10);
  const summary = async (date) => {
    const response = await owner('get', '/daily-closing/summary').query({ date });
    expect(response.status).toBe(200);
    return response.body.data;
  };
  const save = (date, closingCash, extra) => owner('post', '/daily-closing')
    .send({ date, openingCash: 1000, closingCash, ...extra });
  const invoice = async ({ supplier, amount, purchaseDate, paidAmount = 0, paymentMethod }) => {
    const { product, variant } = await createProduct();
    const response = await owner('post', '/purchases').send({
      supplierId: supplier?._id, purchaseDate, paidAmount, paymentMethod,
      items: [{ productId: product._id, variantId: variant._id, quantity: 1, purchasePrice: amount }],
    });
    expect(response.status).toBe(201);
    return response.body.data.purchase;
  };

  test('A08 posts a split supplier payment once on its payment day and closes at ₹900', async () => {
    const supplier = await Supplier.create({ tenantId: ids.storeA, name: 'Cash Supplier' });
    const yesterday = dateKey(new Date(Date.now() - 86400000));
    const first = await invoice({ supplier, amount: 60, purchaseDate: yesterday });
    const second = await invoice({ supplier, amount: 500, purchaseDate: yesterday });
    await PurchaseEntry.collection.updateMany(
      { _id: { $in: [first._id, second._id].map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { createdAt: new Date(yesterday) } }
    );
    const key = randomUUID();
    const pay = () => owner('post', `/suppliers/${supplier._id}/payment`)
      .set('Idempotency-Key', key).send({ amount: 100, method: 'cash' });
    const payment = await pay();
    expect(payment.status).toBe(200);
    expect(payment.body.data.payment.allocations.map(({ amount }) => amount)).toEqual([60, 40]);
    expect((await pay()).body.data.payment._id).toBe(payment.body.data.payment._id);
    const today = dateKey(payment.body.data.payment.paidAt);
    expect((await summary(yesterday)).movements.cash.supplierPayments).toBe(0);
    expect((await summary(today)).movements.cash.supplierPayments).toBe(100);
    const closed = await save(today, 900, { expenses: [] });
    expect(closed.status).toBe(200);
    expect(closed.body.data.closing).toMatchObject({
      closingCash: 900, expectedClosingCash: 900, cashDifference: 0, supplierPayments: 100,
      movements: { cash: { net: -100 } },
    });
  });

  test('reconciles mixed movements and excludes manual duplicates, Udhar adjustments and other tenants', async () => {
    const day = '2025-04-02';
    const inDay = new Date('2025-04-01T18:30:00Z');
    const nextDay = new Date('2025-04-02T18:30:00Z');
    const opening = new Date('2025-04-01T18:29:59.999Z');
    const order = (overrides) => ({
      tenantId: ids.storeA, orderType: 'home_delivery', status: 'delivered', paymentStatus: 'paid',
      paymentMethod: 'cod', pricing: { grandTotal: 120 }, createdAt: opening,
      deliveredAt: inDay, ...overrides,
    });
    await Order.collection.insertMany([
      order({ orderNumber: 'COD-LEGACY' }),
      order({ orderNumber: 'UPI', paymentMethod: 'upi_qr', paidAt: inDay, receivedAmount: 200 }),
      order({ orderNumber: 'BANK', paymentMethod: 'bank_transfer', paymentProof: { verifiedAt: inDay } }),
      order({ orderNumber: 'NEXT', paidAt: nextDay, receivedAmount: 900 }),
      order({ orderNumber: 'UNPAID', paymentStatus: 'pending', createdAt: inDay }),
      order({ orderNumber: 'FOREIGN', tenantId: ids.storeB, paidAt: inDay, receivedAmount: 900 }),
    ]);
    const account = await UdharCustomer.create({ tenantId: ids.storeA, name: 'Customer', balance: 500 });
    for (const [method, amount] of [['cash', 50.11], ['upi', 25], ['bank_transfer', 40]]) {
      const res = await owner('post', `/udhar/${account._id}/credit`).send({ method, amount, date: day });
      expect(res.status).toBe(201);
      expect(res.body.data.entry.method).toBe(method);
    }
    await UdharEntry.create([
      { tenantId: ids.storeA, customerId: account._id, date: inDay, type: 'credit', referenceType: 'pos_order', amount: 300 },
      { tenantId: ids.storeA, customerId: account._id, date: inDay, type: 'credit', amount: 5 },
      { tenantId: ids.storeA, customerId: account._id, date: inDay, type: 'debit', amount: 600 },
    ]);
    const ret = (refundMethod, netRefund, extra) => ({
      tenantId: ids.storeA, type: 'customer_return', status: 'processed', refundMethod, netRefund, processedAt: inDay,
      createdBy: ids.ownerA, createdByName: 'Owner Alpha', ...extra,
    });
    await Return.create([
      ret('cash', 15.01), ret('upi', 22), ret('store_credit', 55),
      ret('cash', 500, { status: 'pending' }), ret('cash', 999, { type: 'purchase_return' }),
    ]);
    for (const [method, amount] of [['cash', 5.10], ['upi', 30], ['bank_transfer', 20]]) {
      expect((await owner('post', '/expenses').send({ category: 'transport', amount, method, date: day })).status).toBe(201);
    }
    await Expense.create([
      { tenantId: ids.storeA, category: 'other', amount: 3, date: inDay },
      { tenantId: ids.storeA, category: 'other', amount: 200, date: inDay, method: 'cash', isActive: false },
      { tenantId: ids.storeB, category: 'other', amount: 500, date: inDay, method: 'cash' },
    ]);
    const walkIn = await invoice({ amount: 200, purchaseDate: '2025-04-01' });
    await PurchaseEntry.collection.updateOne({ _id: new mongoose.Types.ObjectId(walkIn._id) }, {
      $set: { createdAt: opening, accountEntries: [
        { type: 'payment', referenceId: new mongoose.Types.ObjectId(), postedAt: inDay, amount: 20, method: 'bank_transfer' },
        { type: 'payment', referenceId: new mongoose.Types.ObjectId(), postedAt: inDay, amount: 30, method: 'upi' },
        { type: 'return_credit', referenceId: new mongoose.Types.ObjectId(), postedAt: inDay, amount: 50 },
      ] },
    });
    const totals = await summary(day);
    expect(totals).toMatchObject({
      returnsTotal: 92.01, supplierPayments: 50, ordersCount: 1,
      movements: {
        cash: { sales: 120, udharCollections: 50.11, refunds: 15.01, expenses: 5.1, inflow: 170.11, outflow: 20.11, net: 150 },
        upi: { sales: 200, udharCollections: 25, supplierPayments: 30, refunds: 22, expenses: 30, net: 143 },
        bank: { sales: 120, udharCollections: 40, supplierPayments: 20, expenses: 20, net: 120 },
        unclassified: { udharCollections: 5, expenses: 3, net: 2 },
      },
    });
    const rejected = await save(day, 1150, { expenses: [{ description: 'Transport', amount: 5.10, category: 'other' }] });
    expect(rejected.status).toBe(400);
    expect(await DailyClosing.countDocuments()).toBe(0);
    const [first, replay] = await Promise.all([save(day, 1150), save(day, 1150)]);
    for (const response of [first, replay]) {
      expect(response.status).toBe(200);
      expect(response.body.data.closing).toMatchObject({ expectedClosingCash: 1150, cashDifference: 0 });
      expect(response.body.data.closing.movements).toEqual(totals.movements);
    }
    expect(await DailyClosing.countDocuments()).toBe(1);
    expect((await summary('2025-04-03')).movements.cash.sales).toBe(900);
  });

  test('records paid COD at delivery and retains the original receipt amount', async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant));
    expect(placed.status).toBe(201);
    const { order } = placed.body.data;
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(order._id) }, {
      $set: { status: 'out_for_delivery', createdAt: new Date('2025-04-01T12:00:00Z') },
    });
    const delivered = await owner('patch', `/storefront/store-alpha/admin/orders/${order._id}/status`)
      .send({ status: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.order).toMatchObject({
      receivedAmount: order.pricing.grandTotal, paidAt: delivered.body.data.order.deliveredAt,
    });
    const paidDay = dateKey(delivered.body.data.order.paidAt);
    expect((await summary('2025-04-01')).cashSales).toBe(0);
    await Order.updateOne({ _id: order._id }, { $set: { 'pricing.grandTotal': 1 } });
    expect((await summary(paidDay)).cashSales).toBe(order.pricing.grandTotal);
  });
});

describe('daily closing finalization and corrections', () => {
  test('suggests opening cash from the last finalized count and intervening cash only', async () => {
    const headers = auth(tokens.ownerA);
    const endpoint = '/api/v1/daily-closing';
    const requestClosing = (body) => request(app).post(endpoint).set(headers).send(body);
    await requestClosing({ date: '2025-01-01', openingCash: 100, closingCash: 100 }).expect(200);
    await requestClosing({ date: '2025-01-02', status: 'draft', movement: {
      operationId: randomUUID(), type: 'owner_addition', amount: 50, method: 'cash', description: 'Owner float',
    } }).expect(200);
    await request(app).post('/api/v1/expenses').set(headers).send({ category: 'rent', date: '2025-01-02', amount: 40, method: 'upi' }).expect(201);
    const next = await request(app).get(endpoint + '/summary').set(headers).query({ date: '2025-01-03' }).expect(200);
    expect(next.body.data).toMatchObject({ suggestedOpeningCash: 150, closing: null });
  });

  test('counts only recorded salary payments and cash transfer legs, preserves incomplete drafts, and rejects stale reviews', async () => {
    const date = accountingDay().businessDate;
    const api = '/api/v1';
    const headers = auth(tokens.ownerA);
    const save = (body) => request(app).post(api + '/daily-closing').set(headers).send({ date, status: 'draft', ...body });
    const summary = () => request(app).get(api + '/daily-closing/summary').set(headers).query({ date });
    const salary = await mongoose.model('StaffSalary').create({ tenantId: ids.storeA, staffId: ids.staff, staffName: 'Counter Staff', monthYear: date.slice(0, 7), monthlySalary: 1000 });
    const salaryPayment = { amount: 25.25, method: 'cash', operationId: randomUUID() };
    const pay = () => request(app).post(api + '/salary/' + salary._id + '/payment').set(headers).send(salaryPayment);
    await pay().expect(200);
    await pay().expect(200);
    const draft = (await save({ openingCash: null, closingCash: null }).expect(200)).body.data.closing;
    expect(draft).toMatchObject({ openingCash: null, closingCash: null, cashDifference: null });
    const finish = (version, reviewKey) => request(app).post(api + '/daily-closing/' + draft._id + '/finalize').set(headers).send({ version, reviewKey });
    await finish(draft.version).expect(400);
    const negative = (await save({ openingCash: 0, closingCash: 0, version: draft.version }).expect(200)).body.data.closing;
    expect(negative).toMatchObject({ expectedClosingCash: -25.25, cashDifference: null });
    await finish(negative.version).expect(400);
    const move = { operationId: randomUUID(), type: 'bank_withdrawal', method: 'cash', amount: 50.25, description: 'Cash from bank' };
    const next = (await save({ version: negative.version, closingCash: 25, movement: move }).expect(200)).body.data.closing;
    await save({ version: negative.version, closingCash: 25, movement: move }).expect(200);
    const before = (await summary().expect(200)).body.data;
    expect(before).toMatchObject({ totalSales: 0, movements: { cash: { salaries: 25.25, otherReceived: 50.25, net: 25 }, bank: { otherPaid: 50.25 } } });
    const expense = { category: 'transport', name: 'Delivery trip', paidTo: 'Driver', date, amount: 5, method: 'cash', operationId: randomUUID() };
    await mongoose.model('Expense').init();
    const recordExpense = () => request(app).post(api + '/expenses').set(headers).send(expense);
    await recordExpense().expect(201);
    await recordExpense().expect(200);
    const stats = await request(app).get(api + '/expenses/stats').set(headers).query({ startDate: date, endDate: date, search: 'Driver', method: 'cash' }).expect(200);
    expect(stats.body.data).toMatchObject({ total: 5, cash: 5, count: 1 });
    const details = await request(app).get(api + '/daily-closing/transactions').set(headers).query({ date, kind: 'paid', channel: 'cash' }).expect(200);
    expect(details.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'salaries', amount: 25.25, party: 'Counter Staff' }),
      expect.objectContaining({ type: 'expenses', amount: 5, party: 'Driver' }),
    ]));
    await finish(next.version, before.reviewKey).expect(409);
    const after = (await summary().expect(200)).body.data;
    await finish(next.version, after.reviewKey).expect(400);
    const counted = (await save({ version: next.version, notes: '₹5 extra verified after recount' }).expect(200)).body.data.closing;
    const finalized = (await finish(counted.version, after.reviewKey).expect(200)).body.data.closing;
    expect(finalized).toMatchObject({ expectedClosingCash: 20, cashDifference: 5, status: 'closed' });
  });

  const date = '2025-04-02';
  const owner = (method, suffix = '', token = tokens.ownerA) =>
    request(app)[method](`/api/v1/daily-closing${suffix}`).set(auth(token));
  const save = (values) => owner('post').send({ date, openingCash: 500, closingCash: 500, ...values });
  const finalize = (id, version) => owner('post', `/${id}/finalize`).send({ version });
  const correction = (id, body, token) => owner('post', `/${id}/corrections`, token).send(body);

  test('A11 leaves the ₹500 finalization visible after normal ₹20 draft and closed saves', async () => {
    const closed = await save({ status: 'closed' });
    expect(closed.status).toBe(200);
    const original = closed.body.data.closing;
    expect(original).toMatchObject({ status: 'closed', closingCash: 500, version: 1 });
    for (const status of ['draft', 'closed']) {
      expect((await save({ status, openingCash: 20, closingCash: 20, version: original.version })).status).toBe(409);
    }
    expect((await save({ status: 'draft', openingCash: 20, closingCash: 20 })).status).toBe(409);
    expect((await save({ status: 'closed' })).body.data.closing).toEqual(original);
    expect((await owner('get').query({ limit: 10 })).body.data).toEqual([original]);
    expect((await owner('get', '/summary').query({ date })).body.data.closing).toEqual(original);
  });

  test('requires the current draft version and finalizes only through the finalize action', async () => {
    const created = await save({ status: 'draft' });
    expect(created.status).toBe(200);
    const { _id, version } = created.body.data.closing;
    expect((await save({ status: 'draft', closingCash: 123 })).status).toBe(409);
    const edit = await save({ status: 'draft', version, closingCash: 475, notes: 'Recounted' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.closing).toMatchObject({ _id, version: version + 1, status: 'draft', closingCash: 475 });
    expect((await save({ status: 'draft', version, closingCash: 20 })).status).toBe(409);
    expect((await finalize(_id, version)).status).toBe(409);
    expect((await save({ status: 'closed', version: version + 1 })).status).toBe(409);
    expect((await correction(_id, { version: version + 1, reason: 'Too early' })).status).toBe(409);
    expect((await owner('get', `/${_id}`)).body.data.closing).toEqual(edit.body.data.closing);
  });

  test('concurrent finalize and later retries return the same frozen snapshot', async () => {
    const draft = (await save({ status: 'draft', closingCash: 490 })).body.data.closing;
    await Expense.create({ tenantId: ids.storeA, category: 'other', amount: 10, method: 'cash', date: new Date(date) });
    const [first, second] = await Promise.all([finalize(draft._id, draft.version), finalize(draft._id, draft.version)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const closed = first.body.data.closing;
    expect(closed).toMatchObject({
      _id: draft._id, status: 'closed', version: draft.version + 1,
      finalizedFromVersion: draft.version, expectedClosingCash: 490, closingCash: 490, cashDifference: 0,
    });
    expect(second.body.data.closing).toEqual(closed);
    await Expense.create({ tenantId: ids.storeA, category: 'other', amount: 5, method: 'cash', date: new Date(date) });
    expect((await finalize(draft._id, draft.version)).body.data.closing).toEqual(closed);
    expect((await finalize(draft._id, closed.version)).status).toBe(409);
    expect((await owner('get', `/${draft._id}`)).body.data.closing).toEqual(closed);
    expect(await DailyClosing.countDocuments()).toBe(1);
  });

  test('appends owner-only audited corrections with the previous and revised snapshots', async () => {
    const draft = (await save({ status: 'draft', notes: 'Original note' })).body.data.closing;
    const { closing: original } = (await finalize(draft._id, draft.version)).body.data;
    const payload = { version: original.version, closingCash: 490, notes: 'Revised', reason: 'Recount found a shortage' };
    expect((await correction(original._id, payload, tokens.staff)).status).toBe(403);
    expect((await correction(original._id, payload, tokens.ownerB)).status).toBe(404);
    expect((await correction(original._id, { ...payload, reason: '   ' })).status).toBe(400);
    const [first, competing] = await Promise.all([
      correction(original._id, payload),
      correction(original._id, { ...payload, closingCash: 465 }),
    ]);
    expect([first.status, competing.status].sort()).toEqual([201, 409]);
    const entry = [first, competing].find(({ status }) => status === 201).body.data.correction;
    expect(entry).toMatchObject({
      actorId: String(ids.ownerA), actorName: 'Owner Alpha', version: original.version + 1,
      reason: payload.reason, correctedAt: expect.any(String),
      previous: { closingCash: 500, notes: 'Original note', cashDifference: 0 },
      revised: { closingCash: expect.any(Number), notes: 'Revised', expectedClosingCash: 500 },
    });
    expect(entry.revised.cashDifference).toBe(entry.revised.closingCash - 500);
    const later = await correction(original._id, { version: entry.version, closingCash: 495, reason: 'Second recount' });
    expect(later.status).toBe(201);
    expect(later.body.data.correction.previous).toEqual(entry.revised);
    const read = (await owner('get', `/${original._id}`)).body.data.closing;
    expect(read).toEqual({ ...original, corrections: [entry, later.body.data.correction] });
    expect((await finalize(draft._id, draft.version)).body.data.closing).toEqual(original);
    const audit = await AuditLog.find({ action: 'daily_closing_corrected', tenantId: ids.storeA }).lean();
    expect(audit).toHaveLength(2);
    expect(audit).toContainEqual(expect.objectContaining({
      performedBy: expect.objectContaining({ userId: ids.ownerA }),
      changes: expect.objectContaining({ correctionId: new mongoose.Types.ObjectId(entry._id), reason: entry.reason }),
    }));
  });

  test('keeps a legacy finalized record at the local-midnight key immutable and versionable', async () => {
    const day = accountingDay(date);
    const { insertedId } = await DailyClosing.collection.insertOne({
      tenantId: ids.storeA, date: day.start, status: 'closed', closedBy: ids.ownerA, closedByName: 'Original Owner',
      openingCash: 500, closingCash: 500, expectedClosingCash: 500, cashDifference: 0,
    });
    expect((await save({ status: 'draft', closingCash: 20 })).status).toBe(409);
    const corrected = await correction(insertedId, { version: 0, closingCash: 495, reason: 'Reconciled legacy cash' });
    expect(corrected.status).toBe(201);
    const read = (await owner('get', '/summary').query({ date })).body.data.closing;
    expect(read).toMatchObject({ _id: String(insertedId), closingCash: 500, status: 'closed', version: 0,
      corrections: [{ version: 1, previous: { closingCash: 500 }, revised: { closingCash: 495 } }],
    });
    expect(await DailyClosing.countDocuments()).toBe(1);
  });
});

describe('store business dates', () => {
  const owner = (method, path, token = tokens.ownerA) => request(app)[method](`/api/v1${path}`).set(auth(token));
  const insertSales = (sales, tenantId = ids.storeA) => Order.collection.insertMany(sales.map(([orderNumber, date, amount]) => ({
    tenantId, orderNumber, orderType: 'counter', status: 'delivered',
    paymentMethod: 'counter', paymentStatus: 'paid',
    createdAt: new Date(date), paidAt: new Date(date), deliveredAt: new Date(date),
    receivedAmount: amount, pricing: { grandTotal: amount },
    items: [{ name: 'Rice', quantity: 1, price: amount }],
  })));

  test('A13 counts the 19:00 UTC sale on 12 November only across closing, sales and order exports', async () => {
    await insertSales([
      ['BEFORE', '2025-11-11T18:29:59.999Z', 7],
      ['MIDNIGHT', '2025-11-11T18:30:00.000Z', 20],
      ['A13', '2025-11-11T19:00:00.000Z', 100],
      ['AFTER', '2025-11-12T18:30:00.000Z', 30],
    ]);
    await insertSales([['FOREIGN', '2025-11-11T19:00:00.000Z', 900]], ids.storeB);
    for (const [date, sales, names] of [
      ['2025-11-11', 7, ['BEFORE']], ['2025-11-12', 120, ['A13', 'MIDNIGHT']], ['2025-11-13', 30, ['AFTER']],
    ]) {
      const day = await owner('get', '/daily-closing/summary').query({ date });
      expect(day.status).toBe(200);
      expect(day.body.data).toMatchObject({ businessDate: date, timeZone: 'Asia/Kolkata', cashSales: sales });
      const daily = await owner('get', '/reports/daily-sales').query({ date });
      expect(daily.status).toBe(200);
      expect(daily.body.data).toMatchObject({ businessDate: date, total: sales });
      if (date === '2025-11-12') expect(daily.body.data.hours[0]).toMatchObject({ sales: 120, orders: 2 });

      const download = await owner('get', '/backup/orders').query({ from: date, to: date });
      expect(download.status).toBe(200);
      expect(download.body.orders.map(({ orderNumber }) => orderNumber)).toEqual(names);
      if (date === '2025-11-12') expect(download.body.orders[0].createdAt).toBe('2025-11-11T19:00:00.000Z');
      const pos = await owner('get', '/pos/orders').query({ date });
      expect(pos.body.data.map(({ orderNumber }) => orderNumber)).toEqual(names);
    }
    const toOnly = await owner('get', '/backup/orders').query({ to: '2025-11-12' });
    expect(toOnly.body.orders.map(({ orderNumber }) => orderNumber)).toEqual(['A13', 'MIDNIGHT', 'BEFORE']);
    const fromOnly = await owner('get', '/backup/orders').query({ from: '2025-11-12' });
    expect(fromOnly.body.orders.map(({ orderNumber }) => orderNumber)).toEqual(['AFTER', 'A13', 'MIDNIGHT']);
    expect((await owner('get', '/backup/orders').query({ from: '2025-11-13', to: '2025-11-12' })).status).toBe(400);
    expect((await owner('get', '/reports/daily-sales').query({ date: '2025-02-30' })).status).toBe(400);
    expect((await owner('get', '/reports/daily-sales').query({ date: '2025-02-30T12:00:00Z' })).status).toBe(400);
    const products = await owner('get', '/reports/product-sales').query({ startDate: '2025-11-12', endDate: '2025-11-12' });
    expect(products.body.data.products).toMatchObject([{ totalRevenue: 120, orderCount: 2 }]);
  });

  test('keeps month-end and year-end orders in the correct local reporting bucket', async () => {
    await insertSales([
      ['NOV-LAST', '2025-11-30T18:29:59.999Z', 10],
      ['DEC-FIRST', '2025-11-30T18:30:00.000Z', 20],
      ['DEC-LAST', '2025-12-31T18:29:59.999Z', 30],
      ['JAN-FIRST', '2025-12-31T18:30:00.000Z', 40],
    ]);
    const november = (await owner('get', '/reports/monthly-sales').query({ year: 2025, month: 10 })).body.data;
    expect(november.total).toBe(10);
    expect(november.days).toHaveLength(30);
    expect(november.days.at(-1)).toMatchObject({ day: 30, sales: 10 });
    const december = (await owner('get', '/reports/monthly-sales').query({ year: 2025, month: 11 })).body.data;
    expect(december.total).toBe(50);
    expect(december.days[0]).toMatchObject({ day: 1, sales: 20 });
    expect(december.days.at(-1)).toMatchObject({ day: 31, sales: 30 });
    const year = (await owner('get', '/reports/yearly-sales').query({ year: 2025 })).body.data;
    expect(year.total).toBe(60);
    expect(year.months.at(-1)).toMatchObject({ month: 12, sales: 50 });
    expect((await owner('get', '/reports/yearly-sales').query({ year: 2026 })).body.data.total).toBe(40);
  });

  test('uses the stored timezone on a DST day and treats canonical closing keys as calendar labels', async () => {
    const date = '2025-03-09';
    await Store.updateOne({ _id: ids.storeA }, { $set: { 'settings.timezone': 'America/New_York' } });
    await insertSales([
      ['BEFORE', '2025-03-09T04:59:59.999Z', 10],
      ['START', '2025-03-09T05:00:00.000Z', 20],
      ['LAST', '2025-03-10T03:59:59.999Z', 30],
      ['NEXT', '2025-03-10T04:00:00.000Z', 40],
    ]);
    const day = (await owner('get', '/reports/daily-sales').query({ date })).body.data;
    expect(day).toMatchObject({ total: 50, timeZone: 'America/New_York' });
    expect(day.hours[0].sales).toBe(20);
    expect(day.hours[23].sales).toBe(30);
    const outflow = await owner('post', '/expenses').send({ category: 'rent', amount: 5, method: 'cash', date });
    expect(outflow.body.data.expense.date).toBe('2025-03-09T05:00:00.000Z');
    const created = await owner('post', '/daily-closing').send({ date, status: 'draft', openingCash: 0, closingCash: 45 });
    const draft = created.body.data.closing;
    expect(draft).toMatchObject({ date: '2025-03-09T00:00:00.000Z', businessDate: date, cashSales: 50 });
    const finalized = await owner('post', `/daily-closing/${draft._id}/finalize`).send({ version: draft.version });
    expect(finalized.status).toBe(200);
    expect(finalized.body.data.closing).toMatchObject({ businessDate: date, expectedClosingCash: 45, cashDifference: 0 });
    const repeatedMidnight = accountingDay('2025-11-02', 'America/Havana');
    expect(repeatedMidnight.start.toISOString()).toBe('2025-11-02T04:00:00.000Z');
    expect(repeatedMidnight.end.toISOString()).toBe('2025-11-03T05:00:00.000Z');
  });

  test('reports legacy key collisions by tenant without changing stored dates', async () => {
    const date = '2025-11-12';
    const day = accountingDay(date);
    const make = (tenantId, storedKey, status) => ({
      tenantId, date: storedKey, status, closedBy: ids.ownerA, closedByName: 'Owner Alpha',
    });
    const keys = await DailyClosing.collection.insertMany([
      make(ids.storeA, day.start, 'closed'),
      make(ids.storeA, day.key, 'draft'),
      make(ids.storeA, new Date('2025-11-12T07:12:00.000Z'), 'closed'),
      make(ids.storeB, day.key, 'closed'),
    ]);
    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../scripts/review-closing-dates.js', import.meta.url)),
    ], { env: { ...process.env, MONGODB_URI: replSet.getUri() } });
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({
      scanned: 4,
      legacyKeys: [{ tenantId: String(ids.storeA), closingId: String(keys.insertedIds[0]), businessDate: date }],
      collisions: [{ tenantId: String(ids.storeA), businessDate: date, proposedKey: day.key.toISOString(), records: [
        { storedKey: day.start.toISOString(), keyType: 'legacy_local_midnight' },
        { storedKey: day.key.toISOString(), keyType: 'utc_date_key' },
      ] }],
      unresolved: [{ closingId: String(keys.insertedIds[2]), reason: 'unrecognized_date_key' }],
    });
    expect(report.collisions).toHaveLength(1);
    expect((await DailyClosing.findById(keys.insertedIds[0])).date).toEqual(day.start);
    const summary = (await owner('get', '/daily-closing/summary').query({ date })).body.data;
    expect(summary.closing).toMatchObject({ businessDate: date, status: 'closed', _id: String(keys.insertedIds[0]) });
    expect((await owner('post', '/daily-closing').send({ date, status: 'draft' })).status).toBe(409);
    expect(await DailyClosing.countDocuments()).toBe(4);
  });
});

describe('POS pricing and transaction safety', () => {
  test('uses server pricing and rejects unauthorized price and discount manipulation', async () => {
    const { product, variant } = await createProduct({ stock: 10 });
    const base = { items: [{ productId: product._id.toString(), variantId: variant._id.toString(), qty: 1 }], paymentMethod: 'counter', saleType: 'instant' };
    const normal = await request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send(base);
    expect(normal.status).toBe(201);
    expect(normal.body.data.order.items[0].price).toBe(90);
    expect((await request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send({ ...base, items: [{ ...base.items[0], price: 1 }] })).status).toBe(403);
    expect((await request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send({ ...base, overallDiscount: 1 })).status).toBe(403);
    const permitted = await request(app).post('/api/v1/pos/order').set(auth(tokens.discountStaff)).send({ ...base, items: [{ ...base.items[0], price: 80 }] });
    expect(permitted.status).toBe(201);
    expect(permitted.body.data.order.items[0].price).toBe(80);
  });

  test('prevents POS overselling and completely rolls back a failed multi-item sale', async () => {
    const one = await createProduct({ name: 'One Left', stock: 1 });
    const sale = { items: [{ productId: one.product._id.toString(), variantId: one.variant._id.toString(), qty: 1 }], paymentMethod: 'counter', saleType: 'instant' };
    const concurrent = await Promise.all([
      request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send(sale),
      request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send(sale),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await Product.findById(one.product._id)).variants.id(one.variant._id).stock).toBe(0);

    const first = await createProduct({ name: 'Rollback First', stock: 3 });
    const second = await createProduct({ name: 'Rollback Second', stock: 0 });
    const beforeOrders = await Order.countDocuments();
    const failed = await request(app).post('/api/v1/pos/order').set(auth(tokens.staff)).send({
      items: [
        { productId: first.product._id.toString(), variantId: first.variant._id.toString(), qty: 2 },
        { productId: second.product._id.toString(), variantId: second.variant._id.toString(), qty: 1 },
      ],
      paymentMethod: 'counter', saleType: 'instant',
    });
    expect(failed.status).toBe(409);
    expect((await Product.findById(first.product._id)).variants.id(first.variant._id).stock).toBe(3);
    expect(await Order.countDocuments()).toBe(beforeOrders);
  });

  test('rejects invalid quantities, methods, and sale types', async () => {
    const { product, variant } = await createProduct();
    const endpoint = request(app).post('/api/v1/pos/order').set(auth(tokens.staff));
    expect((await endpoint.send({ items: [{ productId: product._id, variantId: variant._id, qty: -1 }], paymentMethod: 'cash', saleType: 'invalid' })).status).toBe(400);
  });
});

test('returns an explicit missing-store error instead of an empty catalog', async () => {
  const storefront = await request(app).get('/api/v1/storefront/not-a-store');
  const products = await request(app).get('/api/v1/storefront/not-a-store/products');
  expect(storefront.status).toBe(404);
  expect(products.status).toBe(404);
  expect(storefront.body.message).toMatch(/store not found/i);
});

describe('encrypted tenant backup and isolated restore', () => {
  test('exports the full tenant, files and 5,001 ledger rows and verifies the recovered state', async () => {
    const { inspectTenantBackup } = await import('../src/services/tenantBackup.service.js');
    const { archiveModels, decodeDocument } = await import('../src/services/backupModels.js');
    const { readEncryptedBackup } = await import('../src/services/backupEncryption.js');
    const { assertRestoreReady, validateRecoveryArchive } = await import('../src/services/backupRestore.js');
    const tenantId = String(ids.storeA);
    const planId = new mongoose.Types.ObjectId();
    const media = Buffer.from('disposable public product bytes');
    const proof = Buffer.from('disposable private payment bytes');
    const legacy = Buffer.from('disposable legacy payment bytes');
    const image = '/uploads/' + tenantId + '/rice.webp';
    const screenshotFile = tenantId + '/proof.webp';
    const screenshotUrl = '/uploads/legacy-proof.png';
    await mkdir(path.join(sourceUploads, 'public', tenantId), { recursive: true });
    await mkdir(path.join(sourceUploads, 'private', 'payment-proofs', tenantId), { recursive: true });
    await writeFile(path.join(sourceUploads, 'public', tenantId, 'rice.webp'), media);
    await writeFile(path.join(sourceUploads, 'private', 'payment-proofs', tenantId, 'proof.webp'), proof);
    await writeFile(path.join(sourceUploads, 'legacy-proof.png'), legacy);
    await archiveModels.plans.create({ _id: planId, name: 'trial', displayName: 'Trial plan' });
    await Store.updateOne({ _id: ids.storeA }, { $set: {
      'settings.orderPrefix': 'TEST', 'branding.logo': image, 'subscription.planId': planId,
    } });
    const { product, variant } = await createProduct({ stock: 5001 });
    await Product.updateOne({ _id: product._id }, { $set: { images: [{ url: image }] } });
    const order = await Order.create({
      tenantId: ids.storeA, customerId: ids.customerA, orderType: 'self_pickup',
      items: [{ productId: product._id, variantId: variant._id, name: 'Rice', quantity: 1, mrp: 100, price: 90, image }],
      customerInfo: customerInfo(), pricing: { subtotal: 90, tax: 9, grandTotal: 99 },
      paymentStatus: 'paid', paymentMethod: 'upi_qr', guestAccessTokenHash: 'guest-token-fixture',
      paymentProof: { screenshotFile, screenshotUrl, utrNumber: 'UTR-FIXTURE', verifiedBy: ids.ownerA },
    });
    const debt = await archiveModels.udhar.create({ tenantId: ids.storeA, userId: ids.customerA, name: 'Backup Buyer', balance: 75 });
    await archiveModels.udharEntries.create([
      { tenantId: ids.storeA, customerId: debt._id, type: 'debit', amount: 99, balanceAfter: 99, referenceType: 'order', referenceId: order._id },
      { tenantId: ids.storeA, customerId: debt._id, type: 'credit', amount: 24, balanceAfter: 75, referenceType: 'manual' },
    ]);
    await archiveModels.returns.create({
      tenantId: ids.storeA, type: 'customer_return', orderId: order._id, createdBy: ids.ownerA, createdByName: 'Fixture',
    });
    await archiveModels.dailyClosings.create({
      tenantId: ids.storeA, date: new Date('2026-11-20T00:00:00Z'), closedBy: ids.ownerA, closedByName: 'Fixture', upiSales: 99,
    });
    await archiveModels.auditLogs.create({
      tenantId: ids.storeA, action: 'store_updated', changes: { nested: { access_token: 'legacy-secret-fixture' } },
    });
    await StockLedger.collection.insertMany(Array.from({ length: 5001 }, (_, index) => ({
      tenantId: ids.storeA, productId: product._id, variantId: variant._id, movementType: 'ADJUSTMENT_ADD',
      quantityChange: 1, balanceBefore: index, balanceAfter: index + 1, createdBy: ids.ownerA,
      ...(index === 5000 && { referenceType: 'Order', referenceId: order._id }),
      createdAt: new Date(Date.UTC(2026, 0, 1) + index),
    })));
    await createProduct({ tenantId: ids.storeB, name: 'Other tenant product' });

    const report = await inspectTenantBackup(tenantId);
    expect(report).toMatchObject({
      orderTotalMinor: 9900, stockUnits: 5001, udharBalanceMinor: 7500, discrepancies: [], mediaIssues: [],
    });
    expect(report.counts.stockLedger).toBe(5001);
    const response = await request(app).get('/api/v1/backup/full?tenantId=' + ids.storeB).set(auth(tokens.ownerA));
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(/attachment/);
    const owner = response.body;
    expect(owner).toMatchObject({ version: '2.0', kind: 'owner', tenantId, counts: { stockLedger: 5001, udharEntries: 2, orders: 1, returns: 1, dailyClosings: 1 } });
    expect(owner.store.settings.orderPrefix).toBe('TEST');
    expect(owner.data.products.map((item) => item.name)).toEqual(['Rice']);
    expect(owner.data.users.every((user) => !('password' in user) && !('tokenVersion' in user))).toBe(true);
    expect(owner.data.orders[0]).not.toHaveProperty('guestAccessTokenHash');
    expect(owner.data.auditLogs[0].changes.nested).toEqual({});
    expect(owner.data).not.toHaveProperty('refreshTokens');
    expect(owner.manifest.collections.stockLedger).toMatchObject({ count: 5001, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const key = randomBytes(32);
    const vault = path.join(backupTestRoot, 'vault');
    const keyFile = path.join(backupTestRoot, 'key');
    await mkdir(vault, { mode: 0o700 });
    await writeFile(keyFile, key.toString('base64'), { mode: 0o600 });
    const runBackup = async (...args) => {
      const { stdout } = await promisify(execFile)(process.execPath, ['scripts/backup.js', ...args], {
        env: {
          ...process.env,
          BACKUP_SOURCE_URI: replSet.getUri(), BACKUP_SOURCE_DB: mongoose.connection.name,
          BACKUP_RESTORE_URI: replSet.getUri(), BACKUP_VAULT: vault, BACKUP_KEY_FILE: keyFile,
          BACKUP_ALERT_URL: 'https://127.0.0.1:1', BACKUP_MEDIA_ORIGINS: '',
        },
      });
      return JSON.parse(stdout);
    };
    expect(await runBackup('create')).toMatchObject({ attempted: 2, failures: 0 });
    expect(await runBackup('status')).toMatchObject({ attempted: 2, failures: 0 });
    const filename = path.join(vault, (await readdir(vault)).find((name) => name.startsWith(tenantId)));
    const encrypted = await readFile(filename);
    expect(encrypted.includes(Buffer.from('Backup Buyer'))).toBe(false);
    const verified = await readEncryptedBackup(filename, key);
    expect(decodeDocument(verified.data.users.find((row) => row._id.$oid === String(ids.ownerA))).password).toMatch(/^\$2/);
    const damagedMedia = structuredClone(verified);
    damagedMedia.media[0].content = Buffer.from('Wrong file bytes').toString('base64');
    expect(() => validateRecoveryArchive(damagedMedia, tenantId)).toThrow('media checksum');

    const databaseName = 'smart_kirana_restore_complete';
    const uploadsDirectory = path.join(backupTestRoot, 'complete');
    const client = mongoose.connection.getClient();
    const checked = await runBackup('check', filename, tenantId);
    expect(checked.counts.stockLedger).toBe(5001);
    const restored = await runBackup('restore', filename, tenantId, databaseName, uploadsDirectory);
    const db = client.db(databaseName);
    expect(restored.reconciliation.after).toEqual(restored.reconciliation.before);
    expect(restored.reconciliation.after).toMatchObject({ orderTotalMinor: 9900, stockUnits: 5001, udharBalanceMinor: 7500, discrepancies: [] });
    expect(await db.collection(StockLedger.collection.name).countDocuments()).toBe(5001);
    expect(await db.collection(Store.collection.name).findOne({ _id: ids.storeA })).toMatchObject({
      ownerId: ids.ownerA, settings: { orderPrefix: 'TEST' }, subscription: { planId },
    });
    expect(await db.collection(Order.collection.name).findOne({ _id: order._id })).toMatchObject({
      customerId: ids.customerA, items: [{ productId: product._id, variantId: variant._id }],
      paymentProof: { screenshotFile, screenshotUrl, utrNumber: 'UTR-FIXTURE' },
    });
    expect(await db.collection(archiveModels.udharEntries.collection.name).findOne({ referenceId: order._id })).toMatchObject({ customerId: debt._id });
    expect(await db.collection(archiveModels.returns.collection.name).findOne({ orderId: order._id })).toBeTruthy();
    expect(await readFile(path.join(uploadsDirectory, 'public', tenantId, 'rice.webp'))).toEqual(media);
    expect(await readFile(path.join(uploadsDirectory, 'private', 'payment-proofs', tenantId, 'proof.webp'))).toEqual(proof);
    expect(await readFile(path.join(uploadsDirectory, 'private', 'legacy-payment-proofs', tenantId, 'legacy-proof.png'))).toEqual(legacy);
    await expect(readFile(path.join(uploadsDirectory, 'legacy-proof.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await db.collection('_backupRestore').findOne({ _id: 'restore' })).toMatchObject({ state: 'verified' });
    await expect(assertRestoreReady(db, uploadsDirectory)).resolves.toBeUndefined();
    await expect(assertRestoreReady(db, sourceUploads)).rejects.toThrow();

    const restoredAppSmoke = `
      import { once } from 'node:events';
      import mongoose from 'mongoose';
      import { app } from './src/app.js';
      import { assertRestoreReady } from './src/services/backupRestore.js';
      import { UPLOADS_ROOT } from './src/middleware/upload.js';
      await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.SMK_RESTORE_DATABASE });
      await assertRestoreReady(mongoose.connection.db, UPLOADS_ROOT);
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const origin = 'http://127.0.0.1:' + server.address().port;
        const publicFile = await fetch(origin + process.env.SMK_RESTORE_IMAGE);
        const proofUrl = origin + '/api/v1/storefront/store-alpha/admin/orders/' + process.env.SMK_RESTORE_ORDER + '/payment/proof/file';
        const forbidden = await fetch(proofUrl);
        await forbidden.body.cancel();
        const privateFile = await fetch(proofUrl, { headers: { Authorization: 'Bearer ' + process.env.SMK_RESTORE_ACCESS } });
        const legacy = await fetch(origin + '/uploads/legacy-proof.png');
        await legacy.body.cancel();
        console.log(JSON.stringify({
          publicStatus: publicFile.status, publicBytes: Buffer.from(await publicFile.arrayBuffer()).toString('base64'),
          privateStatus: privateFile.status, privateBytes: Buffer.from(await privateFile.arrayBuffer()).toString('base64'),
          anonymousProofStatus: forbidden.status, legacyPublicStatus: legacy.status,
        }));
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await mongoose.disconnect();
      }
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', restoredAppSmoke], {
      env: {
        ...process.env,
        MONGODB_URI: replSet.getUri(), SMART_KIRANA_UPLOADS_ROOT: uploadsDirectory,
        SMK_RESTORE_DATABASE: databaseName, SMK_RESTORE_ORDER: String(order._id),
        SMK_RESTORE_IMAGE: image, SMK_RESTORE_ACCESS: tokens.ownerA,
      },
    });
    expect(JSON.parse(stdout)).toEqual({
      publicStatus: 200, publicBytes: media.toString('base64'),
      privateStatus: 200, privateBytes: proof.toString('base64'),
      anonymousProofStatus: 401, legacyPublicStatus: 404,
    });
  }, 60000);

  test('uses the original database snapshot when a product changes during capture', async () => {
    const { captureTenantBackup } = await import('../src/services/tenantBackup.service.js');
    const { decodeDocument } = await import('../src/services/backupModels.js');
    const { product } = await createProduct({ name: 'Before snapshot' });
    const source = mongoose.connection;
    const connection = {
      getClient: () => source.getClient(),
      db: {
        collection(name) {
          const collection = source.db.collection(name);
          if (name !== Store.collection.name) return collection;
          return {
            async findOne(filter, options) {
              const store = await collection.findOne(filter, options);
              await Product.updateOne({ _id: product._id }, { $set: { name: 'After snapshot' } });
              return store;
            },
          };
        },
      },
    };
    const archive = await captureTenantBackup(String(ids.storeA), { connection });
    expect(decodeDocument(archive.data.products[0]).name).toBe('Before snapshot');
    expect((await Product.findById(product._id)).name).toBe('After snapshot');
  });

  test('rejects corrupted data, cross-tenant records and interrupted restores before publication', async () => {
    const { captureTenantBackup, entryMetadata } = await import('../src/services/tenantBackup.service.js');
    const { encryptBackup, decryptBackup } = await import('../src/services/backupEncryption.js');
    const { assertRestoreReady, restoreTenantBackup, validateRecoveryArchive } = await import('../src/services/backupRestore.js');
    const tenantId = String(ids.storeA);
    const archive = await captureTenantBackup(tenantId);
    const key = randomBytes(32);
    const ciphertext = await encryptBackup(archive, key);
    ciphertext[ciphertext.length - 1] ^= 1;
    await expect(decryptBackup(ciphertext, key)).rejects.toThrow('authentication failed');
    const wrongKey = randomBytes(32);
    await expect(decryptBackup(await encryptBackup(archive, key), wrongKey)).rejects.toThrow('authentication failed');
    expect(() => validateRecoveryArchive(archive, String(ids.storeB))).toThrow('different tenant');
    const modified = structuredClone(archive);
    modified.store.name = 'Corrupted';
    expect(() => validateRecoveryArchive(modified, tenantId)).toThrow('checksum');
    const crossed = structuredClone(archive);
    crossed.data.users[0].tenantId = { $oid: String(ids.storeB) };
    crossed.manifest.collections.users = entryMetadata(crossed.data.users);
    expect(() => validateRecoveryArchive(crossed, tenantId)).toThrow('tenant scope');

    const client = mongoose.connection.getClient();
    const databaseName = 'smart_kirana_restore_interrupted';
    const uploadsDirectory = path.join(backupTestRoot, 'interrupted-' + randomUUID());
    const options = { archive, databaseName, uploadsDirectory, expectedTenantId: tenantId };
    const abort = new AbortController();
    let checks = 0;
    const signal = {
      throwIfAborted() {
        if (++checks === 4) abort.abort(new Error('Simulated interrupted restore'));
        abort.signal.throwIfAborted();
      },
    };
    await expect(restoreTenantBackup(client, { ...options, signal })).rejects.toThrow('Simulated interrupted restore');
    await expect(readFile(path.join(uploadsDirectory, '.restore-verified.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const db = client.db(databaseName);
    expect(await db.collection(Store.collection.name).countDocuments()).toBe(0);
    expect(await db.collection('_backupRestore').findOne({ _id: 'restore' })).toMatchObject({ state: 'staging' });
    await expect(assertRestoreReady(db, uploadsDirectory)).rejects.toThrow('has not passed verification');
    await expect(restoreTenantBackup(client, options)).rejects.toThrow('must be empty');
  }, 30000);

  test('reports missing and foreign uploads without producing a misleading backup', async () => {
    const { inspectTenantBackup } = await import('../src/services/tenantBackup.service.js');
    const tenantId = String(ids.storeA);
    const logo = '/uploads/' + tenantId + '/missing.webp';
    await Store.updateOne({ _id: ids.storeA }, { $set: {
      'branding.logo': logo, 'branding.banner': '/uploads/' + ids.storeB + '/foreign.webp',
    } });
    const report = await inspectTenantBackup(tenantId);
    expect(report.mediaIssues.map((issue) => issue.type)).toEqual(['invalid-public-media-reference', 'unavailable-upload']);
    const response = await request(app).get('/api/v1/backup/full').set(auth(tokens.ownerA));
    expect(response.status).toBe(409);
    expect(response.body).not.toHaveProperty('manifest');
    expect((await Store.findById(ids.storeA)).branding.logo).toBe(logo);
  });
});


describe('Excel product import', () => {
  test('downloads a sample, previews without writes, imports tenant products and opening stock atomically', async () => {
    const { productSample } = await import('../src/services/productSpreadsheet.service.js');
    const sample = await request(app).get('/api/v1/products/import/sample').set(auth(tokens.ownerA));
    expect(sample.status).toBe(200);
    expect(sample.headers['content-disposition']).toContain('product-import-sample.xlsx');
    const buffer = Buffer.from(await productSample());
    const preview = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerA)).field('preview', 'true').attach('file', buffer, 'products.xlsx');
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ productCount: 1, variantCount: 2 });
    expect(await Product.countDocuments({ tenantId: ids.storeA })).toBe(0);
    const imported = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerA)).attach('file', buffer, 'products.xlsx');
    expect(imported.status).toBe(201);
    expect(await Product.countDocuments({ tenantId: ids.storeA })).toBe(1);
    expect(await Product.countDocuments({ tenantId: ids.storeB })).toBe(0);
    const ledger = await StockLedger.find({ tenantId: ids.storeA }).sort({ balanceAfter: -1 });
    expect(ledger.map((entry) => entry.balanceAfter)).toEqual([20, 10]);
    const duplicate = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerA)).attach('file', buffer, 'products.xlsx');
    expect(duplicate.status).toBe(409);
    expect(await Product.countDocuments({ tenantId: ids.storeA })).toBe(1);
    expect(await StockLedger.countDocuments({ tenantId: ids.storeA })).toBe(2);
    const otherStore = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerB)).attach('file', buffer, 'products.xlsx');
    expect(otherStore.status).toBe(201);
  });

  test('rejects unauthorized, invalid and oversized uploads before creating products', async () => {
    const forbidden = await request(app).get('/api/v1/products/import/sample').set(auth(tokens.packer));
    expect(forbidden.status).toBe(403);
    const invalid = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerA)).attach('file', Buffer.from('bad'), 'bad.xlsx');
    expect(invalid.status).toBe(400);
    const large = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerA)).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'large.xlsx');
    expect(large.status).toBe(400);
    expect(await Product.countDocuments({ tenantId: ids.storeA })).toBe(0);
  });

  test('rolls back all products if the opening stock ledger fails', async () => {
    const { productSample } = await import('../src/services/productSpreadsheet.service.js');
    const spy = vi.spyOn(StockLedger, 'create').mockRejectedValueOnce(new Error('Injected import ledger failure'));
    try {
      const result = await request(app).post('/api/v1/products/import').set(auth(tokens.ownerA)).attach('file', Buffer.from(await productSample()), 'products.xlsx');
      expect(result.status).toBe(500);
      expect(await Product.countDocuments({ tenantId: ids.storeA })).toBe(0);
      expect(await StockLedger.countDocuments({ tenantId: ids.storeA })).toBe(0);
    } finally { spy.mockRestore(); }
  });
});


describe('saved-data revision checks', () => {
  test('replays saved packing work once, reconciles satisfied states, preserves recording time, and rejects changed assignments', async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    const ownerOrder = '/api/v1/storefront/store-alpha/admin/orders/' + order._id;
    await request(app).patch(ownerOrder + '/status').set(auth(tokens.ownerA)).send({ status: 'accepted' }).expect(200);
    await request(app).patch(ownerOrder + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    const packing = '/api/v1/packing/session/' + order._id;
    const started = await request(app).post(packing + '/start').set(auth(tokens.packer)).expect(201);
    const item = started.body.data.session.items[0];
    const endpoint = packing + '/item/' + item._id;
    const recordedAt = new Date(Date.now() - 60000).toISOString();
    const saved = { operationId: randomUUID(), action: 'pick', expectedStatus: 'pending', recordedAt };
    await request(app).patch(endpoint).set(auth(tokens.packer)).send(saved).expect(200);
    await request(app).patch(endpoint).set(auth(tokens.packer)).send(saved).expect(200);
    const Activity = mongoose.model('StaffActivityLog');
    const logs = await Activity.find({ orderId: order._id, 'metadata.operationId': saved.operationId });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata.recordedAt).toBe(recordedAt);
    expect(Date.parse(logs[0].metadata.confirmedAt)).toBeGreaterThan(Date.parse(recordedAt));
    await request(app).patch(endpoint).set(auth(tokens.packer)).send({ ...saved, action: 'missing' }).expect(409);
    const stale = await request(app).patch(endpoint).set(auth(tokens.packer)).send({ ...saved, operationId: randomUUID() }).expect(200);
    expect(stale.body.data.session.items[0].status).toBe('picked');
    expect(stale.body.data.session).not.toHaveProperty('operationReceipts');
    expect(await Activity.countDocuments({ orderId: order._id, action: 'item_picked' })).toBe(1);
    await Order.updateOne({ _id: order._id }, { assignedTo: ids.staff });
    await request(app).patch(endpoint).set(auth(tokens.packer)).send({ operationId: randomUUID(), action: 'pack', expectedStatus: 'picked', recordedAt }).expect(409);
    const confirmed = await mongoose.model('PackingSession').findById(started.body.data.session._id);
    expect(confirmed.items[0].status).toBe('picked');
  });
  test('reconciles satisfied packing work without regressions, duplicate activity, or weakening quantity and workflow checks', async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders').set(auth(tokens.customerA)).send(orderBody(product, variant, { quantity: 2 })).expect(201);
    const order = placed.body.data.order;
    const ownerOrder = '/api/v1/storefront/store-alpha/admin/orders/' + order._id;
    await request(app).patch(ownerOrder + '/status').set(auth(tokens.ownerA)).send({ status: 'accepted' }).expect(200);
    await request(app).patch(ownerOrder + '/assign').set(auth(tokens.ownerA)).send({ staffId: ids.packer }).expect(200);
    const packing = '/api/v1/packing/session/' + order._id;
    const started = await request(app).post(packing + '/start').set(auth(tokens.packer)).expect(201);
    const endpoint = packing + '/item/' + started.body.data.session.items[0]._id;
    const recordedAt = new Date(Date.now() - 60000).toISOString();
    const queued = (action, expectedStatus, rest = {}) => ({ operationId: randomUUID(), action, expectedStatus, recordedAt, ...rest });
    const send = (body) => request(app).patch(endpoint).set(auth(tokens.packer)).send(body);
    const Activity = mongoose.model('StaffActivityLog');
    const picked = await send({ action: 'pick', pickedQty: 1 }).expect(200);
    const conflict = await send(queued('pick', 'pending')).expect(409);
    expect(conflict.body.errors).toMatchObject({ code: 'PACKING_ITEM_CHANGED', session: { items: [{ status: 'picked', pickedQty: 1 }] } });
    expect(conflict.body.errors.session).not.toHaveProperty('operationReceipts');
    const packed = await send(queued('pack', 'picked')).expect(200);
    await settleRevisionWrites();
    const revision = (await request(app).get('/api/v1/sync/revision').set(auth(tokens.packer)).expect(200)).body.data.revision;
    const stalePick = queued('pick', 'pending', { pickedQty: 1 });
    const reconciled = await send(stalePick).expect(200);
    expect(reconciled.body.data.session.items[0]).toMatchObject({
      status: 'packed', pickedQty: 1,
      pickedBy: picked.body.data.session.items[0].pickedBy,
      packedBy: packed.body.data.session.items[0].packedBy,
      packedAt: packed.body.data.session.items[0].packedAt,
    });
    await send(stalePick).expect(200);
    await send({ ...stalePick, action: 'missing' }).expect(409);
    await send(queued('pack', 'picked')).expect(200);
    expect(await Activity.countDocuments({ orderId: order._id, action: { $in: ['item_picked', 'item_packed'] } })).toBe(2);
    await settleRevisionWrites();
    expect((await request(app).get('/api/v1/sync/revision').set(auth(tokens.packer)).expect(200)).body.data.revision).toBe(revision);
    await send(queued('missing', 'picked', { missingReason: 'Damaged' })).expect(409);
    await send(queued('missing', 'packed', { missingReason: 'Damaged' })).expect(200);
    const sameMissing = queued('missing', 'picked', { missingReason: 'Damaged' });
    await send(sameMissing).expect(200);
    await send(queued('missing', 'picked', { missingReason: 'Out of stock' })).expect(409);
    expect(await Activity.countDocuments({ orderId: order._id, action: 'item_missing' })).toBe(1);
    await Order.updateOne({ _id: order._id }, { status: 'packed' });
    await send(queued('missing', 'picked', { missingReason: 'Damaged' })).expect(409);
    const current = await mongoose.model('PackingSession').findById(started.body.data.session._id);
    expect(current.items[0]).toMatchObject({ status: 'missing', missingReason: 'Damaged' });
  });
  test('checks revisions without exposing records and changes only the affected tenant after a confirmed write', async () => {
    await settleRevisionWrites();
    const revision = async (token) => (await request(app).get('/api/v1/sync/revision').set(auth(token)).expect(200)).body.data.revision;
    await request(app).get('/api/v1/sync/revision').expect(401);
    const beforeA = await revision(tokens.ownerA);
    const beforeB = await revision(tokens.ownerB);
    await request(app).patch('/api/v1/stores/mine').set(auth(tokens.ownerA)).send({ name: 'Saved Alpha' }).expect(200);
    await settleRevisionWrites();
    expect(await revision(tokens.ownerA)).toBeGreaterThan(beforeA);
    expect(await revision(tokens.ownerB)).toBe(beforeB);
    const publicCheck = await request(app).get('/api/v1/storefront/store-alpha/sync-revision').expect(200);
    expect(Object.keys(publicCheck.body.data)).toEqual(['revision', 'versions']);
    expect(publicCheck.body.data.versions).toMatchObject({ Store: 1, Product: 1 });
    expect(publicCheck.body.data.versions).not.toHaveProperty('CurrentUser');
    const committed = await revision(tokens.ownerA);
    await request(app).patch('/api/v1/stores/mine').set(auth(tokens.ownerA)).send({ paymentSettings: { upiId: 'bad' } }).expect(400);
    await settleRevisionWrites();
    expect(await revision(tokens.ownerA)).toBe(committed);
  });

  test('inbox read changes affect only the recipient revision and expense changes exclude catalog counters', async () => {
    const getRevision = async (token) => (await request(app).get('/api/v1/sync/revision').set(auth(token)).expect(200)).body.data;
    const { notifyAdmin } = await import('../src/services/notification.service.js');
    await notifyAdmin(ids.storeA, 'new_order', 'Test inbox');
    const staffBefore = await getRevision(tokens.staff);
    await request(app).post('/api/v1/notifications/mark-all-read').set(auth(tokens.ownerA)).expect(200);
    await settleRevisionWrites();
    expect((await getRevision(tokens.ownerA)).versions).toEqual({ Notification: 1 });
    expect(await getRevision(tokens.staff)).toEqual(staffBefore);
    await request(app).post('/api/v1/expenses').set(auth(tokens.ownerA))
      .send({ description: 'Shop power', category: 'electricity', amount: 10, date: '2026-11-28', method: 'cash' }).expect(201);
    await settleRevisionWrites();
    const after = await getRevision(tokens.ownerA);
    expect(after.versions).toMatchObject({ Notification: 1, Expense: 1, Reports: 1 });
    expect(after.versions).not.toHaveProperty('Product');
  });

  test('owner COD handover publishes changes for cached Day Close and receipt screens', async () => {
    const { product, variant } = await createProduct();
    const placed = await request(app).post('/api/v1/storefront/store-alpha/orders')
      .set(auth(tokens.customerA)).send(orderBody(product, variant)).expect(201);
    const order = placed.body.data.order;
    const endpoint = '/api/v1/storefront/store-alpha/admin/orders/' + order._id + '/status';
    for (const status of ['accepted', 'packing', 'packed', 'out_for_delivery']) {
      await request(app).patch(endpoint).set(auth(tokens.ownerA)).send({ status }).expect(200);
    }
    await settleRevisionWrites();
    const counters = async () => (await request(app).get('/api/v1/sync/revision').set(auth(tokens.ownerA)).expect(200)).body.data.versions;
    const before = await counters();
    await request(app).patch(endpoint).set(auth(tokens.ownerA)).send({ status: 'delivered' }).expect(200);
    await settleRevisionWrites();
    const after = await counters();
    expect(after.DailyClosing ?? 0).toBe((before.DailyClosing ?? 0) + 1);
    expect(after.Transaction ?? 0).toBe((before.Transaction ?? 0) + 1);
    expect(after.POS ?? 0).toBe((before.POS ?? 0) + 1);
    expect((await Order.findById(order._id)).paymentStatus).toBe('paid');
  });
});
