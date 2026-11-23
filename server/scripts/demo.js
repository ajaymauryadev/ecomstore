/**
 * Smart Kirana — Full Demo Seed + Workflow Script
 * Run: npm run demo:reset (from /server)
 *
 * Creates 2 products (Rice + Almond), 4 test users, full tenant data,
 * and simulates every workflow end-to-end against real MongoDB.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

if (process.env.ALLOW_DEMO_RESET !== 'I_UNDERSTAND_THIS_DELETES_DEMO_TENANT_DATA') {
  throw new Error('Demo reset is disabled. Set ALLOW_DEMO_RESET only for an explicitly approved disposable demo database.');
}
const demoPassword = process.env.DEMO_PASSWORD;
if (!demoPassword || demoPassword.length < 10) {
  throw new Error('DEMO_PASSWORD must be supplied and contain at least 10 characters.');
}

// ── Models ──────────────────────────────────────────────────────────────────
import Store from '../src/models/Store.js';
import User from '../src/models/User.js';
import Category from '../src/models/Category.js';
import Product from '../src/models/Product.js';
import Supplier from '../src/models/Supplier.js';
import PurchaseEntry from '../src/models/PurchaseEntry.js';
import StockLedger from '../src/models/StockLedger.js';
import Order from '../src/models/Order.js';
import PackingSession from '../src/models/PackingSession.js';
import StaffActivityLog from '../src/models/StaffActivityLog.js';
import Return from '../src/models/Return.js';
import DailyClosing from '../src/models/DailyClosing.js';
import Expense from '../src/models/Expense.js';
import StaffSalary from '../src/models/StaffSalary.js';
import UdharCustomer from '../src/models/UdharCustomer.js';
import UdharEntry from '../src/models/UdharEntry.js';
import Notification from '../src/models/Notification.js';
import Coupon from '../src/models/Coupon.js';
import AuditLog from '../src/models/AuditLog.js';
import Plan from '../src/models/Plan.js';
import RefreshToken from '../src/models/RefreshToken.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const log = (msg) => console.log(`  ✓ ${msg}`);
const section = (msg) => console.log(`\n▶ ${msg}`);
const ago = (minutes) => new Date(Date.now() - minutes * 60 * 1000);
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

// ── Reset all tenant data (keeps users + store) ───────────────────────────────
async function resetTenantData(tenantId) {
  const tenantModels = [
    Category, Product, Supplier, PurchaseEntry, StockLedger, Order,
    PackingSession, StaffActivityLog, Return, DailyClosing, Expense,
    StaffSalary, UdharCustomer, UdharEntry, Notification, Coupon, AuditLog,
  ];
  await Promise.all(tenantModels.map((M) => M.deleteMany({ tenantId })));
  log('Wiped all tenant data');
}

// ── Ledger helper ─────────────────────────────────────────────────────────────
async function ledger(tenantId, productId, variantId, change, before, movementType, refId, refType, note, createdBy) {
  return StockLedger.create({
    tenantId, productId, variantId,
    movementType,
    quantityChange: change,
    balanceBefore: before,
    balanceAfter: before + change,
    referenceId: refId,
    referenceType: refType,
    note,
    createdBy,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🌾 Smart Kirana — Demo Seed');
  console.log('═'.repeat(60));

  await mongoose.connect(process.env.MONGODB_URI);
  log('MongoDB connected');

  // ─────────────────────────────────────────────────────────
  // 1. PLANS
  // ─────────────────────────────────────────────────────────
  section('Plans');
  const planExists = await Plan.findOne({ name: 'premium' });
  if (!planExists) {
    await Plan.insertMany([
      { name: 'trial', displayName: 'Trial', price: 0, durationDays: 30, sortOrder: 0, modules: ['pos','inventory','storefront'], limits: { maxProducts: 50, maxOrdersPerMonth: 100, maxStaff: 2 } },
      { name: 'premium', displayName: 'Premium', price: 999, durationDays: 30, sortOrder: 2, modules: ['pos','inventory','purchases','suppliers','packing','returns','daily_closing','accounting','reports','storefront','coupons','offers'], limits: { maxProducts: 5000, maxOrdersPerMonth: 10000, maxStaff: 20 } },
    ]);
    log('Created trial + premium plans');
  } else {
    log('Plans already exist');
  }

  // ─────────────────────────────────────────────────────────
  // 2. USERS
  // ─────────────────────────────────────────────────────────
  section('Users');

  // Super Admin
  let superAdmin = await User.findOne({ email: 'superadmin@test.com' });
  if (!superAdmin) {
    superAdmin = await User.create({ name: 'Super Admin', email: 'superadmin@test.com', password: demoPassword, phone: '9100000001', role: 'super_admin' });
    log('Created superadmin@test.com');
  } else {
    Object.assign(superAdmin, { name: 'Super Admin', phone: '9100000001', role: 'super_admin', tenantId: null, isActive: true });
    superAdmin.password = demoPassword;
    await superAdmin.save();
    log('superadmin@test.com — reset');
  }

  // Store Owner + Store
  let admin = await User.findOne({ email: 'admin@test.com' });
  let store = await Store.findOne({ slug: 'demo-kirana' });

  if (!store) {
    store = await Store.create({
      name: 'Demo Kirana Store',
      slug: 'demo-kirana',
      subscription: { plan: 'premium', isActive: true, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
      moduleSettings: { enabledModules: ['pos','inventory','purchases','suppliers','packing','returns','daily_closing','accounting','reports','storefront','coupons','offers'] },
      settings: { currency: 'INR', lowStockThreshold: 10, orderPrefix: 'ORD', allowCustomerOrders: true },
      paymentSettings: { upiId: 'demo@upi', upiName: 'Demo Kirana' },
      address: { street: 'Shop No. 5, MG Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
    });
    log(`Created store: demo-kirana (${store._id})`);
  }
  Object.assign(store, {
    name: 'Demo Kirana Store',
    isActive: true,
    subscription: { ...store.subscription?.toObject?.() ?? store.subscription, plan: 'premium', isActive: true, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
    moduleSettings: { enabledModules: ['pos','inventory','purchases','suppliers','packing','returns','daily_closing','accounting','reports','storefront','coupons','offers'] },
    paymentSettings: { ...store.paymentSettings?.toObject?.() ?? store.paymentSettings, upiId: 'demo@upi', upiName: 'Demo Kirana' },
  });
  await store.save();

  const tenantId = store._id;

  if (!admin) {
    admin = await User.create({ name: 'Demo Admin', email: 'admin@test.com', password: demoPassword, phone: '9100000002', role: 'store_owner', tenantId });
    store.ownerId = admin._id;
    await store.save();
    log('Created admin@test.com');
  } else {
    Object.assign(admin, { name: 'Demo Admin', phone: '9100000002', role: 'store_owner', tenantId, isActive: true });
    admin.password = demoPassword;
    await admin.save();
    store.ownerId = admin._id;
    await store.save();
    log('admin@test.com — reset');
  }

  let staff = await User.findOne({ email: 'staff@test.com' });
  if (!staff) {
    staff = await User.create({ name: 'Suresh Staff', email: 'staff@test.com', password: demoPassword, phone: '9100000003', role: 'staff', tenantId });
    log('Created staff@test.com');
  } else {
    Object.assign(staff, { name: 'Suresh Staff', phone: '9100000003', role: 'staff', tenantId, isActive: true });
    staff.password = demoPassword;
    await staff.save();
    log('staff@test.com — reset');
  }

  let customer = await User.findOne({ email: 'customer@test.com' });
  if (!customer) {
    customer = await User.create({
      name: 'Raju Customer', email: 'customer@test.com', password: demoPassword, phone: '9100000004', role: 'customer', tenantId,
      savedAddresses: [{ label: 'Home', line1: '12 MG Road', landmark: 'Near Temple', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', isDefault: true }],
    });
    log('Created customer@test.com');
  } else {
    Object.assign(customer, {
      name: 'Raju Customer',
      phone: '9100000004',
      role: 'customer',
      tenantId,
      isActive: true,
      savedAddresses: [{ label: 'Home', line1: '12 MG Road', landmark: 'Near Temple', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', isDefault: true }],
    });
    customer.password = demoPassword;
    await customer.save();
    log('customer@test.com — reset');
  }

  // Clean old tenant data
  await resetTenantData(tenantId);

  // ─────────────────────────────────────────────────────────
  // 3. CATEGORIES
  // ─────────────────────────────────────────────────────────
  section('Categories');
  const [catGrains, catDryFruits] = await Category.insertMany([
    { tenantId, name: 'Grains & Staples', emoji: '🌾', sortOrder: 0, description: 'Rice, wheat, atta and staples' },
    { tenantId, name: 'Dry Fruits', emoji: '🥜', sortOrder: 1, description: 'Almonds, cashews, raisins and more' },
  ]);
  log('Grains & Staples, Dry Fruits');

  // ─────────────────────────────────────────────────────────
  // 4. PRODUCTS — Rice + Almond
  // ─────────────────────────────────────────────────────────
  section('Products');

  const rice = await Product.create({
    tenantId,
    name: 'Rice',
    brand: 'India Gate',
    description: 'Premium quality basmati rice, long grain',
    categoryId: catGrains._id,
    isActive: true, isOnline: true, isFeatured: true,
    tags: ['rice', 'staple', 'grain', 'basmati'],
    variants: [
      { name: '1kg',      unit: 'kg',   retailPrice: 65,   purchasePrice: 52,  stock: 50, lowStockLimit: 10, sku: 'RICE-1KG',  sortOrder: 0 },
      { name: '5kg',      unit: 'kg',   retailPrice: 300,  purchasePrice: 240, stock: 20, lowStockLimit: 5,  sku: 'RICE-5KG',  sortOrder: 1 },
      { name: '25kg Bora',unit: 'bora', retailPrice: 1400, purchasePrice: 1100,stock: 3,  lowStockLimit: 2,  sku: 'RICE-25KG', sortOrder: 2 },
    ],
  });

  const almond = await Product.create({
    tenantId,
    name: 'Almond',
    brand: 'Tulsi',
    description: 'Premium California almonds, rich in vitamins and minerals',
    categoryId: catDryFruits._id,
    isActive: true, isOnline: true, isFeatured: true,
    tags: ['almond', 'badam', 'dry-fruit', 'nuts', 'premium'],
    variants: [
      { name: '100g', unit: '100g', retailPrice: 120,  purchasePrice: 90,  stock: 8,  lowStockLimit: 10, sku: 'ALMOND-100G', sortOrder: 0 },
      { name: '250g', unit: '250g', retailPrice: 280,  purchasePrice: 210, stock: 5,  lowStockLimit: 5,  sku: 'ALMOND-250G', sortOrder: 1 },
      { name: '1kg',  unit: 'kg',   retailPrice: 1050, purchasePrice: 780, stock: 2,  lowStockLimit: 3,  sku: 'ALMOND-1KG',  sortOrder: 2 },
    ],
  });

  // Named variant refs
  const rv = { '1kg': rice.variants[0], '5kg': rice.variants[1], '25kg': rice.variants[2] };
  const av = { '100g': almond.variants[0], '250g': almond.variants[1], '1kg': almond.variants[2] };

  log('Rice — 1kg (₹65, stock:50), 5kg (₹300, stock:20), 25kg Bora (₹1400, stock:3)');
  log('Almond — 100g (₹120, stock:8), 250g (₹280, stock:5), 1kg (₹1050, stock:2)');
  log('⚠ Low stock: Almond 100g (8<10), Almond 250g (5≤5), Almond 1kg (2<3), Rice 25kg (3>2 ok, but low)');

  // ─────────────────────────────────────────────────────────
  // 5. SUPPLIER
  // ─────────────────────────────────────────────────────────
  section('Supplier');
  const supplier = await Supplier.create({
    tenantId,
    name: 'Mohan Traders',
    phone: '9876543210',
    email: 'mohan@traders.com',
    companyName: 'Mohan Trading Co.',
    address: { line1: 'APMC Market, Sector 7', city: 'Navi Mumbai', state: 'Maharashtra', pincode: '400703' },
    pendingAmount: 6200,
    totalPurchased: 18200,
    totalPaid: 12000,
    notes: 'Main rice and dry-fruits supplier',
  });
  log(`Mohan Traders — ₹6200 pending due`);

  // ─────────────────────────────────────────────────────────
  // 6. COUPON
  // ─────────────────────────────────────────────────────────
  section('Coupon');
  const coupon = await Coupon.create({
    tenantId, code: 'DEMO10', description: '10% off on all orders above ₹200',
    type: 'percent', value: 10, maxDiscount: 100, minOrderValue: 200,
    usageLimitTotal: 500, isActive: true,
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  });
  log('DEMO10 — 10% off (max ₹100, min order ₹200)');

  // ─────────────────────────────────────────────────────────
  // 7. PURCHASE ENTRY → stock + ledger
  // ─────────────────────────────────────────────────────────
  section('Purchase Entry (stock in)');

  const purchase = await PurchaseEntry.create({
    tenantId,
    supplierId: supplier._id,
    supplierName: 'Mohan Traders',
    invoiceNumber: 'INV-2024-001',
    purchaseDate: daysAgo(2),
    items: [
      { productId: rice._id,   variantId: rv['1kg']._id,  productName: 'Rice',   variantName: '1kg',  unit: 'kg',   quantity: 50, purchasePrice: 52,  sellingPrice: 65  },
      { productId: rice._id,   variantId: rv['5kg']._id,  productName: 'Rice',   variantName: '5kg',  unit: 'kg',   quantity: 20, purchasePrice: 240, sellingPrice: 300 },
      { productId: almond._id, variantId: av['100g']._id, productName: 'Almond', variantName: '100g', unit: '100g', quantity: 30, purchasePrice: 90,  sellingPrice: 120 },
      { productId: almond._id, variantId: av['250g']._id, productName: 'Almond', variantName: '250g', unit: '250g', quantity: 15, purchasePrice: 210, sellingPrice: 280 },
    ],
    paidAmount: 12000,
    paymentMethod: 'upi',
    note: 'Weekly stock purchase',
    isStockUpdated: true,
    createdBy: admin._id,
  });

  // Stock ledger for purchase
  await Promise.all([
    ledger(tenantId, rice._id,   rv['1kg']._id,  50, 0, 'PURCHASE_IN', purchase._id, 'PurchaseEntry', 'Stock purchase INV-2024-001', admin._id),
    ledger(tenantId, rice._id,   rv['5kg']._id,  20, 0, 'PURCHASE_IN', purchase._id, 'PurchaseEntry', 'Stock purchase INV-2024-001', admin._id),
    ledger(tenantId, almond._id, av['100g']._id, 30, 0, 'PURCHASE_IN', purchase._id, 'PurchaseEntry', 'Stock purchase INV-2024-001', admin._id),
    ledger(tenantId, almond._id, av['250g']._id, 15, 0, 'PURCHASE_IN', purchase._id, 'PurchaseEntry', 'Stock purchase INV-2024-001', admin._id),
  ]);
  log(`INV-2024-001 — ₹${purchase.totalAmount} | 4 PURCHASE_IN ledger entries`);

  // ─────────────────────────────────────────────────────────
  // 8. CUSTOMER ORDER — coupon + home delivery
  // ─────────────────────────────────────────────────────────
  section('Customer Order — Rice 5kg + Almond 250g');

  const subtotal   = rv['5kg'].retailPrice + av['250g'].retailPrice;  // 300 + 280 = 580
  const discount   = Math.min(Math.round(subtotal * 0.1), 100);       // 58
  const delivery   = 40;
  const grandTotal = subtotal - discount + delivery;                   // 562

  const mainOrder = await Order.create({
    tenantId,
    customerId: customer._id,
    orderType: 'home_delivery',
    items: [
      { productId: rice._id,   variantId: rv['5kg']._id,  name: 'Rice',   variantName: '5kg',  unit: 'kg',   quantity: 1, mrp: rv['5kg'].retailPrice,  price: rv['5kg'].retailPrice  },
      { productId: almond._id, variantId: av['250g']._id, name: 'Almond', variantName: '250g', unit: '250g', quantity: 1, mrp: av['250g'].retailPrice, price: av['250g'].retailPrice },
    ],
    customerInfo: {
      name: 'Raju Customer', phone: '9100000004', email: 'customer@test.com',
      address: { line1: '12 MG Road', landmark: 'Near Temple', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
    },
    pricing: { subtotal, couponDiscount: discount, deliveryCharge: delivery, tax: 0, grandTotal },
    couponId: coupon._id,
    couponCode: 'DEMO10',
    status: 'payment_submitted',
    paymentStatus: 'submitted',
    paymentMethod: 'upi_qr',
    paymentProof: { screenshotUrl: '/uploads/demo-upi-proof.jpg', utrNumber: 'UTR20241127001', notes: 'Paid via PhonePe', submittedAt: ago(55) },
    note: 'Please deliver before 7 PM. Ring doorbell twice.',
  });

  // Add more timeline entries (pre-save already adds initial one)
  await Order.updateOne({ _id: mainOrder._id }, {
    $push: { timeline: { $each: [
      { status: 'payment_submitted', message: 'Payment proof submitted by customer', timestamp: ago(50) },
    ]}},
  });

  log(`${mainOrder.orderNumber} — subtotal ₹${subtotal}, coupon -₹${discount}, delivery +₹${delivery} → ₹${grandTotal}`);

  // ─────────────────────────────────────────────────────────
  // 9. ADMIN: VERIFY PAYMENT + ACCEPT + ASSIGN STAFF
  // ─────────────────────────────────────────────────────────
  section('Admin: verify payment → accept → assign staff');

  await Order.updateOne({ _id: mainOrder._id }, {
    $set: {
      status: 'packing',
      paymentStatus: 'paid',
      assignedTo: staff._id,
      'paymentProof.verifiedAt': ago(40),
      'paymentProof.verifiedBy': admin._id,
    },
    $push: { timeline: { $each: [
      { status: 'payment_verified', message: 'Payment ₹' + grandTotal + ' verified by admin', timestamp: ago(42) },
      { status: 'accepted',         message: 'Order accepted by store',                         timestamp: ago(38) },
      { status: 'packing',          message: `Assigned to ${staff.name} for packing`,           timestamp: ago(35) },
    ]}},
  });
  log(`Payment verified ✓ | Accepted ✓ | Assigned to ${staff.name}`);

  // ─────────────────────────────────────────────────────────
  // 10. STAFF: PACKING SESSION — Rice packed, Almond MISSING
  // ─────────────────────────────────────────────────────────
  section('Staff: packing session');

  const packingSession = await PackingSession.create({
    tenantId,
    orderId: mainOrder._id,
    orderNumber: mainOrder.orderNumber,
    staffId: staff._id,
    staffName: staff.name,
    status: 'completed',
    startedAt: ago(30),
    completedAt: ago(20),
    totalRequired: 2,
    totalPacked: 1,
    totalMissing: 1,
    highValueMissingCount: 1,
    staffNotes: 'Rice 5kg packed. Almond 250g not found on shelf — may need restock.',
    items: [
      {
        productId: rice._id, variantId: rv['5kg']._id,
        name: 'Rice', variantName: '5kg', unit: 'kg',
        requiredQty: 1, pickedQty: 1,
        mrp: rv['5kg'].retailPrice, price: rv['5kg'].retailPrice,
        isHighValue: false, status: 'packed',
        pickedAt: ago(28), packedAt: ago(25),
      },
      {
        productId: almond._id, variantId: av['250g']._id,
        name: 'Almond', variantName: '250g', unit: '250g',
        requiredQty: 1, pickedQty: 0,
        mrp: av['250g'].retailPrice, price: av['250g'].retailPrice,
        isHighValue: true, status: 'missing',
        missingReason: 'Shelf empty — awaiting restock from purchase order',
        markedMissingAt: ago(22),
      },
    ],
  });

  await StaffActivityLog.insertMany([
    { tenantId, staffId: staff._id, staffName: staff.name, action: 'packing_started',   orderId: mainOrder._id, orderNumber: mainOrder.orderNumber, createdAt: ago(30) },
    { tenantId, staffId: staff._id, staffName: staff.name, action: 'item_packed',        orderId: mainOrder._id, orderNumber: mainOrder.orderNumber, productId: rice._id,   variantId: rv['5kg']._id,  productName: 'Rice',   variantName: '5kg',  qty: 1, isHighValue: false, createdAt: ago(26) },
    { tenantId, staffId: staff._id, staffName: staff.name, action: 'item_missing',       orderId: mainOrder._id, orderNumber: mainOrder.orderNumber, productId: almond._id, variantId: av['250g']._id, productName: 'Almond', variantName: '250g', qty: 1, isHighValue: true,  metadata: { reason: 'Shelf empty' }, createdAt: ago(23) },
    { tenantId, staffId: staff._id, staffName: staff.name, action: 'packing_completed',  orderId: mainOrder._id, orderNumber: mainOrder.orderNumber, metadata: { totalPacked: 1, totalMissing: 1, highValueMissing: 1 }, createdAt: ago(20) },
  ]);
  log('Rice 5kg packed ✓ | Almond 250g MISSING ✗ (high-value) | Activity logs written');

  // ─────────────────────────────────────────────────────────
  // 11. ADMIN: PARTIAL FULFILLMENT → DELIVERED
  //     Stock deducted: Rice 5kg only. Almond 250g stock KEPT.
  // ─────────────────────────────────────────────────────────
  section('Admin: partial fulfillment → delivered');

  await Order.updateOne({ _id: mainOrder._id }, {
    $set: {
      status: 'partially_fulfilled',
      deliveredAt: ago(5),
      'items.0.fulfilledQty': 1,
      'items.1.fulfilledQty': 0,
    },
    $push: { timeline: { $each: [
      { status: 'partially_fulfilled', message: 'Approved: Rice delivered. Almond 250g missing — ₹280 to be refunded.', timestamp: ago(15) },
      { status: 'delivered',           message: 'Partially delivered by Suresh Staff',                                   timestamp: ago(5)  },
    ]}},
  });

  // Deduct Rice 5kg only
  await Product.updateOne({ _id: rice._id, 'variants._id': rv['5kg']._id }, { $inc: { 'variants.$.stock': -1 } });
  await ledger(tenantId, rice._id, rv['5kg']._id, -1, rv['5kg'].stock, 'ORDER_SOLD', mainOrder._id, 'Order', `${mainOrder.orderNumber} delivered — Rice 5kg`, admin._id);
  // Almond 250g stock NOT deducted (missing item)

  log(`Rice 5kg stock: ${rv['5kg'].stock} → ${rv['5kg'].stock - 1} (deducted)`);
  log(`Almond 250g stock: ${av['250g'].stock} (unchanged — item missing)`);

  // ─────────────────────────────────────────────────────────
  // 12. POS COUNTER SALE — Almond 100g
  // ─────────────────────────────────────────────────────────
  section('POS counter sale — Almond 100g');

  const posTotal = av['100g'].retailPrice; // 120
  const posOrder = await Order.create({
    tenantId,
    orderType: 'counter',
    items: [{
      productId: almond._id, variantId: av['100g']._id,
      name: 'Almond', variantName: '100g', unit: '100g',
      quantity: 2, mrp: av['100g'].retailPrice, price: av['100g'].retailPrice,
      fulfilledQty: 2,
    }],
    customerInfo: { name: 'Walk-in Customer', phone: '9999999999' },
    pricing: { subtotal: posTotal * 2, couponDiscount: 0, deliveryCharge: 0, tax: 0, grandTotal: posTotal * 2 },
    status: 'delivered',
    paymentStatus: 'paid',
    paymentMethod: 'counter',
    deliveredAt: new Date(),
  });

  await Product.updateOne({ _id: almond._id, 'variants._id': av['100g']._id }, { $inc: { 'variants.$.stock': -2 } });
  await ledger(tenantId, almond._id, av['100g']._id, -2, av['100g'].stock, 'ORDER_SOLD', posOrder._id, 'Order', `POS ${posOrder.orderNumber}`, admin._id);
  log(`${posOrder.orderNumber} — Almond 100g × 2 = ₹${posTotal * 2} | stock: ${av['100g'].stock} → ${av['100g'].stock - 2}`);

  // ─────────────────────────────────────────────────────────
  // 13. RETURN — Rice 1kg (customer damaged return)
  // ─────────────────────────────────────────────────────────
  section('Return — Rice 1kg (customer return)');

  const ret = await Return.create({
    tenantId,
    type: 'customer_return',
    status: 'processed',
    orderId: mainOrder._id,
    orderNumber: mainOrder.orderNumber,
    customerInfo: { name: 'Raju Customer', phone: '9100000004' },
    items: [{
      productId: rice._id, variantId: rv['1kg']._id,
      name: 'Rice', variantName: '1kg', unit: 'kg',
      qty: 1, unitPrice: rv['1kg'].retailPrice,
      refundAmount: rv['1kg'].retailPrice,
      reason: 'Damaged packaging — rice spilling',
      condition: 'damaged',
      restockItem: true,
    }],
    refundMethod: 'cash',
    totalRefundAmount: rv['1kg'].retailPrice,
    totalExchangeAmount: 0,
    netRefund: rv['1kg'].retailPrice,
    totalValue: rv['1kg'].retailPrice,
    processedAt: new Date(),
    processedBy: admin._id,
    processedByName: admin.name,
    createdBy: admin._id,
    createdByName: admin.name,
    notes: 'Verified damage. Cash refund issued.',
  });

  // Restock Rice 1kg
  await Product.updateOne({ _id: rice._id, 'variants._id': rv['1kg']._id }, { $inc: { 'variants.$.stock': 1 } });
  await ledger(tenantId, rice._id, rv['1kg']._id, 1, rv['1kg'].stock, 'RETURN_IN', ret._id, 'Return', `Return ${ret.returnNumber}`, admin._id);
  log(`${ret.returnNumber} — Rice 1kg restocked | ₹${rv['1kg'].retailPrice} cash refund`);

  // ─────────────────────────────────────────────────────────
  // 14. EXPENSES
  // ─────────────────────────────────────────────────────────
  section('Expenses');
  await Expense.insertMany([
    { tenantId, category: 'rent',        amount: 15000, description: 'Monthly shop rent — June 2024',   date: daysAgo(1), recordedBy: admin._id, recordedByName: admin.name },
    { tenantId, category: 'electricity', amount: 2500,  description: 'Electricity bill — MSEDCL',       date: daysAgo(2), recordedBy: admin._id, recordedByName: admin.name },
    { tenantId, category: 'packaging',   amount: 500,   description: 'Carry bags & bubble wrap',        date: new Date(), recordedBy: admin._id, recordedByName: admin.name },
    { tenantId, category: 'transport',   amount: 800,   description: 'Auto-rickshaw — supplier pickup', date: new Date(), recordedBy: admin._id, recordedByName: admin.name },
    { tenantId, category: 'maintenance', amount: 1200,  description: 'AC servicing charge',             date: daysAgo(3), recordedBy: admin._id, recordedByName: admin.name },
  ]);
  log('Rent ₹15000 | Electricity ₹2500 | Packaging ₹500 | Transport ₹800 | Maintenance ₹1200 = ₹20000 total');

  // ─────────────────────────────────────────────────────────
  // 15. STAFF SALARY
  // ─────────────────────────────────────────────────────────
  section('Staff Salary');
  const monthYear = new Date().toISOString().slice(0, 7);
  await StaffSalary.create({
    tenantId,
    staffId: staff._id,
    staffName: staff.name,
    staffPhone: '9100000003',
    monthYear,
    monthlySalary: 12000,
    advancePaid: 3000,
    totalPaid: 3000,
    status: 'partial',
    payments: [{
      amount: 3000, type: 'advance', method: 'cash',
      note: 'Festival advance paid', paidAt: daysAgo(5),
      paidBy: admin._id, paidByName: admin.name,
    }],
    notes: 'Balance ₹9000 due at month end',
  });
  log(`${staff.name} — ₹12000/month | ₹3000 advance paid | ₹9000 due`);

  // ─────────────────────────────────────────────────────────
  // 16. UDHAR (Customer Credit Book)
  // ─────────────────────────────────────────────────────────
  section('Udhar (Customer Credit)');

  const udharCust1 = await UdharCustomer.create({ tenantId, name: 'Ramesh Bhai', phone: '9211111111', creditLimit: 3000, balance: 750,  notes: 'Regular — trusted' });
  const udharCust2 = await UdharCustomer.create({ tenantId, name: 'Kamla Aunty', phone: '9311111111', creditLimit: 2000, balance: 300,  notes: 'Pays every week' });

  await UdharEntry.insertMany([
    { tenantId, customerId: udharCust1._id, type: 'debit',  amount: 450, description: 'Rice 5kg + Atta 2kg', balanceAfter: 450, recordedBy: admin._id, recordedByName: admin.name, date: daysAgo(5) },
    { tenantId, customerId: udharCust1._id, type: 'debit',  amount: 300, description: 'Almond 100g x2',      balanceAfter: 750, recordedBy: admin._id, recordedByName: admin.name, date: daysAgo(1) },
    { tenantId, customerId: udharCust2._id, type: 'debit',  amount: 450, description: 'Monthly groceries',   balanceAfter: 450, recordedBy: admin._id, recordedByName: admin.name, date: daysAgo(7) },
    { tenantId, customerId: udharCust2._id, type: 'credit', amount: 150, description: 'Part payment cash',   balanceAfter: 300, recordedBy: admin._id, recordedByName: admin.name, date: daysAgo(2) },
  ]);
  log('Ramesh Bhai owes ₹750 | Kamla Aunty owes ₹300 | Total udhar ₹1050');

  // ─────────────────────────────────────────────────────────
  // 17. SAMPLE ORDERS IN ALL STATUSES
  // ─────────────────────────────────────────────────────────
  section('Sample orders (all 8 statuses)');

  const statusSamples = [
    { status: 'pending',              paymentStatus: 'pending',   paymentMethod: 'cod',     note: 'Awaiting payment' },
    { status: 'payment_submitted',    paymentStatus: 'submitted', paymentMethod: 'upi_qr',  note: 'Screenshot uploaded, waiting verification' },
    { status: 'payment_verified',     paymentStatus: 'paid',      paymentMethod: 'upi_qr',  note: 'Payment confirmed, not yet accepted' },
    { status: 'accepted',             paymentStatus: 'paid',      paymentMethod: 'upi_id',  note: 'Accepted — queued for packing' },
    { status: 'packing',              paymentStatus: 'paid',      paymentMethod: 'upi_qr',  note: 'Staff currently packing' },
    { status: 'partially_fulfilled',  paymentStatus: 'paid',      paymentMethod: 'upi_id',  note: 'One item out of stock' },
    { status: 'delivered',            paymentStatus: 'paid',      paymentMethod: 'cod',     note: 'Successfully delivered', deliveredAt: ago(60) },
    { status: 'cancelled',            paymentStatus: 'pending',   paymentMethod: 'cod',     cancelReason: 'Customer changed mind', cancelledBy: 'customer', note: 'Cancelled at customer request' },
  ];

  for (const s of statusSamples) {
    await Order.create({
      tenantId,
      orderType: 'home_delivery',
      items: [{ productId: rice._id, variantId: rv['1kg']._id, name: 'Rice', variantName: '1kg', unit: 'kg', quantity: 2, mrp: rv['1kg'].retailPrice, price: rv['1kg'].retailPrice }],
      customerInfo: { name: 'Sample Customer', phone: '9888888888', address: { line1: '7 Sample St', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' } },
      pricing: { subtotal: rv['1kg'].retailPrice * 2, couponDiscount: 0, deliveryCharge: 40, tax: 0, grandTotal: rv['1kg'].retailPrice * 2 + 40 },
      status: s.status,
      paymentStatus: s.paymentStatus,
      paymentMethod: s.paymentMethod,
      note: s.note,
      cancelReason: s.cancelReason,
      cancelledBy: s.cancelledBy,
      deliveredAt: s.deliveredAt || null,
    });
  }
  log('8 sample orders created — one in every status');

  // ─────────────────────────────────────────────────────────
  // 18. DAILY CLOSING
  // ─────────────────────────────────────────────────────────
  section('Daily Closing');

  const todaySales = grandTotal + posTotal * 2;
  await DailyClosing.create({
    tenantId,
    date: new Date(),
    closedBy: admin._id,
    closedByName: admin.name,
    cashSales: posTotal * 2,
    upiSales: grandTotal,
    onlineSales: 0,
    creditSales: 0,
    totalSales: todaySales,
    ordersCount: 2,
    returnsTotal: rv['1kg'].retailPrice,
    supplierPayments: 2000,
    openingCash: 5000,
    closingCash: 5000 + (posTotal * 2) - 2000,
    expenses: [
      { description: 'Carry bags', amount: 200, category: 'other' },
      { description: 'Tea & snacks', amount: 80, category: 'other' },
    ],
    totalExpenses: 280,
    expectedClosingCash: 5000 + (posTotal * 2) - 2000,
    cashDifference: 0,
    notes: `Good day. Main order ${mainOrder.orderNumber} partially delivered. Almond stock critical.`,
    status: 'closed',
  });
  log(`Sales: ₹${todaySales} | Orders: 2 | Returns: ₹${rv['1kg'].retailPrice} | Closing cash: ₹${5000 + (posTotal * 2) - 2000}`);

  // ─────────────────────────────────────────────────────────
  // 19. NOTIFICATIONS (Socket.IO events)
  // ─────────────────────────────────────────────────────────
  section('Notifications');

  await Notification.insertMany([
    { tenantId, role: 'admin', type: 'new_order',        title: '🛒 New Order Received',        body: `Order ${mainOrder.orderNumber} — Rice 5kg + Almond 250g — ₹${grandTotal}`,            data: { orderId: mainOrder._id, orderNumber: mainOrder.orderNumber }, createdAt: ago(60) },
    { tenantId, role: 'admin', type: 'payment_submitted', title: '📸 Payment Proof Uploaded',   body: `UTR UTR20241127001 — ₹${grandTotal} for order ${mainOrder.orderNumber}`,              data: { orderId: mainOrder._id }, createdAt: ago(55) },
    { tenantId, role: 'admin', type: 'payment_verified',  title: '✅ Payment Verified',          body: `₹${grandTotal} confirmed. Order ${mainOrder.orderNumber} ready for packing.`,         data: { orderId: mainOrder._id }, createdAt: ago(42) },
    { tenantId, role: 'staff', type: 'order_assigned',    title: '📦 New Packing Assignment',   body: `Pack order ${mainOrder.orderNumber} — Rice 5kg + Almond 250g`,                        data: { orderId: mainOrder._id }, userId: staff._id, createdAt: ago(35) },
    { tenantId, role: 'admin', type: 'item_missing',      title: '⚠️ High-Value Item Missing',   body: `Almond 250g missing in ${mainOrder.orderNumber} — high-value item, verify stock`,     data: { orderId: mainOrder._id, isHighValue: true }, createdAt: ago(22) },
    { tenantId, role: 'admin', type: 'low_stock',         title: '📉 Low Stock: Almond 100g',   body: `Only ${av['100g'].stock - 2} units left (threshold: 10). Reorder soon.`,             data: { productId: almond._id, variantName: '100g' }, createdAt: ago(10) },
    { tenantId, role: 'admin', type: 'low_stock',         title: '📉 Low Stock: Almond 1kg',    body: `Only ${av['1kg'].stock} units left (threshold: 3). Critical level.`,                 data: { productId: almond._id, variantName: '1kg'  }, createdAt: ago(10) },
    { tenantId, role: 'admin', type: 'delivered',         title: '🚚 Order Partially Delivered', body: `${mainOrder.orderNumber} delivered. Rice ✓ | Almond 250g missing — refund ₹280`,   data: { orderId: mainOrder._id }, createdAt: ago(5) },
    { tenantId, role: 'admin', type: 'supplier_due',      title: '💸 Supplier Payment Due',      body: `Mohan Traders — ₹${supplier.pendingAmount} pending. Last purchase 2 days ago.`,      data: { supplierId: supplier._id }, createdAt: ago(30) },
    { tenantId, role: 'admin', type: 'customer_due',      title: '📒 Udhar Update',              body: `Ramesh Bhai owes ₹750 | Kamla Aunty owes ₹300 | Total: ₹1050`,                      data: {}, createdAt: ago(20) },
  ]);
  log('10 notifications — new_order, payment, packing, missing item, low stock, delivered');

  // ─────────────────────────────────────────────────────────
  // 20. AUDIT LOGS
  // ─────────────────────────────────────────────────────────
  section('Audit Logs');

  await AuditLog.insertMany([
    { tenantId, action: 'admin_login',      performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, description: 'Store owner login from 127.0.0.1', createdAt: daysAgo(1) },
    { tenantId, action: 'purchase_added',   performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, resource: { type: 'PurchaseEntry', id: purchase._id, label: 'INV-2024-001' }, description: `Purchase ₹${purchase.totalAmount} from Mohan Traders`, createdAt: daysAgo(2) },
    { tenantId, action: 'order_created',    performedBy: { userId: customer._id, name: customer.name, role: 'customer'    }, resource: { type: 'Order', id: mainOrder._id, label: mainOrder.orderNumber }, description: `Customer order ₹${grandTotal}`, createdAt: ago(60) },
    { tenantId, action: 'payment_verified', performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, resource: { type: 'Order', id: mainOrder._id, label: mainOrder.orderNumber }, description: `Payment ₹${grandTotal} verified — UTR UTR20241127001`, createdAt: ago(42) },
    { tenantId, action: 'order_packed',     performedBy: { userId: staff._id,    name: staff.name,    role: 'staff'       }, resource: { type: 'Order', id: mainOrder._id, label: mainOrder.orderNumber }, description: `Packed 1/2 items — Almond 250g missing (high-value)`, createdAt: ago(20) },
    { tenantId, action: 'pos_bill_created', performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, resource: { type: 'Order', id: posOrder._id,  label: posOrder.orderNumber  }, description: `POS counter sale ₹${posTotal * 2} — Almond 100g × 2`, createdAt: ago(15) },
    { tenantId, action: 'return_created',   performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, resource: { type: 'Return', id: ret._id, label: ret.returnNumber }, description: `Customer return ₹${rv['1kg'].retailPrice} — Rice 1kg (damaged)`, createdAt: ago(10) },
    { tenantId, action: 'expense_added',    performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, description: 'Monthly rent ₹15000 recorded', createdAt: daysAgo(1) },
    { tenantId, action: 'salary_paid',      performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, description: `Advance ₹3000 paid to ${staff.name}`, createdAt: daysAgo(5) },
    { tenantId, action: 'stock_adjusted',   performedBy: { userId: admin._id,    name: admin.name,    role: 'store_owner' }, resource: { type: 'Product', id: rice._id, label: 'Rice 1kg' }, description: '+1 unit restocked via customer return', createdAt: ago(10) },
  ]);
  log('10 audit entries — login, purchase, order, payment, packing, POS, return, expense, salary, stock');

  // ─────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────
  const totalExpenses = 15000 + 2500 + 500 + 800 + 1200;
  const totalRevenue  = grandTotal + posTotal * 2;

  console.log('\n' + '═'.repeat(62));
  console.log('  🎉  DEMO SEED COMPLETE — Smart Kirana');
  console.log('═'.repeat(62));

  console.log('\n  📋  CREDENTIALS');
  console.log('  ──────────────────────────────────────────────────────');
  console.log('  Demo accounts created. Use the DEMO_PASSWORD value supplied to this process.');

  console.log('\n  🌐  URLS');
  console.log('  ──────────────────────────────────────────────────────');
  console.log('  Admin Panel  → http://localhost:5173/store/dashboard');
  console.log('  Super Admin  → http://localhost:5173/super-admin/dashboard');
  console.log('  Customer Site→ http://localhost:5173/s/demo-kirana');
  console.log('  Staff Panel  → http://localhost:5173/staff/dashboard');
  console.log('  Seed Plans   → POST http://localhost:5000/api/v1/plans/seed');

  console.log('\n  📊  EXPECTED DASHBOARD VALUES');
  console.log('  ──────────────────────────────────────────────────────');
  console.log(`  Products       │ 2 (Rice + Almond, 6 variants)`);
  console.log(`  Total Orders   │ 10 (1 main + 1 POS + 8 sample statuses)`);
  console.log(`  Today Revenue  │ ₹${totalRevenue}`);
  console.log(`  Total Expenses │ ₹${totalExpenses}`);
  console.log(`  Net P&L Today  │ ₹${totalRevenue - totalExpenses} (loss — expenses > small revenue)`);
  console.log(`  Supplier Due   │ ₹${supplier.pendingAmount} (Mohan Traders)`);
  console.log(`  Udhar Due      │ ₹1,050 (Ramesh Bhai ₹750 + Kamla Aunty ₹300)`);
  console.log(`  Salary Due     │ ₹9,000 (${staff.name}, balance)`);
  console.log(`  Low Stock      │ Almond 100g (6u), Almond 250g (5u), Almond 1kg (2u)`);
  console.log(`  Notifications  │ 10 unread`);
  console.log(`  Audit Logs     │ 10 entries`);
  console.log(`  Returns        │ 1 (Rice 1kg — ₹${rv['1kg'].retailPrice} cash refund)`);

  console.log('\n  🔄  WORKFLOW COVERAGE');
  console.log('  ──────────────────────────────────────────────────────');
  console.log('  ✓ Purchase entry + PURCHASE_IN ledger');
  console.log('  ✓ Customer order (coupon DEMO10) → payment_submitted');
  console.log('  ✓ Admin verified + accepted + assigned staff');
  console.log(`  ✓ Staff packed Rice ✓, Almond 250g MISSING (high-value)`);
  console.log('  ✓ Partial fulfillment → Rice delivered, Almond refunded');
  console.log('  ✓ Stock deducted only for Rice 5kg (ORDER_SOLD ledger)');
  console.log('  ✓ POS counter sale — Almond 100g × 2');
  console.log('  ✓ Customer return — Rice 1kg (RETURN_IN ledger)');
  console.log('  ✓ Expenses, salary, udhar, daily closing');
  console.log('  ✓ All 8 order statuses populated');
  console.log('  ✓ 10 notifications + 10 audit logs');

  console.log('\n' + '═'.repeat(62) + '\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message);
  if (err.errors) {
    Object.entries(err.errors).forEach(([k, v]) => console.error(`   ${k}: ${v.message}`));
  }
  mongoose.disconnect().finally(() => process.exit(1));
});
