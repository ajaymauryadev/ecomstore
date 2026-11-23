import Store from '../models/Store.js';
import User from '../models/User.js';
import Plan from '../models/Plan.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { escapeRegex, parsePagination } from '../utils/query.js';

export const getSystemStats = asyncHandler(async (req, res) => {
  const [
    totalStores, activeStores, totalUsers, expiringStores, recentStores,
    planDistribution,
  ] = await Promise.all([
    Store.countDocuments(),
    Store.countDocuments({ isActive: true }),
    User.countDocuments(),
    Store.countDocuments({
      'subscription.expiresAt': { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), $gte: new Date() },
    }),
    Store.find().sort({ createdAt: -1 }).limit(10).populate('ownerId', 'name email phone').lean(),
    Store.aggregate([
      { $group: { _id: '$subscription.plan', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  sendSuccess(res, {
    totalStores, activeStores, inactiveStores: totalStores - activeStores,
    totalUsers, expiringThisWeek: expiringStores,
    recentStores, planDistribution,
  });
});

export const getStores = asyncHandler(async (req, res) => {
  const { search, plan, isActive } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (search) {
    const pattern = new RegExp(escapeRegex(String(search).trim().slice(0, 80)), 'i');
    filter.$or = [{ name: pattern }, { slug: pattern }];
  }
  if (plan) filter['subscription.plan'] = plan;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const [stores, total] = await Promise.all([
    Store.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('ownerId', 'name email phone').lean(),
    Store.countDocuments(filter),
  ]);

  sendPaginated(res, stores, total, page, limit);
});

export const getStoreDetail = asyncHandler(async (req, res, next) => {
  const store = await Store.findById(req.params.id).populate('ownerId', 'name email phone role').lean();
  if (!store) return next(new AppError('Store not found.', 404));

  const [productCount, orderCount, userCount, recentAudit] = await Promise.all([
    Product.countDocuments({ tenantId: store._id }),
    Order.countDocuments({ tenantId: store._id }),
    User.countDocuments({ tenantId: store._id }),
    AuditLog.find({ tenantId: store._id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  sendSuccess(res, { store, stats: { productCount, orderCount, userCount }, recentAudit });
});

export const createStore = asyncHandler(async (req, res, next) => {
  const { ownerName, ownerPhone, ownerEmail, ownerPassword, storeName, storeSlug, plan = 'trial' } = req.body;

  if (!ownerPhone || !ownerEmail || !ownerPassword || !storeName || !storeSlug) {
    return next(new AppError('Owner phone, email, password, store name, and slug are required.', 400));
  }
  const result = await runInTransaction(async (session) => {
    if (await User.exists({ email: ownerEmail }).session(session)) {
      throw new AppError('Owner email is already registered.', 409);
    }
    if (await Store.exists({ slug: storeSlug }).session(session)) {
      throw new AppError('Store slug is already in use.', 409);
    }
    const planDoc = await Plan.findOne({ name: plan, isActive: true }).session(session);
    const durationDays = planDoc?.durationDays || 30;
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const [store] = await Store.create([{
      name: String(storeName).trim(),
      slug: String(storeSlug).trim().toLowerCase(),
      subscription: {
        plan,
        planId: planDoc?._id,
        expiresAt,
        isActive: true,
      },
      moduleSettings: {
        enabledModules: planDoc?.modules || ['pos', 'inventory', 'storefront'],
      },
      ...(planDoc?.limits ? { limits: planDoc.limits } : {}),
    }], { session });
    const [owner] = await User.create([{
      name: String(ownerName || `${storeName} Owner`).trim(),
      phone: ownerPhone,
      email: String(ownerEmail).trim().toLowerCase(),
      password: ownerPassword,
      role: 'store_owner',
      tenantId: store._id,
    }], { session });
    store.ownerId = owner._id;
    await store.save({ session });
    return { store, owner };
  });
  const { store, owner } = result;

  await logAudit({ tenantId: store._id, action: 'store_updated', user: req.user, description: `Store created by super admin: ${storeName}`, req });

  sendSuccess(res, { store, owner }, 201);
});

export const updateStoreSubscription = asyncHandler(async (req, res, next) => {
  const { plan, expiresAt, isActive, paymentRef } = req.body;
  const store = await Store.findById(req.params.id);
  if (!store) return next(new AppError('Store not found.', 404));

  if (plan) {
    const planDoc = await Plan.findOne({ name: plan });
    store.subscription.plan = plan;
    if (planDoc) {
      store.subscription.planId = planDoc._id;
      store.moduleSettings.enabledModules = planDoc.modules;
      store.limits = { ...store.limits, ...planDoc.limits };
    }
  }
  if (expiresAt) store.subscription.expiresAt = new Date(expiresAt);
  if (isActive !== undefined) store.subscription.isActive = isActive;
  if (paymentRef) store.subscription.paymentRef = paymentRef;
  await store.save();

  await logAudit({ tenantId: store._id, action: 'plan_changed', user: req.user, description: `Subscription updated: plan=${plan || store.subscription.plan}, expires=${expiresAt || store.subscription.expiresAt}`, req });

  sendSuccess(res, { store });
});

export const toggleStoreStatus = asyncHandler(async (req, res, next) => {
  const store = await Store.findById(req.params.id);
  if (!store) return next(new AppError('Store not found.', 404));
  store.isActive = !store.isActive;
  await store.save();
  await logAudit({ tenantId: store._id, action: 'store_updated', user: req.user, description: `Store ${store.isActive ? 'activated' : 'deactivated'}`, req });
  sendSuccess(res, { store });
});

export const updateStoreModules = asyncHandler(async (req, res, next) => {
  const { enabledModules } = req.body;
  const allowedModules = new Set([
    'pos', 'inventory', 'purchases', 'suppliers', 'packing', 'returns',
    'daily_closing', 'accounting', 'reports', 'storefront', 'coupons', 'offers',
  ]);
  if (!Array.isArray(enabledModules) || !enabledModules.every((module) => allowedModules.has(module))) {
    return next(new AppError('One or more modules are invalid.', 400));
  }
  const store = await Store.findByIdAndUpdate(
    req.params.id,
    { 'moduleSettings.enabledModules': enabledModules },
    { new: true }
  );
  if (!store) return next(new AppError('Store not found.', 404));
  await logAudit({ tenantId: store._id, action: 'store_updated', user: req.user, description: `Modules updated: ${enabledModules.join(', ')}`, req });
  sendSuccess(res, { store });
});

export const updateStoreLimits = asyncHandler(async (req, res, next) => {
  const updates = {};
  ['maxProducts', 'maxOrdersPerMonth', 'maxStaff', 'maxCustomers'].forEach((key) => {
    if (req.body[key] !== undefined) updates[`limits.${key}`] = req.body[key];
  });
  const store = await Store.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!store) return next(new AppError('Store not found.', 404));
  sendSuccess(res, { store });
});

export const logSupportAccess = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;
  const store = await Store.findById(req.params.id);
  if (!store) return next(new AppError('Store not found.', 404));

  store.supportAccess.push({
    adminId: req.user._id,
    adminName: req.user.name,
    reason: reason || 'Support access',
    ip: req.ip || req.headers['x-forwarded-for'],
  });
  if (store.supportAccess.length > 100) store.supportAccess = store.supportAccess.slice(-100);
  await store.save();

  await logAudit({ tenantId: store._id, action: 'admin_login', user: req.user, description: `Support access by ${req.user.name}: ${reason || 'No reason given'}`, req });

  sendSuccess(res, { message: 'Access logged.' });
});

export const getSupportAccessLogs = asyncHandler(async (req, res, next) => {
  const store = await Store.findById(req.params.id).select('supportAccess name slug');
  if (!store) return next(new AppError('Store not found.', 404));
  sendSuccess(res, { store, logs: store.supportAccess });
});
