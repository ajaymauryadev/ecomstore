import Store from '../models/Store.js';
import Order from '../models/Order.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { hashGuestOrderToken } from '../utils/orderAccessToken.js';

const notFound = () => new AppError('Order not found.', 404);

export const requireCustomerOrderAccess = asyncHandler(async (req, res, next) => {
  const store = await Store.findOne({ slug: req.params.slug, isActive: true }).select('_id slug');
  if (!store) return next(new AppError('Store not found.', 404));
  if (!mongoose.isValidObjectId(req.params.orderId)) return next(notFound());

  const order = await Order.findOne({ _id: req.params.orderId, tenantId: store._id })
    .select('+guestAccessTokenHash');
  if (!order) return next(notFound());

  if (req.user) {
    const sameTenant = req.user.tenantId?.toString() === store._id.toString();
    const ownsOrder = order.customerId?.toString() === req.user._id.toString();
    if (req.user.role !== 'customer' || !sameTenant || !ownsOrder) return next(notFound());
  } else {
    const token = req.get('x-order-access-token');
    if (!token || token.length < 32 || token.length > 256 || !order.guestAccessTokenHash) return next(notFound());
    const suppliedHash = Buffer.from(hashGuestOrderToken(token), 'hex');
    const storedHash = Buffer.from(order.guestAccessTokenHash, 'hex');
    if (suppliedHash.length !== storedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
      return next(notFound());
    }
  }

  req.store = store;
  req.order = order;
  req.tenantId = store._id;
  next();
});
