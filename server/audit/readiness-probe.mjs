// Read-only application audit: writes ONLY to a fresh disposable MongoDB replica set.
// No .env is loaded and no configured application database is used.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { accountingDay } from '../src/utils/accountingDay.js';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'audit-access-independent-random-key-123456789';
process.env.JWT_REFRESH_SECRET = 'audit-refresh-independent-random-key-987654321';
process.env.COOKIE_SECRET = 'audit-cookie-independent-random-key-456789123';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.MONGOMS_DOWNLOAD_IGNORE_MISSING_HEADER = 'true';
let replica;
const results = [];
try {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replica.getUri('readiness_audit');
  await mongoose.connect(process.env.MONGODB_URI);
  const { app } = await import('../src/app.js');
  const { generateTokens } = await import('../src/utils/jwt.js');
  const names = ['Store', 'User', 'Product', 'Order', 'Supplier', 'PurchaseEntry', 'UdharCustomer', 'UdharEntry', 'Return', 'Category', 'DailyClosing'];
  const models = Object.fromEntries(await Promise.all(names.map(async name => [name, (await import(`../src/models/${name}.js`)).default])));
  await Promise.all(Object.values(models).map(model => model.init()));
  let store, owner, product, variant, token;
  const call = (method, path, body) => {
    const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    return body === undefined ? req : req.send(body);
  };
  const fixture = async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})));
    const ownerId = new mongoose.Types.ObjectId();
    store = await models.Store.create({ name: 'Readiness Audit', slug: 'audit-store', ownerId,
      subscription: { isActive: true, expiresAt: new Date('2030-01-01') } });
    await models.User.collection.insertOne({ _id: ownerId, name: 'Audit Owner', email: 'audit@example.invalid',
      role: 'store_owner', tenantId: store._id, permissions: [], isActive: true, tokenVersion: 0 });
    owner = await models.User.findById(ownerId);
    token = generateTokens(owner).accessToken;
    product = await models.Product.create({ tenantId: store._id, name: 'Audit Rice', variants: [
      { name: '1kg', unit: 'kg', retailPrice: 100, purchasePrice: 60, stock: 100, isActive: true }
    ] });
    variant = product.variants[0];
  };
  const sale = (extra = {}) => ({ items: [{ productId: String(product._id), variantId: String(variant._id), qty: 1 }],
    paymentMethod: 'counter', saleType: 'instant', ...extra });
  const check = async (id, title, fn) => {
    await fixture();
    const evidence = {};
    try { await fn(evidence); results.push({ id, title, status: 'PASS', evidence }); }
    catch (error) { results.push({ id, title, status: 'FAIL', evidence, error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  };
  await check('A01', 'Cash billing works with optional customer phone blank (actual UI payload)', async e => {
    const r = await call('post', '/pos/order', sale({ customerName: 'Walk-in Customer', customerPhone: '0000000000' }));
    Object.assign(e, { status: r.status, response: r.body });
    assert.equal(r.status, 201);
  });
  await check('A02', 'Retried POS request creates exactly one bill', async e => {
    const send = () => call('post', '/pos/order', sale()).set('Idempotency-Key', 'audit-same-sale');
    const a = await send(); const b = await send();
    Object.assign(e, { statuses: [a.status, b.status], orderIds: [a.body.data?.order?._id, b.body.data?.order?._id],
      orderCount: await models.Order.countDocuments(), stock: (await models.Product.findById(product._id)).variants[0].stock });
    assert.equal(e.orderCount, 1);
  });
  await check('A03', 'POS credit sale updates customer udhar ledger atomically', async e => {
    const customer = await models.UdharCustomer.create({ tenantId: store._id, name: 'Credit Buyer', phone: '9876543210', creditLimit: 5000 });
    const r = await call('post', '/pos/order', sale({ paymentMethod: 'credit', customerName: customer.name, customerPhone: customer.phone }));
    Object.assign(e, { status: r.status, orderTotal: r.body.data?.order?.pricing?.grandTotal,
      balance: (await models.UdharCustomer.findById(customer._id)).balance, entries: await models.UdharEntry.countDocuments() });
    assert.equal(r.status, 201); assert.equal(e.balance, 100); assert.equal(e.entries, 1);
  });
  await check('A04', 'Supplier-level payment reconciles invoice balance', async e => {
    const supplier = await models.Supplier.create({ tenantId: store._id, name: 'Audit Supplier' });
    const p = await call('post', '/purchases', { supplierId: String(supplier._id), items: [
      { productId: String(product._id), variantId: String(variant._id), quantity: 10, purchasePrice: 100 }
    ], paidAmount: 0 });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const pay = await call('post', `/suppliers/${supplier._id}/payment`, { amount: 1000, method: 'cash' });
    const purchase = await models.PurchaseEntry.findById(p.body.data.purchase._id);
    Object.assign(e, { status: pay.status, supplierPending: (await models.Supplier.findById(supplier._id)).pendingAmount,
      invoicePending: purchase.pendingAmount, invoiceStatus: purchase.paymentStatus });
    assert.equal(pay.status, 200); assert.equal(e.invoicePending, e.supplierPending);
  });
  await check('A05', 'Full backup contains recoverable debt history and complete store settings', async e => {
    const c = await call('post', '/udhar', { name: 'Backup Buyer', phone: '9876543210' });
    assert.equal(c.status, 201);
    assert.equal((await call('post', `/udhar/${c.body.data.customer._id}/debit`, { amount: 500 })).status, 201);
    const r = await call('get', '/backup/full');
    Object.assign(e, { status: r.status, dataKeys: Object.keys(r.body.data || {}), storeKeys: Object.keys(r.body.store || {}),
      ledgerRowsInDatabase: await models.UdharEntry.countDocuments() });
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.body.data.udharEntries), 'UdharEntry history is absent');
    assert.ok(r.body.store._id, 'Store configuration absent');
  });
  await check('A06', 'Refund cannot exceed net amount paid after bill discount', async e => {
    const bill = await call('post', '/pos/order', sale({ overallDiscount: 20 }));
    assert.equal(bill.status, 201);
    const ret = await call('post', '/returns', { type: 'customer_return', orderId: bill.body.data.order._id,
      items: [{ productId: String(product._id), variantId: String(variant._id), qty: 1, condition: 'good', restockItem: true }], refundMethod: 'cash' });
    Object.assign(e, { status: ret.status, amountPaid: bill.body.data.order.pricing.grandTotal,
      refund: ret.body.data?.return?.netRefund, response: ret.status === 201 ? undefined : ret.body });
    assert.equal(ret.status, 201); assert.ok(e.refund <= e.amountPaid, 'Refund exceeds payment');
  });
  await check('A07', 'Saving product cannot silently delete another stocked variant', async e => {
    const extra = { name: '2kg', unit: 'kg', retailPrice: 200, stock: 8, isActive: true };
    product.variants.push(extra); await product.save();
    const r = await call('put', `/products/${product._id}`, { variants: [variant.toObject()] });
    const updated = await models.Product.findById(product._id);
    Object.assign(e, { status: r.status, beforeVariants: 2, afterVariants: updated.variants.length,
      missingStock: 8 });
    assert.ok(r.status >= 400 || updated.variants.length === 2, 'Stocked variant removed without adjustment/archive');
  });
  await check('A08', 'Daily cash closing includes supplier cash outflow', async e => {
    const supplier = await models.Supplier.create({ tenantId: store._id, name: 'Cash Supplier' });
    const previousDay = accountingDay(new Date(Date.now() - 86400000)).key;
    const invoice = await call('post', '/purchases', {
      supplierId: String(supplier._id), purchaseDate: previousDay.toISOString(), paymentMethod: 'credit',
      items: [{ productId: String(product._id), variantId: String(variant._id), quantity: 1, purchasePrice: 500 }],
    });
    assert.equal(invoice.status, 201);
    await models.PurchaseEntry.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(invoice.body.data.purchase._id) },
      { $set: { createdAt: previousDay } }
    );
    const payment = await call('post', `/suppliers/${supplier._id}/payment`, { amount: 100, method: 'cash' });
    assert.equal(payment.status, 200);
    const date = accountingDay(payment.body.data.payment.paidAt).key.toISOString().slice(0, 10);
    const r = await call('post', '/daily-closing', { date, openingCash: 1000, closingCash: 900, expenses: [] });
    Object.assign(e, { status: r.status, expectedClosingCash: r.body.data?.closing?.expectedClosingCash,
      supplierPayments: r.body.data?.closing?.supplierPayments, cashDifference: r.body.data?.closing?.cashDifference });
    assert.equal(r.status, 200);
    assert.equal(e.supplierPayments, 100);
    assert.equal(e.expectedClosingCash, 900);
    assert.equal(e.cashDifference, 0);
  });
  await check('A09', 'Healthy active shop is not blocked after 200 ordinary API requests', async e => {
    let r;
    for (let i = 0; i < 205; i++) { r = await call('get', '/auth/me'); if (r.status === 429) { e.blockedAt = i + 1; break; } }
    Object.assign(e, { finalStatus: r.status, message: r.body.message });
    assert.equal(r.status, 200);
  });
  await writeFile(new URL('./readiness-results.json', import.meta.url), JSON.stringify({
    timestamp: new Date().toISOString(), scope: 'Disposable replica set only; expected production invariants', results
  }, null, 2));
} finally {
  await mongoose.disconnect();
  if (replica) await replica.stop();
}
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
