import Store from '../models/Store.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';
import { escapeRegex, parsePagination } from '../utils/query.js';

export const getAllStores = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

  const filter = {};
  if (req.query.search) {
    const pattern = new RegExp(escapeRegex(String(req.query.search).trim().slice(0, 80)), 'i');
    filter.$or = [
      { name: pattern },
      { slug: pattern },
    ];
  }
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

  const [stores, total] = await Promise.all([
    Store.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('ownerId', 'name email'),
    Store.countDocuments(filter),
  ]);

  sendPaginated(res, stores, total, page, limit);
});

export const getMyStore = asyncHandler(async (req, res, next) => {
  const canViewSettings = hasPermission(req.user, PERMISSIONS.SETTINGS_VIEW);
  let query = Store.findById(req.tenantId);
  if (canViewSettings) query = query.populate('ownerId', 'name email phone');
  else query = query.select('name slug branding settings.currency settings.timezone businessHours isActive subscription');
  const store = await query;
  if (!store) return next(new AppError('Store not found.', 404));
  sendSuccess(res, { store });
});

export const updateMyStore = asyncHandler(async (req, res, next) => {
  const store = await Store.findById(req.tenantId);
  if (!store) return next(new AppError('Store not found.', 404));

  const assignFields = (target, source, allowed) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    allowed.forEach((field) => {
      if (source[field] !== undefined) target[field] = source[field];
    });
  };
  if (req.body.name !== undefined) store.name = String(req.body.name).trim();
  assignFields(store.address, req.body.address, ['street', 'city', 'state', 'pincode', 'country']);
  assignFields(store.contact, req.body.contact, ['phone', 'email', 'whatsapp']);
  assignFields(store.branding, req.body.branding, ['logo', 'banner', 'primaryColor', 'tagline']);
  assignFields(store.settings, req.body.settings, [
    'currency', 'timezone', 'taxRate', 'lowStockThreshold', 'orderPrefix',
    'allowCustomerOrders', 'requirePinForSales',
  ]);
  assignFields(store.paymentSettings, req.body.paymentSettings, [
    'upiId', 'upiName', 'upiQrUrl', 'bankAccount', 'bankIfsc', 'bankName', 'bankAccountName',
  ]);
  assignFields(store.deliverySettings, req.body.deliverySettings, [
    'defaultCharge', 'freeDeliveryAbove', 'minOrderAmount',
  ]);
  if (req.body.deliverySettings?.areas !== undefined) {
    if (!Array.isArray(req.body.deliverySettings.areas) || req.body.deliverySettings.areas.length > 100) {
      return next(new AppError('Delivery areas must be an array of at most 100 entries.', 400));
    }
    store.deliverySettings.areas = req.body.deliverySettings.areas.map((area) => ({
      name: String(area.name || '').trim().slice(0, 100),
      charge: area.charge,
      minOrder: area.minOrder,
    }));
    if (store.deliverySettings.areas.some((area) => !area.name)) {
      return next(new AppError('Every delivery area requires a name.', 400));
    }
  }
  assignFields(store.businessHours, req.body.businessHours, [
    'openTime', 'closeTime', 'pickupOpenTime', 'pickupCloseTime', 'closedDays',
  ]);
  assignFields(store.orderSettings, req.body.orderSettings, ['isAcceptingOrders', 'autoAccept', 'allowGuest']);
  assignFields(store.taxSettings, req.body.taxSettings, ['enableGST', 'gstNumber', 'cgstPercent', 'sgstPercent']);
  await store.save();

  sendSuccess(res, { store });
});

export const getStoreBySlug = asyncHandler(async (req, res, next) => {
  const store = await Store.findOne({ slug: req.params.slug, isActive: true }).select(
    'name slug branding settings.currency settings.allowCustomerOrders contact address'
  );
  if (!store) return next(new AppError('Store not found.', 404));
  sendSuccess(res, { store });
});

export const toggleStoreStatus = asyncHandler(async (req, res, next) => {
  const store = await Store.findById(req.params.id);
  if (!store) return next(new AppError('Store not found.', 404));

  store.isActive = !store.isActive;
  await store.save();

  sendSuccess(res, { store });
});

export const getStoreStats = asyncHandler(async (req, res) => {
  const [total, active, expiring] = await Promise.all([
    Store.countDocuments(),
    Store.countDocuments({ isActive: true }),
    Store.countDocuments({
      'subscription.expiresAt': {
        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        $gte: new Date(),
      },
      'subscription.isActive': true,
    }),
  ]);

  sendSuccess(res, { total, active, inactive: total - active, expiringThisWeek: expiring });
});
