import Store from '../models/Store.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import PackingSession from '../models/PackingSession.js';
import Return, { ACTIVE_RETURN_STATUSES } from '../models/Return.js';
import { fulfilledDiscountMinor, snapshotRefundLines } from '../utils/refundAmounts.js';
import RefreshToken from '../models/RefreshToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import {
  generateTokens, hashToken, setRefreshCookie, getTokenExpiry,
} from '../utils/jwt.js';
import { emitToTenant, emitToUser, emitToWorkers } from '../config/socket.js';
import { notifyAdmin, notifyCustomer, notifyStaff, notifyTeam } from '../services/notification.service.js';
import { logAudit } from '../services/audit.service.js';
import { calculateOrderQuote } from '../services/checkout.service.js';
import {
  consumeOrderReservation,
  reserveOrderStock,
  restoreOrderStock,
  restoreUnfulfilledStock,
} from '../services/stock.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { submitOrder } from '../services/orderSubmission.service.js';
import { adjustPOSUdharBalance } from '../services/udharLedger.service.js';
import { prepareCustomer, paymentSummary, billPaymentsPage } from '../services/udharAllocation.service.js';
import { cursorFilter, cursorMeta } from '../utils/cursor.js';
import { customerOrderResponse, publicPaymentSettingsFor, stripOrderItemCosts } from '../utils/orderResponse.js';
import { canTransitionOrder } from '../constants/orderStatus.js';
import { parsePagination } from '../utils/query.js';
import { escapeRegex } from '../utils/query.js';
import { resolvePaymentProofPath, UPLOADS_ROOT } from '../middleware/upload.js';
import { deleteStoredImage, downloadRemoteAsset, remoteAsset } from '../services/imageStorage.service.js';
import { fromMinorUnits, percentOf, toMinorUnits } from '../utils/money.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';
import StaffActivityLog from '../models/StaffActivityLog.js';
import { actorSnapshot, recordOrderAction } from '../utils/orderAttribution.js';

/* ─── Safe socket emit (no-op if socket not ready) ───── */
const safeEmitTenant = (tenantId, event, data) => {
  try { emitToTenant(tenantId, event, data); } catch {}
};
const safeEmitUser = (userId, event, data) => {
  try { emitToUser(userId, event, data); } catch {}
};
const refreshWorkers = (order) => {
  try { emitToWorkers(order.tenantId, 'order:updated', { orderId: order._id, status: order.status }); } catch {}
};

/* ─── Internal helpers ────────────────────────────── */
const findStore = async (slug) => {
  return Store.findOne({
    slug,
    isActive: true,
    'subscription.isActive': true,
    'subscription.expiresAt': { $gt: new Date() },
  }).select('_id ownerId name slug branding settings contact paymentSettings deliverySettings taxSettings orderSettings');
};

const saveRefreshToken = async (userId, rawToken, req, session) => {
  const values = {
    userId,
    token: hashToken(rawToken),
    expiresAt: getTokenExpiry(rawToken),
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };
  if (session) return RefreshToken.create([values], { session });
  return RefreshToken.create(values);
};

/* ─────────────────────────────────────────────────────
   PUBLIC STOREFRONT
   ──────────────────────────────────────────────────── */

export const getStorefrontInfo = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  sendSuccess(res, { store: {
    _id: store._id,
    name: store.name,
    slug: store.slug,
    branding: store.branding,
    contact: store.contact,
    paymentSettings: publicPaymentSettingsFor(store, 'upi_id'),
    settings: { currency: store.settings?.currency, timezone: store.settings?.timezone },
    deliverySettings: store.deliverySettings,
    taxSettings: {
      enableGST: store.taxSettings?.enableGST,
      cgstPercent: store.taxSettings?.cgstPercent,
      sgstPercent: store.taxSettings?.sgstPercent,
    },
    orderSettings: {
      isAcceptingOrders: store.orderSettings?.isAcceptingOrders,
      allowGuest: false,
    },
  } });
});

export const getStorefrontCategories = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  const categories = await Category.find({ tenantId: store._id, isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .select('name emoji image parentId');
  sendSuccess(res, { categories });
});

export const getStorefrontProducts = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));

  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 24, maxLimit: 60 });

  const filter = {
    tenantId: store._id,
    isActive: true,
    isOnline: true,
    variants: { $elemMatch: { isActive: true } },
  };

  if (req.query.search) {
    const pattern = new RegExp(escapeRegex(String(req.query.search).trim().slice(0, 80)), 'i');
    filter.$or = [{ name: pattern }, { brand: pattern }, { tags: { $in: [pattern] } }, { 'variants.name': pattern }, { 'variants.barcode': pattern }];
  }
  if (req.query.categoryId && req.query.categoryId !== 'all') {
    if (!mongoose.isValidObjectId(req.query.categoryId)) return next(new AppError('Invalid category.', 400));
    const categories = await Category.find({ tenantId: store._id, isActive: true }).select('parentId').lean();
    const children = new Map();
    for (const category of categories) {
      const parent = String(category.parentId);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(String(category._id));
    }
    const selected = String(req.query.categoryId);
    const queue = categories.some((category) => String(category._id) === selected) ? [selected] : [];
    const ids = new Set(queue);
    for (let index = 0; index < queue.length; index += 1) {
      for (const id of children.get(queue[index]) || []) {
        if (!ids.has(id)) { ids.add(id); queue.push(id); }
      }
    }
    filter.categoryId = { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.inStock === 'true') filter.variants.$elemMatch.stock = { $gt: 0 };
  if (req.query.offer === 'true') {
    filter.$expr = { $anyElementTrue: { $map: {
      input: '$variants', as: 'variant', in: { $and: [
        { $eq: ['$$variant.isActive', true] },
        { $ne: [{ $ifNull: ['$$variant.offerPrice', null] }, null] },
        { $lt: ['$$variant.offerPrice', '$$variant.retailPrice'] },
        ...(req.query.inStock === 'true' ? [{ $gt: ['$$variant.stock', 0] }] : []),
      ] },
    } } };
  }

  const sort = req.query.sort === 'newest' ? { createdAt: -1, _id: 1 }
    : req.query.sort === 'name' ? { name: 1, _id: 1 }
    : { isFeatured: -1, updatedAt: -1, _id: 1 };

  // Match the card's default variant: first active pack in stock, otherwise first active pack.
  // Sorting uses its actual selling price after any offer.
  const priceSort = ['price_asc', 'price_desc'].includes(req.query.sort);
  const productQuery = priceSort ? Product.aggregate([
    { $match: filter },
    { $addFields: { _catalogVariant: { $let: {
      vars: { active: { $filter: { input: '$variants', as: 'variant', cond: { $eq: ['$$variant.isActive', true] } } } },
      in: { $ifNull: [
        { $arrayElemAt: [{ $filter: { input: '$$active', as: 'variant', cond: { $gt: ['$$variant.stock', 0] } } }, 0] },
        { $arrayElemAt: ['$$active', 0] },
      ] },
    } } } },
    { $addFields: { _catalogPrice: { $ifNull: ['$_catalogVariant.offerPrice', '$_catalogVariant.retailPrice'] } } },
    { $sort: { _catalogPrice: req.query.sort === 'price_asc' ? 1 : -1, _id: 1 } },
    { $skip: skip }, { $limit: limit },
    { $project: { _catalogPrice: 0, _catalogVariant: 0, tenantId: 0 } },
  ]).then((rows) => Product.populate(rows.map((row) => Product.hydrate(row)), { path: 'categoryId', select: 'name emoji' }))
    : Product.find(filter).sort(sort).skip(skip).limit(limit)
      .populate('categoryId', 'name emoji').select('-tenantId');

  const [products, total] = await Promise.all([
    productQuery,
    Product.countDocuments(filter),
  ]);

  sendPaginated(res, products, total, page, limit);
});

export const getStorefrontProduct = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));

  const product = await Product.findOne({
    _id: req.params.productId,
    tenantId: store._id,
    isActive: true,
    isOnline: true,
  }).populate('categoryId', 'name emoji').select('-tenantId');

  if (!product) return next(new AppError('Product not found.', 404));

  const related = await Product.find({
    tenantId: store._id,
    categoryId: product.categoryId,
    _id: { $ne: product._id },
    isActive: true,
    isOnline: true,
  }).limit(8).select('name images variants brand categoryId isFeatured').lean({ virtuals: true });

  sendSuccess(res, { product, related });
});

export const getCartProducts = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));

  const products = await Product.find({
    _id: { $in: req.body.productIds },
    tenantId: store._id,
    isActive: true,
    isOnline: true,
  }).select('name images variants');

  sendSuccess(res, {
    products: products.map(({ _id, name, mainImage, variants }) => ({
      _id,
      name,
      mainImage,
      variants: variants.filter((variant) => variant.isActive).map((variant) => ({
        _id: variant._id,
        name: variant.name,
        unit: variant.unit,
        stock: variant.stock,
        retailPrice: variant.retailPrice,
        offerPrice: variant.offerPrice,
      })),
    })),
  });
});

/* ─────────────────────────────────────────────────────
   CUSTOMER AUTH (store-scoped)
   ──────────────────────────────────────────────────── */

export const customerRegister = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));

  const { name, phone, password, email } = req.body;
  if (!name || !phone || !password) return next(new AppError('Name, phone, and password are required.', 400));
  if (!/^[6-9]\d{9}$/.test(phone)) return next(new AppError('Enter a valid 10-digit Indian mobile number.', 400));
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return next(new AppError('Password must be between 10 and 128 characters.', 400));
  }
  const cleanName = String(name).trim().slice(0, 80);
  const cleanEmail = email ? String(email).trim().toLowerCase().slice(0, 254) : undefined;
  if (!cleanName) return next(new AppError('Name is required.', 400));
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return next(new AppError('Enter a valid email address.', 400));
  }

  const existing = await User.findOne({ phone, tenantId: store._id, role: 'customer' });
  if (existing) return next(new AppError('Phone number already registered at this store.', 409));

  const result = await runInTransaction(async (session) => {
    const activeCustomers = await User.countDocuments({
      tenantId: store._id, role: 'customer', isActive: true,
    }).session(session);
    await Store.updateOne(
      { _id: store._id, customerCount: { $exists: false } },
      { $set: { customerCount: activeCustomers } },
      { session }
    );
    const capacity = await Store.updateOne(
      {
        _id: store._id,
        $expr: { $lt: ['$customerCount', '$limits.maxCustomers'] },
      },
      { $inc: { customerCount: 1 } },
      { session }
    );
    if (capacity.modifiedCount !== 1) {
      throw new AppError('This store has reached its customer account limit.', 409);
    }
    const [created] = await User.create([{
      name: cleanName, phone, password,
      email: cleanEmail,
      role: 'customer',
      tenantId: store._id,
    }], { session });
    const tokens = generateTokens(created);
    await saveRefreshToken(created._id, tokens.refreshToken, req, session);
    return { user: created, ...tokens };
  });
  const { user, accessToken, refreshToken } = result;
  setRefreshCookie(res, refreshToken);

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.tokenVersion;

  sendSuccess(res, { user: userObj, accessToken, store: { _id: store._id, name: store.name, slug: store.slug } }, 201);
});

export const customerLogin = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));

  const { phone, password } = req.body;
  if (!phone || !password) return next(new AppError('Phone and password are required.', 400));

  const user = await User.findOne({ phone, tenantId: store._id, role: 'customer' })
    .select('+password +tokenVersion');
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid phone number or password.', 401));
  }
  if (!user.isActive) return next(new AppError('Account is disabled. Contact the store.', 403));

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const { accessToken, refreshToken } = generateTokens(user);
  await saveRefreshToken(user._id, refreshToken, req);
  setRefreshCookie(res, refreshToken);

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.tokenVersion;

  sendSuccess(res, { user: userObj, accessToken, store: { _id: store._id, name: store.name, slug: store.slug } });
});

/* ─────────────────────────────────────────────────────
   CUSTOMER PROFILE
   ──────────────────────────────────────────────────── */

export const getCustomerProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).select('-password');
  if (!user) return next(new AppError('User not found.', 404));
  sendSuccess(res, { user });
});

export const updateCustomerProfile = asyncHandler(async (req, res, next) => {
  const { name, email } = req.body;
  const update = {};
  if (name) update.name = name;
  if (email) update.email = email;

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true }).select('-password');
  sendSuccess(res, { user });
});

export const saveAddress = asyncHandler(async (req, res, next) => {
  const { label = 'Home', line1, landmark, city, state, pincode, isDefault = false, addressId } = req.body;
  if (!line1 || !city) return next(new AppError('Address line 1 and city are required.', 400));

  const user = await User.findById(req.user._id);
  if (!user) return next(new AppError('User not found.', 404));

  if (isDefault) {
    user.savedAddresses.forEach((a) => { a.isDefault = false; });
  }

  if (addressId) {
    const addr = user.savedAddresses.id(addressId);
    if (!addr) return next(new AppError('Address not found.', 404));
    Object.assign(addr, { label, line1, landmark, city, state, pincode, isDefault });
  } else {
    if (user.savedAddresses.length >= 20) {
      return next(new AppError('A maximum of 20 saved addresses is allowed.', 409));
    }
    user.savedAddresses.push({ label, line1, landmark, city, state, pincode, isDefault: isDefault || user.savedAddresses.length === 0 });
  }

  await user.save();
  sendSuccess(res, { addresses: user.savedAddresses });
});

export const deleteAddress = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) return next(new AppError('User not found.', 404));
  user.savedAddresses = user.savedAddresses.filter((a) => a._id.toString() !== req.params.addressId);
  await user.save();
  sendSuccess(res, { addresses: user.savedAddresses });
});

export const toggleFavorite = asyncHandler(async (req, res, next) => {
  const { productId } = req.body;
  const available = await Product.exists({
    _id: productId, tenantId: req.tenantId, isActive: true, isOnline: true,
  });
  if (!available) return next(new AppError('Product not found.', 404));
  const user = await User.findById(req.user._id);
  const idx = user.favoriteProductIds.findIndex((id) => id.toString() === productId);
  if (idx >= 0) user.favoriteProductIds.splice(idx, 1);
  else {
    if (user.favoriteProductIds.length >= 500) return next(new AppError('Favorites limit reached.', 409));
    user.favoriteProductIds.push(productId);
  }
  await user.save();
  sendSuccess(res, { favorites: user.favoriteProductIds, isFavorited: idx < 0 });
});

export const getFavorites = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  const products = await Product.find({
    _id: { $in: user.favoriteProductIds },
    tenantId: req.tenantId,
    isActive: true,
    isOnline: true,
  }).select('name images variants brand isFeatured categoryId').lean({ virtuals: true });
  sendSuccess(res, { products });
});

/* ─────────────────────────────────────────────────────
   COUPON VALIDATION
   ──────────────────────────────────────────────────── */

export const validateCoupon = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  if (req.user && (req.user.role !== 'customer' || req.user.tenantId?.toString() !== store._id.toString())) {
    return next(new AppError('Coupon validation is not available for this account.', 403));
  }
  const {
    code, items, orderType = 'home_delivery', paymentMethod = 'cod', deliveryArea, customerPhone,
  } = req.body;
  if (!code) return next(new AppError('Coupon code required.', 400));
  const quote = await calculateOrderQuote({
    tenantId: store._id,
    store,
    items,
    orderType,
    paymentMethod,
    couponCode: code,
    customerId: req.user?._id,
    customerPhone: req.user?.phone || customerPhone,
    deliveryArea,
  });
  sendSuccess(res, {
    coupon: {
      _id: quote.coupon._id,
      code: quote.coupon.code,
      type: quote.coupon.type,
      value: quote.coupon.value,
      description: quote.coupon.description,
    },
    discount: quote.pricing.couponDiscount,
    pricing: quote.pricing,
  });
});

const UPI_METHODS = ['upi_qr', 'upi_id'];
const BANK_METHODS = ['bank_transfer'];
const ONLINE_PAYMENT_METHODS = [...UPI_METHODS, ...BANK_METHODS, 'gateway'];

export const createOrder = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  if (req.user.tenantId?.toString() !== store._id.toString()) {
    return next(new AppError('This account cannot place orders at this store.', 403));
  }
  const { orderType, items, customerInfo = {}, couponCode, paymentMethod = 'cod', note, deliveryArea } = req.body;
  const safeCustomer = {
    name: String(req.user?.name || customerInfo.name || '').trim().slice(0, 80),
    phone: String(req.user?.phone || customerInfo.phone || '').trim(),
    email: String(req.user?.email || customerInfo.email || '').trim().slice(0, 254) || undefined,
    gstNumber: String(customerInfo.gstNumber || '').trim().slice(0, 20) || undefined,
    address: customerInfo.address ? {
      line1: String(customerInfo.address.line1 || '').trim().slice(0, 200),
      landmark: String(customerInfo.address.landmark || '').trim().slice(0, 120),
      city: String(customerInfo.address.city || '').trim().slice(0, 80),
      state: String(customerInfo.address.state || '').trim().slice(0, 80),
      pincode: String(customerInfo.address.pincode || '').trim().slice(0, 10),
    } : undefined,
  };
  const { order, replayed } = await submitOrder({
    req, tenantId: store._id, operation: 'storefront',
  }, async (session, { orderSubmission }) => {
    if (store.orderSettings?.isAcceptingOrders === false) {
      throw new AppError('This store is not currently accepting orders.', 409);
    }
    if (!safeCustomer.name || !/^[6-9]\d{9}$/.test(safeCustomer.phone)) {
      throw new AppError('A valid customer name and Indian mobile number are required.', 400);
    }
    if (['home_delivery', 'online'].includes(orderType) &&
        (!safeCustomer.address?.line1 || !safeCustomer.address?.city)) {
      throw new AppError('A complete delivery address is required.', 400);
    }

    const quote = await calculateOrderQuote({
      tenantId: store._id,
      store,
      items,
      orderType,
      paymentMethod,
      couponCode,
      customerId: req.user?._id,
      customerPhone: safeCustomer.phone,
      deliveryArea,
      claimCoupon: true,
      session,
    });
    const initialStatus = ONLINE_PAYMENT_METHODS.includes(paymentMethod) ? 'payment_pending' : 'pending';
    const persistedItems = quote.orderItems.map(({ totalMinor, stockBefore, categoryId, ...item }) => item);
    const createdOrder = new Order({
      tenantId: store._id,
      customerId: req.user?._id,
      orderSubmission,
      orderType,
      deliveryArea: quote.deliveryArea,
      items: persistedItems,
      customerInfo: safeCustomer,
      pricing: quote.pricing,
      couponId: quote.coupon?._id,
      couponCode: quote.coupon?.code,
      paymentMethod,
      note: String(note || '').trim().slice(0, 500) || undefined,
      status: initialStatus,
      paymentStatus: 'pending',
      stockReservationState: 'reserved',
    });
    snapshotRefundLines(createdOrder);
    await createdOrder.save({ session });
    await reserveOrderStock({
      tenantId: store._id,
      order: createdOrder,
      actorId: req.user?._id || store.ownerId,
      session,
    });
    return createdOrder;
  });

  if (!replayed) {
    safeEmitTenant(store._id, 'order:new', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      customerName: order.customerInfo.name,
      amount: order.pricing.grandTotal,
      paymentMethod,
      status: order.status,
    });
    await notifyAdmin(store._id, 'new_order', 'New Order Received',
      `Order #${order.orderNumber} received`, { orderId: order._id, orderNumber: order.orderNumber });
    await notifyTeam(store._id, 'new_order', 'New Order Received',
      `Order #${order.orderNumber} received`, { orderId: order._id, orderNumber: order.orderNumber });
    await logAudit({
      tenantId: store._id,
      action: 'order_created',
      user: req.user,
      resource: { type: 'Order', id: order._id, label: order.orderNumber },
      description: `Order ${order.orderNumber} created`,
      req,
    });
  }

  sendSuccess(res, {
    order: customerOrderResponse(order),
    paymentInfo: ONLINE_PAYMENT_METHODS.includes(paymentMethod)
      ? publicPaymentSettingsFor(store, paymentMethod)
      : null,
  }, replayed ? 200 : 201);
});

export const getOrders = asyncHandler(async (req, res, next) => {
  const store = req.store ?? await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));

  if (!req.user) return next(new AppError('Authentication required to view orders.', 401));
  const filter = { tenantId: store._id, customerId: req.user._id };

  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 15, maxLimit: 50 });

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select('orderNumber orderType items pricing couponCode status paymentStatus paymentMethod timeline createdAt updatedAt deliveredAt')
      .lean(),
    Order.countDocuments(filter),
  ]);

  sendPaginated(res, orders.map(stripOrderItemCosts), total, page, limit);
});

export const getOrder = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  const order = req.order;
  const paymentInfo = ONLINE_PAYMENT_METHODS.includes(order.paymentMethod) &&
    ['payment_pending', 'payment_submitted'].includes(order.status)
    ? publicPaymentSettingsFor(store, order.paymentMethod)
    : null;
  sendSuccess(res, { order: customerOrderResponse(order), paymentInfo });
});

export const cancelOrder = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({ _id: req.order._id, tenantId: store._id }).session(session);
    if (!current) throw new AppError('Order not found.', 404);
    if (current.status === 'cancelled') return current;
    if (!canTransitionOrder(current.status, 'cancelled')) {
      throw new AppError(`Cannot cancel order in ${current.status} status.`, 409);
    }
    current.status = 'cancelled';
    current.cancelReason = String(req.body.reason || 'Cancelled by customer').trim().slice(0, 300);
    current.cancelledBy = 'customer';
    current.timeline.push({ status: 'cancelled', message: 'Order cancelled by customer', timestamp: new Date() });
    await current.save({ session });
    await restoreOrderStock({
      order: current,
      tenantId: store._id,
      actorId: req.user?._id || store.ownerId,
      session,
      note: `Customer cancellation for ${current.orderNumber}`,
    });
    return current;
  });

  safeEmitTenant(store._id, 'order:cancelled', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    cancelledBy: 'customer',
  });
  await notifyAdmin(store._id, 'order_cancelled', 'Order Cancelled by Customer',
    `Order #${order.orderNumber} was cancelled`, { orderId: order._id, orderNumber: order.orderNumber });
  sendSuccess(res, { order: customerOrderResponse(order) });
});

export const submitPaymentProof = asyncHandler(async (req, res, next) => {
  const store = await findStore(req.params.slug);
  if (!store) return next(new AppError('Store not found.', 404));
  const order = await Order.findOne({ _id: req.order._id, tenantId: store._id })
    .select('+paymentProof.screenshotFile');
  if (!order) return next(new AppError('Order not found.', 404));
  if (!['payment_pending', 'payment_submitted'].includes(order.status)) {
    return next(new AppError('Payment proof can only be submitted for orders awaiting payment.', 409));
  }

  const screenshotFile = req.file?.storagePath || null;
  const utrNumber = String(req.body.utrNumber || order.paymentProof?.utrNumber || '').trim().slice(0, 100);
  const notes = String(req.body.notes || order.paymentProof?.notes || '').trim().slice(0, 500);
  if (!screenshotFile && !utrNumber) {
    return next(new AppError('Upload a payment image or provide a payment reference number.', 400));
  }

  const paymentProof = {
    screenshotFile: screenshotFile || order.paymentProof?.screenshotFile,
    utrNumber: utrNumber || undefined,
    notes: notes || undefined,
    submittedAt: new Date(),
  };
  const previous = await Order.findOneAndUpdate(
    {
      _id: order._id,
      tenantId: store._id,
      status: { $in: ['payment_pending', 'payment_submitted'] },
    },
    {
      $set: { paymentProof, status: 'payment_submitted', paymentStatus: 'submitted' },
      $push: { timeline: {
        status: 'payment_submitted',
        message: 'Payment proof submitted by customer',
        timestamp: new Date(),
      } },
    },
    { new: false, runValidators: true }
  ).select('+paymentProof.screenshotFile');
  if (!previous) return next(new AppError('Payment proof can no longer be submitted for this order.', 409));
  if (screenshotFile) {
    req.retainUploadedFiles?.();
    const overwrittenFile = previous.paymentProof?.screenshotFile;
    if (overwrittenFile && overwrittenFile !== screenshotFile) {
      void deleteStoredImage('private/payment-proofs/' + overwrittenFile, UPLOADS_ROOT).catch(() => {});
    }
  }
  const updatedOrder = await Order.findOne({ _id: order._id, tenantId: store._id });

  safeEmitTenant(store._id, 'order:payment_submitted', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    amount: order.pricing.grandTotal,
    paymentMethod: order.paymentMethod,
  });
  await notifyAdmin(store._id, 'payment_submitted', 'Payment Proof Submitted',
    `Payment proof received for Order #${order.orderNumber}`,
    { orderId: order._id, orderNumber: order.orderNumber });
  sendSuccess(res, { order: customerOrderResponse(updatedOrder) });
});

const sendPaymentProof = async (res, storagePath) => {
  const filePath = resolvePaymentProofPath(storagePath);
  const asset = await remoteAsset('private/payment-proofs/' + storagePath);
  res.set('Cache-Control', 'private, no-store');
  if (asset) {
    if (!asset.isPrivate) throw new AppError('Payment proof storage visibility is invalid.', 500);
    return res.type('image/webp').send(await downloadRemoteAsset(asset));
  }
  return res.type('image/webp').sendFile(filePath);
};

export const getCustomerPaymentProofFile = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.order._id, tenantId: req.tenantId })
    .select('+paymentProof.screenshotFile');
  if (!order?.paymentProof?.screenshotFile) return next(new AppError('Payment proof image not found.', 404));
  await sendPaymentProof(res, order.paymentProof.screenshotFile);
});

export const getAdminPaymentProofFile = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId })
    .select('+paymentProof.screenshotFile');
  if (!order?.paymentProof?.screenshotFile) return next(new AppError('Payment proof image not found.', 404));
  await sendPaymentProof(res, order.paymentProof.screenshotFile);
});

export const getAdminOrders = asyncHandler(async (req, res, next) => {
  const { status, paymentStatus, orderType, search } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 5, maxLimit: 100 });
  const filter = { tenantId: req.tenantId };

  if (status) {
    // Support comma-separated statuses
    const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (orderType) filter.orderType = orderType;
  if (search) {
    const safeSearch = new RegExp(escapeRegex(String(search).trim().slice(0, 80)), 'i');
    filter.$or = [
      { orderNumber: safeSearch },
      { 'customerInfo.name': safeSearch },
      { 'customerInfo.phone': safeSearch },
    ];
  }

  const after = cursorFilter(req.query.cursor, ['createdAt', '_id']);
  const [orders, total] = await Promise.all([
    Order.find(after ? { $and: [filter, after] } : filter)
      .select('orderNumber orderType saleType deliveryArea items customerInfo.name customerInfo.phone pricing couponCode status paymentStatus paymentMethod udharCustomerId settlement checkoutPayments receivedAmount udharAmount paidAt timeline assignedTo deliveryAssignedTo fulfillment createdAt updatedAt deliveredAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(after ? 0 : skip)
      .limit(limit + 1)
      .populate('assignedTo', 'name phone role')
      .populate('deliveryAssignedTo', 'name phone role')
      .lean(),
    Order.countDocuments(filter),
  ]);

  const result = cursorMeta(orders, limit, ['createdAt', '_id']);
  for (const row of result.data) {
    if (row.udharCustomerId && row.settlement?.version !== 1) {
      await prepareCustomer(req.tenantId, row.udharCustomerId);
      const current = await Order.findOne({ _id: row._id, tenantId: req.tenantId }).select('settlement paymentStatus paidAt').lean();
      Object.assign(row, current && { settlement: current.settlement, paymentStatus: current.paymentStatus, paidAt: current.paidAt });
    }
    row.paymentSummary = paymentSummary(row);
  }
  sendPaginated(res, result.data.map(stripOrderItemCosts), total, page, limit, result.meta);
});

export const getAdminOrder = asyncHandler(async (req, res, next) => {
  const linkedAccount = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).select('udharCustomerId settlement.version').lean();
  if (linkedAccount?.udharCustomerId && linkedAccount.settlement?.version !== 1) await prepareCustomer(req.tenantId, linkedAccount.udharCustomerId);
  const mayVerifyPayment = hasPermission(req.user, PERMISSIONS.ORDERS_PAYMENT_VERIFY);
  let query = Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId })
    .populate('assignedTo', 'name phone role')
    .populate('deliveryAssignedTo', 'name phone role');
  query = mayVerifyPayment ? query.select('+paymentProof.screenshotFile') : query.select('-paymentProof');
  const order = await query.lean();
  if (!order) return next(new AppError('Order not found.', 404));
  if (mayVerifyPayment && order.paymentProof) {
    order.paymentProof.hasScreenshot = Boolean(order.paymentProof.screenshotFile);
    delete order.paymentProof.screenshotFile;
  }
  sendSuccess(res, { order: { ...order, paymentSummary: paymentSummary(order) } });
});

export const getAdminOrderPayments = asyncHandler(async (req, res) => {
  let order = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).lean();
  if (!order) throw new AppError('Order not found.', 404);
  if (order.udharCustomerId && order.settlement?.version !== 1) {
    await prepareCustomer(req.tenantId, order.udharCustomerId);
    order = await Order.findOne({ _id: order._id, tenantId: req.tenantId }).lean();
  }
  const result = await billPaymentsPage(req.tenantId, order.udharCustomerId || null, order, req.query);
  sendSuccess(res, { ...result, summary: paymentSummary(order) });
});

export const getPaymentQueue = asyncHandler(async (req, res, next) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {
    tenantId: req.tenantId,
    status: 'payment_submitted',
  };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select('orderNumber customerInfo.name customerInfo.phone items.name items.quantity pricing paymentMethod paymentStatus paymentProof.utrNumber paymentProof.notes paymentProof.submittedAt updatedAt +paymentProof.screenshotFile')
      .sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);

  const safeOrders = orders.map((order) => ({
    ...order,
    paymentProof: order.paymentProof ? {
      utrNumber: order.paymentProof.utrNumber,
      notes: order.paymentProof.notes,
      submittedAt: order.paymentProof.submittedAt,
      hasScreenshot: Boolean(order.paymentProof.screenshotFile),
    } : undefined,
  }));
  sendPaginated(res, safeOrders, total, page, limit);
});

export const verifyPayment = asyncHandler(async (req, res, next) => {
  const { action, reason } = req.body;
  if (!['approve', 'reject'].includes(action)) {
    return next(new AppError('Action must be approve or reject.', 400));
  }

  const cleanReason = String(reason || '').trim().slice(0, 500);
  if (action === 'reject' && !cleanReason) {
    return next(new AppError('A rejection reason is required.', 400));
  }
  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({
      _id: req.params.orderId, tenantId: req.tenantId,
    }).session(session);
    if (!current) throw new AppError('Order not found.', 404);
    const targetStatus = action === 'approve' ? 'payment_verified' : 'payment_pending';
    if (current.status === targetStatus) return current;
    if (!canTransitionOrder(current.status, targetStatus)) {
      throw new AppError(`Payment cannot be ${action === 'approve' ? 'approved' : 'rejected'} from ${current.status}.`, 409);
    }
    if (!current.paymentProof) current.paymentProof = {};
    if (action === 'approve') {
      current.status = 'payment_verified';
      current.paymentProof.verifiedAt = new Date();
      current.recordPayment(current.paymentProof.verifiedAt);
      current.paymentProof.verifiedBy = req.user._id;
      current.paymentProof.rejectedReason = undefined;
      current.timeline.push({
        status: 'payment_verified', message: 'Payment verified by store', timestamp: new Date(),
      });
    } else {
      current.status = 'payment_pending';
      current.paymentStatus = 'failed';
      current.paymentProof.rejectedReason = cleanReason;
      current.timeline.push({
        status: 'payment_pending', message: `Payment rejected: ${cleanReason}`, timestamp: new Date(),
      });
    }
    await current.save({ session });
    return current;
  });
  if (order.customerId) {
    const approved = action === 'approve';
    safeEmitUser(order.customerId, approved ? 'order:payment_verified' : 'order:payment_rejected', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      ...(approved ? { status: 'verified' } : { reason: cleanReason }),
    });
    await notifyCustomer(
      req.tenantId,
      order.customerId,
      approved ? 'payment_verified' : 'payment_rejected',
      approved ? 'Payment Verified' : 'Payment Not Accepted',
      approved ? `Your payment for Order #${order.orderNumber} has been verified` : cleanReason,
      { orderId: order._id, orderNumber: order.orderNumber }
    );
  }
  if (action === 'approve') {
    await logAudit({ tenantId: req.tenantId, action: 'payment_verified', user: req.user, resource: { type: 'Order', id: order._id, label: order.orderNumber }, description: `Payment approved for Order ${order.orderNumber}`, req });
  }
  refreshWorkers(order);
  if (action === 'approve' && order.assignedTo) await notifyStaff(req.tenantId, order.assignedTo, 'payment_verified', 'Order ready for packing',
    `Payment for Order #${order.orderNumber} is verified. You can start packing.`, { orderId: order._id, orderNumber: order.orderNumber });
  sendSuccess(res, { order });
});

export const updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status, message } = req.body;
  const allowedTargets = new Set(['accepted', 'packing', 'packed', 'ready_for_pickup', 'out_for_delivery', 'delivered']);
  if (!allowedTargets.has(status)) return next(new AppError('Invalid administrative status target.', 400));

  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).session(session);
    if (!current) throw new AppError('Order not found.', 404);
    if (current.status === status) return current;
    if (!canTransitionOrder(current.status, status)) {
      throw new AppError(`Order cannot transition from ${current.status} to ${status}.`, 409);
    }
    current.status = status;
    const fulfillmentField = { packing: 'packingStartedBy', packed: 'packingCompletedBy', out_for_delivery: 'dispatchedBy', delivered: 'deliveredBy' }[status];
    recordOrderAction(current, req.user, 'status_updated', String(message || `Status updated to ${status}`).trim().slice(0, 300), { field: fulfillmentField });
    if (status === 'delivered') {
      current.deliveredAt = new Date();
      if (['cod', 'cash_on_pickup', 'counter'].includes(current.paymentMethod)) {
        current.recordPayment(current.deliveredAt);
      }
      if (current.stockReservationState === 'reserved') await consumeOrderReservation({ order: current, session });
      else await current.save({ session });
    } else {
      if (status === 'packing') current.preparedAt = new Date();
      await current.save({ session });
    }
    await StaffActivityLog.create([{
      tenantId: req.tenantId, staffId: req.user._id, staffName: req.user.name, staffRole: req.user.role,
      action: 'status_updated', orderId: current._id, orderNumber: current.orderNumber,
      metadata: { status },
    }], { session });
    return current;
  });

  if (order.customerId) {
    safeEmitUser(order.customerId, 'order:status_updated', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status,
      message: message || `Your order is now ${status}`,
    });
  }
  refreshWorkers(order);
  if (status === 'accepted' && order.assignedTo) await notifyStaff(req.tenantId, order.assignedTo, 'order_accepted', 'Order ready for packing',
    `Order #${order.orderNumber} is accepted. You can start packing.`, { orderId: order._id, orderNumber: order.orderNumber });
  sendSuccess(res, { order });
});

export const adminCancelOrder = asyncHandler(async (req, res, next) => {
  const reason = String(req.body.reason || 'Cancelled by store').trim().slice(0, 300);
  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).session(session);
    if (!current) throw new AppError('Order not found.', 404);
    if (current.status === 'cancelled') return current;
    if (!canTransitionOrder(current.status, 'cancelled')) {
      throw new AppError(`Cannot cancel order in ${current.status} status.`, 409);
    }
    current.status = 'cancelled';
    current.cancelReason = reason;
    current.cancelledBy = 'store';
    recordOrderAction(current, req.user, 'order_cancelled', reason);
    await current.save({ session });
    await restoreOrderStock({
      order: current,
      tenantId: req.tenantId,
      actorId: req.user._id,
      session,
      note: `Store cancellation for ${current.orderNumber}`,
    });
    if (current.udharCustomerId) {
      await adjustPOSUdharBalance({
        order: current,
        amountChangeMinor: -toMinorUnits(current.pricing.grandTotal, 'bill total'),
        actor: req.user,
        description: `Cancelled POS bill ${current.orderNumber}`,
        session,
      });
    }
    return current;
  });
  if (order.customerId) safeEmitUser(order.customerId, 'order:cancelled', {
    orderId: order._id, orderNumber: order.orderNumber, reason,
  });
  refreshWorkers(order);
  sendSuccess(res, { order });
});

export const rejectOrder = asyncHandler(async (req, res, next) => {
  const reason = String(req.body.reason || 'Rejected by store').trim().slice(0, 300);
  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).session(session);
    if (!current) throw new AppError('Order not found.', 404);
    if (current.status === 'rejected') return current;
    if (!canTransitionOrder(current.status, 'rejected')) {
      throw new AppError(`Cannot reject order in ${current.status} status.`, 409);
    }
    current.status = 'rejected';
    current.cancelReason = reason;
    current.cancelledBy = 'store';
    current.timeline.push({ status: 'rejected', message: reason, timestamp: new Date() });
    await current.save({ session });
    await restoreOrderStock({
      order: current,
      tenantId: req.tenantId,
      actorId: req.user._id,
      session,
      note: `Order rejection for ${current.orderNumber}`,
    });
    if (current.udharCustomerId) {
      await adjustPOSUdharBalance({
        order: current,
        amountChangeMinor: -toMinorUnits(current.pricing.grandTotal, 'bill total'),
        actor: req.user,
        description: `Rejected POS bill ${current.orderNumber}`,
        session,
      });
    }
    return current;
  });
  if (order.customerId) safeEmitUser(order.customerId, 'order:rejected', {
    orderId: order._id, orderNumber: order.orderNumber, reason,
  });
  refreshWorkers(order);
  sendSuccess(res, { order });
});

export const partialFulfillOrder = asyncHandler(async (req, res, next) => {
  const { fulfilledItems, reason } = req.body;
  if (!Array.isArray(fulfilledItems) || fulfilledItems.length === 0) {
    return next(new AppError('fulfilledItems is required.', 400));
  }
  const fulfilledQuantities = new Map();
  for (const item of fulfilledItems) {
    const key = String(item.variantId || '');
    if (!key || fulfilledQuantities.has(key)) return next(new AppError('Fulfilled variant entries must be unique.', 400));
    fulfilledQuantities.set(key, Number(item.fulfilledQty));
  }

  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).session(session);
    if (!current) throw new AppError('Order not found.', 404);
    if (current.status !== 'partially_fulfilled' && !canTransitionOrder(current.status, 'partially_fulfilled')) {
      throw new AppError(`Order cannot be partially fulfilled from ${current.status}.`, 409);
    }
    if (current.status === 'partially_fulfilled' && await Return.exists({
      tenantId: req.tenantId, orderId: current._id, status: { $in: ACTIVE_RETURN_STATUSES },
    }).session(session)) {
      throw new AppError('An order with active returns cannot be repriced.', 409);
    }
    await restoreUnfulfilledStock({
      order: current,
      fulfilledQuantities,
      tenantId: req.tenantId,
      actorId: req.user._id,
      session,
      note: `Partial fulfillment for ${current.orderNumber}`,
    });
    const subtotalMinor = current.items.reduce((sum, item) => {
      const quantity = item.fulfilledQty == null ? item.quantity : item.fulfilledQty;
      return sum + toMinorUnits(item.price, 'order item price') * quantity;
    }, 0);
    const discountMinor = fulfilledDiscountMinor(current);
    const store = await Store.findById(req.tenantId).select('taxSettings').session(session);
    const taxPercent = store?.taxSettings?.enableGST
      ? Number(store.taxSettings.cgstPercent || 0) + Number(store.taxSettings.sgstPercent || 0)
      : 0;
    const taxMinor = percentOf(subtotalMinor - discountMinor, taxPercent, 'tax percentage');
    const deliveryMinor = toMinorUnits(current.pricing.deliveryCharge || 0, 'delivery charge');
    const nextTotalMinor = subtotalMinor - discountMinor + taxMinor + deliveryMinor;
    if (current.udharCustomerId) {
      await adjustPOSUdharBalance({
        order: current,
        amountChangeMinor: nextTotalMinor - toMinorUnits(current.pricing.grandTotal, 'bill total'),
        actor: req.user,
        description: `Partial fulfillment for POS bill ${current.orderNumber}`,
        session,
      });
    }
    current.pricing.subtotal = fromMinorUnits(subtotalMinor);
    current.pricing.couponDiscount = fromMinorUnits(discountMinor);
    current.pricing.tax = fromMinorUnits(taxMinor);
    current.pricing.grandTotal = fromMinorUnits(nextTotalMinor);
    snapshotRefundLines(current);
    if (current.status !== 'partially_fulfilled') {
      current.status = 'partially_fulfilled';
      current.timeline.push({
        status: 'partially_fulfilled',
        message: String(reason || 'Order partially fulfilled').trim().slice(0, 300),
        timestamp: new Date(),
      });
    }
    await current.save({ session });
    return current;
  });
  if (order.customerId) safeEmitUser(order.customerId, 'order:status_updated', {
    orderId: order._id, orderNumber: order.orderNumber, status: order.status,
  });
  refreshWorkers(order);
  sendSuccess(res, { order });
});

const assignOrderWork = async (req, kind, targetId) => runInTransaction(async (session) => {
  const packing = kind === 'packing';
  const field = packing ? 'assignedTo' : 'deliveryAssignedTo';
  const order = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId }).session(session);
  if (!order) throw new AppError('Order not found.', 404);
  if (!packing && !['home_delivery', 'online'].includes(order.orderType)) throw new AppError('Only delivery orders can be assigned to delivery staff.', 409);
  const closed = packing ? ['delivered', 'cancelled', 'rejected', 'ready_for_pickup', 'out_for_delivery'] : ['delivered', 'cancelled', 'rejected'];
  if (closed.includes(order.status)) throw new AppError('This order can no longer be assigned.', 409);
  const previous = order[field]?.toString();
  const changed = (previous || '') !== (targetId?.toString() || '');
  if (!changed) return { order, previous, changed, target: null };
  if (packing && await PackingSession.exists({ tenantId: req.tenantId, orderId: order._id }).session(session)) {
    throw new AppError('Packing has already started. The current packer must finish this session before the assignment can change.', 409);
  }
  let target = null;
  if (targetId) {
    target = await User.findOne({ _id: targetId, tenantId: req.tenantId,
      role: { $in: ['store_owner', 'staff', 'packer', 'delivery'] }, isActive: true }).session(session);
    if (!target) throw new AppError('Staff member not found.', 404);
    if (!hasPermission(target, packing ? PERMISSIONS.PACKING_PERFORM : PERMISSIONS.DELIVERY_UPDATE)) {
      throw new AppError(`This person does not have ${kind} permission.`, 403);
    }
  }
  const previousAssignee = order.get(`fulfillment.${kind}AssignedTo`) || (previous
    ? actorSnapshot(await User.findOne({ _id: previous, tenantId: req.tenantId }).select('name role').session(session)) : null);
  const at = new Date();
  order[field] = target?._id || null;
  order.set(`fulfillment.${kind}AssignedTo`, actorSnapshot(target, at));
  recordOrderAction(order, req.user, `${kind}_assigned`, target
    ? `${packing ? 'Packing' : 'Delivery'} assigned to ${target.name} by ${req.user.name}`
    : `${packing ? 'Packing' : 'Delivery'} assignment removed by ${req.user.name}`,
  { field: `${kind}AssignedBy`, assignee: target, previousAssignee, at });
  await order.save({ session });
  await StaffActivityLog.create([{
    tenantId: req.tenantId, staffId: req.user._id, staffName: req.user.name, staffRole: req.user.role,
    action: 'order_assigned', orderId: order._id, orderNumber: order.orderNumber,
    metadata: { task: kind, assignee: actorSnapshot(target, at), previousAssignee },
  }], { session });
  return { order, previous, changed, target };
});

const assignmentResponse = async (req, res, kind, targetId) => {
  const { order, previous, changed, target } = await assignOrderWork(req, kind, targetId);
  const event = kind === 'packing' ? 'order' : 'delivery';
  if (changed && target) {
    safeEmitUser(target._id, `${event}:assigned`, { orderId: order._id, orderNumber: order.orderNumber });
    await notifyStaff(req.tenantId, target._id, 'order_assigned', `${kind === 'packing' ? 'Packing' : 'Delivery'} order assigned`,
      `Order #${order.orderNumber} assigned to you by ${req.user.name}.`,
      { orderId: order._id, orderNumber: order.orderNumber, task: kind });
  }
  if (changed && previous) safeEmitUser(previous, `${event}:unassigned`, { orderId: order._id });
  refreshWorkers(order);
  sendSuccess(res, { order });
};

export const assignStaff = asyncHandler(async (req, res) => assignmentResponse(req, res, 'packing', req.body.staffId));
export const assignDelivery = asyncHandler(async (req, res) => assignmentResponse(req, res, 'delivery', req.body.deliveryId));
