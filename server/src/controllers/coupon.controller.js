import Coupon from '../models/Coupon.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { parsePagination } from '../utils/query.js';

const WRITABLE_FIELDS = Object.freeze([
  'code',
  'description',
  'type',
  'value',
  'maxDiscount',
  'minOrderValue',
  'usageLimitTotal',
  'usageLimitPerUser',
  'applicableOrderTypes',
  'applicableProductIds',
  'applicableCategoryIds',
  'applicableCustomerIds',
  'isActive',
  'startsAt',
  'expiresAt',
]);

const sanitizeCouponInput = (body, { creating = false } = {}) => {
  const values = {};
  WRITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) values[field] = body[field];
  });
  if (values.code !== undefined) values.code = String(values.code).trim().toUpperCase();
  if (values.description !== undefined) values.description = String(values.description).trim().slice(0, 500);
  if (creating) delete values.isActive;
  return values;
};

export const getCoupons = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const filter = { tenantId: req.tenantId };
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;
  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Coupon.countDocuments(filter),
  ]);
  sendPaginated(res, coupons, total, page, limit);
});

export const createCoupon = asyncHandler(async (req, res, next) => {
  try {
    const coupon = await Coupon.create({
      ...sanitizeCouponInput(req.body, { creating: true }),
      tenantId: req.tenantId,
    });
    sendSuccess(res, { coupon }, 201);
  } catch (error) {
    if (error.code === 11000) return next(new AppError('Coupon code already exists.', 409));
    throw error;
  }
});

export const updateCoupon = asyncHandler(async (req, res, next) => {
  const updates = sanitizeCouponInput(req.body);
  delete updates.usedCount;
  try {
    const coupon = await Coupon.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!coupon) return next(new AppError('Coupon not found.', 404));
    sendSuccess(res, { coupon });
  } catch (error) {
    if (error.code === 11000) return next(new AppError('Coupon code already exists.', 409));
    throw error;
  }
});

export const deleteCoupon = asyncHandler(async (req, res, next) => {
  const coupon = await Coupon.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!coupon) return next(new AppError('Coupon not found.', 404));
  sendSuccess(res, { coupon, message: 'Coupon deactivated.' });
});
