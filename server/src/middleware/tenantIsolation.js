import Store from '../models/Store.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { resolveStoreTimeZone } from '../utils/accountingDay.js';

export const tenantIsolation = asyncHandler(async (req, res, next) => {
  if (req.user?.role === 'super_admin') return next();

  const tenantId = req.tenantId || req.user?.tenantId;

  if (!tenantId) return next(new AppError('Tenant context required.', 403));

  if (req.store) {
    req.storeTimeZone = resolveStoreTimeZone(req.store.settings?.timezone);
    return next();
  }

  const store = await Store.findById(tenantId).select('_id name slug isActive subscription settings.timezone');
  if (!store) return next(new AppError('Store not found.', 404));
  if (!store.isActive) return next(new AppError('Store is deactivated.', 403));
  if (!store.subscription?.isActive) return next(new AppError('Store subscription expired.', 402));
  if (store.subscription?.expiresAt && store.subscription.expiresAt <= new Date()) {
    return next(new AppError('Store subscription expired.', 402));
  }

  req.store = store;
  req.tenantId = store._id;
  req.storeTimeZone = resolveStoreTimeZone(store.settings?.timezone);
  next();
});

export const scopeToTenant = (Model) => ({
  find: (tenantId, query = {}) => Model.find({ ...query, tenantId }),
  findOne: (tenantId, query = {}) => Model.findOne({ ...query, tenantId }),
});
