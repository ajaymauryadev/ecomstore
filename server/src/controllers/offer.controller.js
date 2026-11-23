import Offer from '../models/Offer.js';
import Product from '../models/Product.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';

const WRITABLE_FIELDS = Object.freeze([
  'title', 'description', 'type', 'image', 'bundleItems', 'bundlePrice',
  'buyQuantity', 'getQuantity', 'buyProductId', 'buyVariantId', 'getProductId',
  'getVariantId', 'tiers', 'targetProductId', 'targetVariantId', 'minOrderValue',
  'isActive', 'startsAt', 'expiresAt', 'displayOrder',
]);

const offerPayload = (body) => {
  const value = {};
  WRITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) value[field] = body[field];
  });
  if (value.title !== undefined) value.title = String(value.title).trim().slice(0, 160);
  if (value.description !== undefined) value.description = String(value.description).trim().slice(0, 1000);
  if (value.bundlePrice != null) value.bundlePrice = fromMinorUnits(toMinorUnits(value.bundlePrice, 'bundle price', { allowZero: false }));
  if (value.minOrderValue != null) value.minOrderValue = fromMinorUnits(toMinorUnits(value.minOrderValue, 'minimum order value'));
  if (value.tiers) value.tiers = value.tiers.map((tier) => ({
    minQuantity: Number(tier.minQuantity),
    pricePerUnit: tier.pricePerUnit == null
      ? undefined
      : fromMinorUnits(toMinorUnits(tier.pricePerUnit, 'tier price', { allowZero: false })),
    discountPercent: tier.discountPercent == null ? undefined : Number(tier.discountPercent),
  }));
  return value;
};

const validateProductReferences = async (payload, tenantId) => {
  const pairs = [
    ...(payload.bundleItems || []).map((item) => [item.productId, item.variantId]),
    [payload.buyProductId, payload.buyVariantId],
    [payload.getProductId, payload.getVariantId],
    [payload.targetProductId, payload.targetVariantId],
  ].filter(([productId, variantId]) => productId || variantId);
  for (const [productId, variantId] of pairs) {
    if (!productId || !variantId) throw new AppError('Offer product references require both product and variant.', 400);
    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isActive: true,
      'variants._id': variantId,
    }).select('_id');
    if (!product) throw new AppError('An offer product variant does not belong to this store.', 400);
  }
};

export const getOffers = asyncHandler(async (req, res) => {
  const filter = { tenantId: req.tenantId };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  const offers = await Offer.find(filter).sort({ displayOrder: 1, createdAt: -1 }).limit(500).lean();
  sendSuccess(res, { offers });
});

export const createOffer = asyncHandler(async (req, res) => {
  const payload = offerPayload(req.body);
  await validateProductReferences(payload, req.tenantId);
  const offer = await Offer.create({ ...payload, tenantId: req.tenantId });
  sendSuccess(res, { offer }, 201);
});

export const updateOffer = asyncHandler(async (req, res, next) => {
  const payload = offerPayload(req.body);
  await validateProductReferences(payload, req.tenantId);
  const offer = await Offer.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { $set: payload },
    { new: true, runValidators: true }
  );
  if (!offer) return next(new AppError('Offer not found.', 404));
  sendSuccess(res, { offer });
});

export const deleteOffer = asyncHandler(async (req, res, next) => {
  const offer = await Offer.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!offer) return next(new AppError('Offer not found.', 404));
  sendSuccess(res, { offer, message: 'Offer deactivated.' });
});
