import Store from '../models/Store.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';

export const requireCustomerStore = asyncHandler(async (req, res, next) => {
  const store = await Store.findOne({
    slug: req.params.slug,
    isActive: true,
    'subscription.isActive': true,
    'subscription.expiresAt': { $gt: new Date() },
  }).select('_id name slug');
  if (!store) return next(new AppError('Store not found or unavailable.', 404));
  if (req.user?.role !== 'customer' || req.user.tenantId?.toString() !== store._id.toString()) {
    return next(new AppError('Store access denied.', 403));
  }
  req.store = store;
  req.tenantId = store._id;
  next();
});
