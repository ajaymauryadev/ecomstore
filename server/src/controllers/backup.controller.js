import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import StockLedger from '../models/StockLedger.js';
import UdharCustomer from '../models/UdharCustomer.js';
import Expense from '../models/Expense.js';
import StaffSalary from '../models/StaffSalary.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { logAudit } from '../services/audit.service.js';
import { captureTenantBackup } from '../services/tenantBackup.service.js';
import { accountingDateFilter } from '../utils/accountingDay.js';

const tenantFilter = (tenantId) => ({ tenantId: new mongoose.Types.ObjectId(tenantId) });

let fullExportActive = false;

export const exportTenant = asyncHandler(async (req, res) => {
  if (!req.tenantId) {
    throw new AppError('A store session is required for tenant backups.', 403);
  }
  if (fullExportActive) throw new AppError('A backup is already being generated. Try again shortly.', 429);
  fullExportActive = true;
  try {
    const tenantId = String(req.tenantId);
    const backup = await captureTenantBackup(tenantId, { kind: 'owner' });
    await logAudit({ tenantId, action: 'store_updated', user: req.user, description: 'Tenant backup exported', req });
    const slug = String(backup.store.slug || 'store').replace(/[^a-z0-9-]/g, '-');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${slug}-${Date.now()}.json"`);
    res.json(backup);
  } finally {
    fullExportActive = false;
  }
});

export const exportProducts = asyncHandler(async (req, res, next) => {
  const tenantId = req.tenantId;
  const products = await Product.find(tenantFilter(tenantId)).lean();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="products-${Date.now()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), count: products.length, products });
});

export const exportOrders = asyncHandler(async (req, res, next) => {
  const { from, to } = req.query;
  const filter = tenantFilter(req.tenantId);
  if (from || to) filter.createdAt = accountingDateFilter(from, to, req.storeTimeZone);
  const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), count: orders.length, orders });
});

export const exportCustomers = asyncHandler(async (req, res) => {
  const customers = await User.find({ tenantId: req.tenantId, role: 'customer' })
    .select('-password -savedAddresses').lean();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), count: customers.length, customers });
});

export const exportInventory = asyncHandler(async (req, res) => {
  const filter = tenantFilter(req.tenantId);
  const [products, stockLedger] = await Promise.all([
    Product.find(filter).lean(),
    StockLedger.find(filter).sort({ createdAt: -1 }).limit(10000).lean(),
  ]);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="inventory-${Date.now()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), products, stockLedger });
});

export const exportAccounting = asyncHandler(async (req, res) => {
  const filter = tenantFilter(req.tenantId);
  const [expenses, salaries, udhar] = await Promise.all([
    Expense.find(filter).lean(),
    StaffSalary.find(filter).lean(),
    UdharCustomer.find(filter).lean(),
  ]);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="accounting-${Date.now()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), expenses, salaries, udhar });
});
