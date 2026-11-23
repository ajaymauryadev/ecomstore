import crypto from 'crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import CouponUsage from '../models/CouponUsage.js';
import { AppError } from '../utils/AppError.js';
import {
  assertPositiveInteger,
  fromMinorUnits,
  percentOf,
  toMinorUnits,
} from '../utils/money.js';
import { env } from '../config/env.js';

export const PUBLIC_ORDER_TYPES = Object.freeze([
  'home_delivery', 'self_pickup',
]);

const PAYMENT_METHODS_BY_ORDER_TYPE = Object.freeze({
  home_delivery: Object.freeze(['upi_qr', 'upi_id', 'cod']),
  self_pickup: Object.freeze(['upi_qr', 'upi_id', 'cash_on_pickup']),
});

const normalizeId = (value, field) => {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} is invalid.`, 400);
  return String(value);
};

const normalizeCart = (items) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new AppError('Order must contain between 1 and 100 items.', 400);
  }

  const grouped = new Map();
  items.forEach((item, index) => {
    const productId = normalizeId(item?.productId, `items[${index}].productId`);
    const variantId = normalizeId(item?.variantId, `items[${index}].variantId`);
    const quantity = assertPositiveInteger(item?.quantity, `items[${index}].quantity`, 1000);
    const key = `${productId}:${variantId}`;
    const nextQuantity = (grouped.get(key)?.quantity || 0) + quantity;
    if (nextQuantity > 1000) throw new AppError('Quantity per variant cannot exceed 1000.', 400);
    grouped.set(key, { productId, variantId, quantity: nextQuantity });
  });
  return [...grouped.values()];
};

const getSellingPrice = (variant, orderType) => {
  const retailMinor = toMinorUnits(variant.retailPrice, 'retail price', { allowZero: false });
  if (orderType === 'wholesale' && variant.wholesalePrice != null) {
    return {
      priceMinor: toMinorUnits(variant.wholesalePrice, 'wholesale price', { allowZero: false }),
      mrpMinor: retailMinor,
    };
  }

  if (variant.offerPrice != null) {
    const offerMinor = toMinorUnits(variant.offerPrice, 'offer price', { allowZero: false });
    if (offerMinor > retailMinor) throw new AppError('Product offer price configuration is invalid.', 409);
    return { priceMinor: offerMinor, mrpMinor: retailMinor };
  }
  return { priceMinor: retailMinor, mrpMinor: retailMinor };
};

const getCustomerKey = ({ tenantId, customerId, customerPhone }) => {
  const identity = customerId ? `user:${customerId}` : `guest:${String(customerPhone || '').trim()}`;
  return crypto.createHmac('sha256', env.COOKIE_SECRET)
    .update(`${tenantId}:${identity}`)
    .digest('hex');
};

const validateCouponDocument = ({ coupon, subtotalMinor, orderType, orderItems, customerId }) => {
  const now = Date.now();
  if (!coupon?.isActive || (coupon.startsAt && coupon.startsAt.getTime() > now) ||
      (coupon.expiresAt && coupon.expiresAt.getTime() < now)) {
    throw new AppError('Coupon is expired or inactive.', 400);
  }

  if (coupon.usageLimitTotal != null && coupon.usedCount >= coupon.usageLimitTotal) {
    throw new AppError('Coupon usage limit has been reached.', 400);
  }

  const minOrderMinor = toMinorUnits(coupon.minOrderValue || 0, 'coupon minimum order');
  if (subtotalMinor < minOrderMinor) {
    throw new AppError(`Minimum order value ${fromMinorUnits(minOrderMinor)} is required for this coupon.`, 400);
  }

  if (coupon.applicableOrderTypes?.length && !coupon.applicableOrderTypes.includes(orderType)) {
    throw new AppError('Coupon is not applicable to this order type.', 400);
  }

  if (coupon.applicableCustomerIds?.length) {
    if (!customerId || !coupon.applicableCustomerIds.some((id) => id.toString() === customerId.toString())) {
      throw new AppError('Coupon is not available for this customer.', 400);
    }
  }

  const productIds = new Set((coupon.applicableProductIds || []).map(String));
  const categoryIds = new Set((coupon.applicableCategoryIds || []).map(String));
  const isRestricted = productIds.size > 0 || categoryIds.size > 0;
  const eligibleMinor = orderItems.reduce((sum, item) => {
    item.couponEligible = !isRestricted || productIds.has(String(item.productId)) ||
      categoryIds.has(String(item.categoryId));
    return item.couponEligible ? sum + item.totalMinor : sum;
  }, 0);

  if (eligibleMinor <= 0) throw new AppError('Coupon does not apply to any item in this order.', 400);

  let discountMinor;
  if (coupon.type === 'percent') {
    discountMinor = percentOf(eligibleMinor, coupon.value, 'coupon percentage');
  } else {
    discountMinor = toMinorUnits(coupon.value, 'coupon value');
  }

  if (coupon.maxDiscount != null) {
    discountMinor = Math.min(discountMinor, toMinorUnits(coupon.maxDiscount, 'maximum coupon discount'));
  }
  return Math.min(discountMinor, eligibleMinor, subtotalMinor);
};

const claimCouponUsage = async ({ coupon, tenantId, customerKey, session }) => {
  const totalFilter = { _id: coupon._id, tenantId, isActive: true };
  if (coupon.usageLimitTotal != null) totalFilter.usedCount = { $lt: coupon.usageLimitTotal };
  const claimed = await Coupon.updateOne(totalFilter, { $inc: { usedCount: 1 } }, { session });
  if (claimed.modifiedCount !== 1) throw new AppError('Coupon usage limit has been reached.', 409);

  if (coupon.usageLimitPerUser != null) {
    try {
      const usage = await CouponUsage.findOneAndUpdate(
        {
          tenantId,
          couponId: coupon._id,
          customerKey,
          count: { $lt: coupon.usageLimitPerUser },
        },
        { $inc: { count: 1 } },
        { upsert: true, new: true, session, setDefaultsOnInsert: true }
      );
      if (!usage) throw new AppError('Coupon usage limit for this customer has been reached.', 409);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error?.code !== 11000) throw error;
      throw new AppError('Coupon usage limit for this customer has been reached.', 409);
    }
  }
};

const getDeliveryPricing = ({ store, orderType, subtotalAfterDiscountMinor, deliveryArea }) => {
  if (!['home_delivery', 'online'].includes(orderType)) {
    return { deliveryMinor: 0, minimumMinor: 0, area: null };
  }

  const delivery = store.deliverySettings || {};
  const areas = Array.isArray(delivery.areas) ? delivery.areas : [];
  let area = null;
  if (deliveryArea) {
    area = areas.find((candidate) =>
      candidate.name?.trim().toLowerCase() === String(deliveryArea).trim().toLowerCase());
    if (!area) throw new AppError('Selected delivery area is not available.', 400);
  }

  const globalMinimum = toMinorUnits(delivery.minOrderAmount || 0, 'minimum order');
  const areaMinimum = toMinorUnits(area?.minOrder || 0, 'delivery area minimum order');
  const minimumMinor = Math.max(globalMinimum, areaMinimum);
  if (subtotalAfterDiscountMinor < minimumMinor) {
    throw new AppError(`Minimum order value ${fromMinorUnits(minimumMinor)} is required for delivery.`, 400);
  }

  const freeAboveMinor = toMinorUnits(delivery.freeDeliveryAbove || 0, 'free delivery threshold');
  const baseChargeMinor = toMinorUnits(
    area ? area.charge : (delivery.defaultCharge || 0),
    'delivery charge'
  );
  const deliveryMinor = freeAboveMinor > 0 && subtotalAfterDiscountMinor >= freeAboveMinor
    ? 0
    : baseChargeMinor;
  return { deliveryMinor, minimumMinor, area: area?.name || null };
};

export const calculateOrderQuote = async ({
  tenantId,
  store,
  items,
  orderType,
  paymentMethod,
  couponCode,
  customerId,
  customerPhone,
  deliveryArea,
  claimCoupon = false,
  session,
}) => {
  if (!PUBLIC_ORDER_TYPES.includes(orderType)) throw new AppError('Invalid customer order type.', 400);
  if (!PAYMENT_METHODS_BY_ORDER_TYPE[orderType]?.includes(paymentMethod)) {
    throw new AppError('Payment method is not available for this order type.', 400);
  }

  const cart = normalizeCart(items);
  const productIds = [...new Set(cart.map((item) => item.productId))];
  let query = Product.find({
    _id: { $in: productIds }, tenantId, isActive: true, isOnline: true,
  });
  if (session) query = query.session(session);
  const products = await query;
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const orderItems = [];
  let subtotalMinor = 0;

  for (const cartItem of cart) {
    const product = productMap.get(cartItem.productId);
    if (!product) throw new AppError('One or more products are not available.', 400);
    const variant = product.variants.id(cartItem.variantId);
    if (!variant?.isActive) throw new AppError(`A variant of ${product.name} is not available.`, 400);
    if (!Number.isFinite(variant.stock) || variant.stock < cartItem.quantity) {
      throw new AppError(`Insufficient stock for ${product.name} (${variant.name}).`, 409);
    }
    const { priceMinor, mrpMinor } = getSellingPrice(variant, orderType);
    const totalMinor = priceMinor * cartItem.quantity;
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
      throw new AppError('Calculated line total is invalid.', 409);
    }
    subtotalMinor += totalMinor;
    orderItems.push({
      productId: product._id,
      variantId: variant._id,
      categoryId: product.categoryId,
      name: product.name,
      variantName: variant.name,
      unit: variant.unit,
      image: product.images?.find((image) => image.isMain)?.url ?? product.images?.[0]?.url,
      quantity: cartItem.quantity,
      mrp: fromMinorUnits(mrpMinor),
      price: fromMinorUnits(priceMinor),
      unitCost: variant.purchasePrice ?? null,
      total: fromMinorUnits(totalMinor),
      totalMinor,
      stockBefore: variant.stock,
    });
  }

  let coupon = null;
  let couponDiscountMinor = 0;
  if (couponCode) {
    const normalizedCode = String(couponCode).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(normalizedCode)) throw new AppError('Coupon code is invalid.', 400);
    let couponQuery = Coupon.findOne({ tenantId, code: normalizedCode });
    if (session) couponQuery = couponQuery.session(session);
    coupon = await couponQuery;
    if (!coupon) throw new AppError('Coupon code is invalid.', 400);
    couponDiscountMinor = validateCouponDocument({
      coupon, subtotalMinor, orderType, orderItems, customerId,
    });
    if (claimCoupon) {
      if (!session) throw new Error('Coupon claims require a database transaction.');
      await claimCouponUsage({
        coupon,
        tenantId,
        customerKey: getCustomerKey({ tenantId, customerId, customerPhone }),
        session,
      });
    }
  }

  const discountedSubtotalMinor = subtotalMinor - couponDiscountMinor;
  const { deliveryMinor, area } = getDeliveryPricing({
    store, orderType, subtotalAfterDiscountMinor: discountedSubtotalMinor, deliveryArea,
  });
  const taxSettings = store.taxSettings || {};
  const taxPercent = taxSettings.enableGST
    ? Number(taxSettings.cgstPercent || 0) + Number(taxSettings.sgstPercent || 0)
    : 0;
  const taxMinor = percentOf(discountedSubtotalMinor, taxPercent, 'total tax percentage');
  const grandTotalMinor = discountedSubtotalMinor + deliveryMinor + taxMinor;
  if (!Number.isSafeInteger(grandTotalMinor) || grandTotalMinor < 0) {
    throw new AppError('Calculated order total is invalid.', 409);
  }

  return {
    orderItems,
    coupon,
    deliveryArea: area,
    pricing: {
      subtotal: fromMinorUnits(subtotalMinor),
      couponDiscount: fromMinorUnits(couponDiscountMinor),
      deliveryCharge: fromMinorUnits(deliveryMinor),
      tax: fromMinorUnits(taxMinor),
      grandTotal: fromMinorUnits(grandTotalMinor),
    },
  };
};
