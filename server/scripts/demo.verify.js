import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { initSocket } from '../src/config/socket.js';

if (process.env.ALLOW_DEMO_VERIFY !== 'true') {
  throw new Error('Demo verification is disabled until ALLOW_DEMO_VERIFY=true is set for an explicitly approved demo database.');
}
const demoPassword = process.env.DEMO_PASSWORD;
if (!demoPassword || demoPassword.length < 10) {
  throw new Error('DEMO_PASSWORD must be supplied and contain at least 10 characters.');
}

const BASE_URL = process.env.DEMO_API_URL || 'http://localhost:5000/api/v1';
const HEALTH_URL = BASE_URL.replace('/api/v1', '/health');
let embeddedServer = null;

const credentials = {
  superAdmin: ['superadmin@test.com', demoPassword],
  admin: ['admin@test.com', demoPassword],
  staff: ['staff@test.com', demoPassword],
  customer: ['customer@test.com', demoPassword],
};

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    },
    absorb(headers) {
      const raw = headers.get('set-cookie');
      if (!raw) return;
      for (const cookie of raw.split(/,(?=[^ ;]+=)/)) {
        const [pair] = cookie.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    },
  };
}

async function request(method, path, { body, token, jar } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const cookie = jar?.header();
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar?.absorb(res.headers);

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${data?.message || data?.raw || 'request failed'}`);
  }
  return data;
}

async function ensureApi() {
  try {
    const res = await fetch(HEALTH_URL);
    if (res.ok) return res;
  } catch {
    // Fall through and boot the app in-process for standalone smoke runs.
  }

  const url = new URL(BASE_URL);
  const port = Number(url.port || 5000);
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;

  await connectDB();
  embeddedServer = http.createServer(app);
  initSocket(embeddedServer);
  await new Promise((resolve, reject) => {
    embeddedServer.once('error', reject);
    embeddedServer.listen(port, host, () => {
      embeddedServer.off('error', reject);
      resolve();
    });
  });

  return fetch(HEALTH_URL);
}

async function login(email, password) {
  const jar = createJar();
  const data = await request('POST', '/auth/login', { body: { email, password }, jar });
  return { token: data.data.accessToken, jar, user: data.data.user, store: data.data.store };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`OK  ${name}`);
    return detail;
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}

const auth = {};
const state = {};

await check('health', async () => {
  const res = await ensureApi();
  assert(res.ok, `health returned ${res.status}`);
  return 'ok';
});

await check('auth for all demo users', async () => {
  auth.superAdmin = await login(...credentials.superAdmin);
  auth.admin = await login(...credentials.admin);
  auth.staff = await login(...credentials.staff);
  auth.customer = await login(...credentials.customer);

  const roles = [
    auth.superAdmin.user.role,
    auth.admin.user.role,
    auth.staff.user.role,
    auth.customer.user.role,
  ];
  assert(roles.join(',') === 'super_admin,store_owner,staff,customer', `unexpected roles: ${roles.join(',')}`);
  assert(auth.admin.store?.slug === 'demo-kirana', 'admin store slug missing');
  assert(auth.customer.store?.slug === 'demo-kirana', 'customer store slug missing');
  return roles.join(', ');
});

await check('refresh and role guards', async () => {
  const refreshed = await request('POST', '/auth/refresh', { jar: auth.admin.jar });
  auth.admin.token = refreshed.data.accessToken;

  let protectedRejected = false;
  try {
    await request('GET', '/auth/me');
  } catch {
    protectedRejected = true;
  }
  assert(protectedRejected, 'protected route allowed missing token');

  let superRejected = false;
  try {
    await request('GET', '/products', { token: auth.superAdmin.token });
  } catch {
    superRejected = true;
  }
  assert(superRejected, 'super admin was allowed into tenant products');
  return 'ok';
});

await check('super admin dashboard data', async () => {
  const stats = await request('GET', '/super-admin/stats', { token: auth.superAdmin.token });
  const stores = await request('GET', '/super-admin/stores?search=demo-kirana', { token: auth.superAdmin.token });
  assert(stats.data.totalStores >= 1, 'super admin stats missing stores');
  assert(stores.meta.total >= 1, 'demo store missing from super admin store list');
  return { stores: stats.data.totalStores, matchedDemoStores: stores.meta.total };
});

await check('public storefront with 2 products', async () => {
  const info = await request('GET', '/storefront/demo-kirana');
  const categories = await request('GET', '/storefront/demo-kirana/categories');
  const rice = await request('GET', '/storefront/demo-kirana/products?search=Rice');
  const almond = await request('GET', '/storefront/demo-kirana/products?search=Almond');

  state.storeId = info.data.store._id;
  state.rice = rice.data.find((product) => product.name === 'Rice');
  state.almond = almond.data.find((product) => product.name === 'Almond');

  assert(categories.data.categories.length === 2, 'expected exactly 2 categories');
  assert(state.rice?.variants.length === 3, 'Rice variants missing');
  assert(state.almond?.variants.length === 3, 'Almond variants missing');
  return { categories: 2, products: 2, variants: 6 };
});

await check('products, categories, inventory, low stock', async () => {
  const products = await request('GET', '/products', { token: auth.admin.token });
  const categories = await request('GET', '/categories', { token: auth.admin.token });
  const inventory = await request('GET', '/inventory/dashboard', { token: auth.admin.token });
  const lowStock = await request('GET', '/inventory/low-stock', { token: auth.admin.token });

  assert(products.meta.total === 2, `expected 2 products, got ${products.meta.total}`);
  assert(categories.data.categories.length === 2, 'expected 2 categories');
  assert(inventory.data.stats.totalVariants === 6, 'expected 6 inventory variants');
  assert(lowStock.data.products.length >= 3, 'expected low stock examples');
  return { products: products.meta.total, variants: inventory.data.stats.totalVariants, lowStock: lowStock.data.products.length };
});

await check('purchase stock and ledger', async () => {
  const purchases = await request('GET', '/purchases', { token: auth.admin.token });
  const purchaseStats = await request('GET', '/purchases/stats', { token: auth.admin.token });
  const ledger = await request('GET', `/inventory/ledger/${state.rice._id}`, { token: auth.admin.token });
  assert(purchases.meta.total === 1, 'purchase entry missing');
  assert(purchaseStats.data.stats.totalAmount === 13250, 'purchase total mismatch');
  assert(ledger.meta.total >= 2, 'Rice purchase/order/return ledger entries missing');
  return { purchases: purchases.meta.total, riceLedgerRows: ledger.meta.total };
});

await check('order statuses and payment queue', async () => {
  const queue = await request('GET', '/storefront/demo-kirana/admin/orders/payment-queue', { token: auth.admin.token });
  const orders = await request('GET', '/storefront/demo-kirana/admin/orders?limit=50', { token: auth.admin.token });
  const statuses = new Set(orders.data.map((order) => order.status));
  const expected = ['pending', 'payment_submitted', 'payment_verified', 'accepted', 'packing', 'partially_fulfilled', 'delivered', 'cancelled'];
  const missing = expected.filter((status) => !statuses.has(status));
  assert(missing.length === 0, `missing order statuses: ${missing.join(', ')}`);
  assert(queue.meta.total >= 1, 'payment submitted queue empty');
  return { orders: orders.meta.total, paymentQueue: queue.meta.total };
});

await check('packing and staff activity', async () => {
  const sessions = await request('GET', '/packing/admin/sessions', { token: auth.admin.token });
  const activity = await request('GET', '/packing/admin/activity', { token: auth.admin.token });
  const missing = await request('GET', '/packing/admin/missing-report', { token: auth.admin.token });
  const highValue = await request('GET', '/packing/admin/high-value-alerts', { token: auth.admin.token });
  const staffOrders = await request('GET', '/packing/my-orders', { token: auth.staff.token });

  assert(sessions.meta.total >= 1, 'packing session missing');
  assert(activity.meta.total >= 4, 'staff activity logs missing');
  assert(missing.data.report.length >= 1, 'missing item report empty');
  assert(highValue.data.alerts.length >= 1, 'high-value alerts empty');
  return { sessions: sessions.meta.total, activity: activity.meta.total, missing: missing.data.report.length, highValue: highValue.data.alerts.length, staffOrders: staffOrders.data.orders.length };
});

await check('POS and returns', async () => {
  const pos = await request('GET', '/pos/orders', { token: auth.admin.token });
  const returns = await request('GET', '/returns', { token: auth.admin.token });
  const returnStats = await request('GET', '/returns/stats', { token: auth.admin.token });
  const customerReturnStats = returnStats.data.stats.find((row) => row._id === 'customer_return');
  assert(pos.meta.total >= 1, 'POS order missing');
  assert(returns.meta.total === 1, 'return record missing');
  assert(customerReturnStats?.totalRefund === 65, 'return refund total mismatch');
  return { posOrders: pos.meta.total, returns: returns.meta.total };
});

await check('accounting: expenses, salary, udhar, daily closing', async () => {
  const expenses = await request('GET', '/expenses', { token: auth.admin.token });
  const expenseStats = await request('GET', '/expenses/stats', { token: auth.admin.token });
  const salary = await request('GET', '/salary', { token: auth.admin.token });
  const salaryStats = await request('GET', '/salary/stats', { token: auth.admin.token });
  const udhar = await request('GET', '/udhar', { token: auth.admin.token });
  const dues = await request('GET', '/udhar/dues', { token: auth.admin.token });
  const closing = await request('GET', '/daily-closing', { token: auth.admin.token });

  assert(expenses.meta.total === 5, 'expense records missing');
  assert(expenseStats.data.total === 20000, 'expense total mismatch');
  assert(salary.meta.total === 1, 'salary record missing');
  assert(salaryStats.data.totalDue === 9000, 'salary due mismatch');
  assert(udhar.meta.total === 2, 'udhar customers missing');
  assert(dues.meta.total === 2, 'udhar dues missing');
  assert(closing.meta.total === 1, 'daily closing missing');
  return { expenses: expenses.meta.total, salaryDue: salaryStats.data.totalDue, udharCustomers: udhar.meta.total, closings: closing.meta.total };
});

await check('reports and dashboard feeds', async () => {
  const profitLoss = await request('GET', '/reports/profit-loss', { token: auth.admin.token });
  const dailySales = await request('GET', '/reports/daily-sales', { token: auth.admin.token });
  const stock = await request('GET', '/reports/stock', { token: auth.admin.token });
  const supplierDues = await request('GET', '/reports/supplier-dues', { token: auth.admin.token });
  const customerDues = await request('GET', '/reports/customer-dues', { token: auth.admin.token });
  const expenses = await request('GET', '/reports/expenses', { token: auth.admin.token });
  const salary = await request('GET', '/reports/salary', { token: auth.admin.token });

  assert(profitLoss.data.totalSales >= 802, 'profit/loss revenue missing');
  assert(dailySales.data.total >= 0, 'daily sales missing');
  assert(stock.meta.total === 2, 'stock report product count mismatch');
  assert(supplierDues.data.total === 6200, 'supplier due report mismatch');
  assert(customerDues.data.total === 1050, 'customer due report mismatch');
  assert(expenses.data.total === 20000, 'expense report mismatch');
  assert(salary.data.stats.totalDue === 9000, 'salary report mismatch');
  return { sales: profitLoss.data.totalSales, stockProducts: stock.meta.total, supplierDue: supplierDues.data.total, customerDue: customerDues.data.total };
});

await check('notifications and audit logs', async () => {
  const notifications = await request('GET', '/notifications', { token: auth.admin.token });
  const unread = await request('GET', '/notifications/unread-count', { token: auth.admin.token });
  const audit = await request('GET', '/audit-logs', { token: auth.admin.token });

  assert(notifications.meta.total === 10, 'notification count mismatch');
  assert(unread.data.count === 10, 'unread count mismatch');
  assert(audit.meta.total >= 10, 'audit log count mismatch');
  return { notifications: notifications.meta.total, unread: unread.data.count, auditLogs: audit.meta.total };
});

console.log('\nDemo verification passed.');
console.log(JSON.stringify(results, null, 2));

if (embeddedServer) {
  await new Promise((resolve) => embeddedServer.close(resolve));
  await mongoose.disconnect();
}
