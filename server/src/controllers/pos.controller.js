import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import UdharCustomer from '../models/UdharCustomer.js';
import User from '../models/User.js';
import { actorSnapshot, recordOrderAction } from '../utils/orderAttribution.js';
import { notifyStaff } from '../services/notification.service.js';
import { emitToWorkers } from '../config/socket.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { emitToTenant } from '../config/socket.js';
import { logAudit } from '../services/audit.service.js';
import { submitOrder } from '../services/orderSubmission.service.js';
import { reserveOrderStock } from '../services/stock.service.js';
import { recordUdharEntry, resolvePOSUdharCustomer } from '../services/udharLedger.service.js';
import { assertPositiveInteger, fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';
import { escapeRegex, parsePagination } from '../utils/query.js';
import { snapshotRefundLines } from '../utils/refundAmounts.js';
import { accountingDateFilter } from '../utils/accountingDay.js';

const safeEmit = (tenantId, event, data) => {
  try { emitToTenant(tenantId, event, data); } catch {}
};

const VALID_PAYMENT_METHODS = new Set(['counter', 'upi_id', 'credit']);
const VALID_SALE_TYPES = new Set(['instant', 'parcha']);

const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new AppError('A POS sale must contain between 1 and 100 items.', 400);
  }
  const grouped = new Map();
  items.forEach((item, index) => {
    if (!mongoose.isValidObjectId(item?.productId) || !mongoose.isValidObjectId(item?.variantId)) {
      throw new AppError(`Item ${index + 1} has an invalid product or variant.`, 400);
    }
    const quantity = assertPositiveInteger(item.qty, `items[${index}].qty`, 1000);
    const key = `${item.productId}:${item.variantId}`;
    const existing = grouped.get(key);
    if (existing && item.price != null && existing.price != null && Number(item.price) !== Number(existing.price)) {
      throw new AppError('Duplicate POS items must use the same requested price.', 400);
    }
    const nextQuantity = (existing?.qty || 0) + quantity;
    if (nextQuantity > 1000) throw new AppError('Quantity per variant cannot exceed 1000.', 400);
    grouped.set(key, { ...item, qty: nextQuantity });
  });
  return [...grouped.values()];
};

export const createPOSOrder = asyncHandler(async (req, res, next) => {
  const {
    items,
    paymentMethod = 'counter',
    customerName,
    customerPhone,
    udharCustomerId,
    note = '',
    overallDiscount = 0,
    saleType = 'instant',
    payments,
    packingAssigneeId,
  } = req.body;

  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) return next(new AppError('Invalid POS payment method.', 400));
  if (!VALID_SALE_TYPES.has(saleType)) return next(new AppError('Invalid POS sale type.', 400));
  const { order, replayed } = await submitOrder({
    req, tenantId: req.tenantId, operation: 'pos',
  }, async (session, { orderSubmission }) => {
    const udharCustomer = paymentMethod === 'credit'
      ? await resolvePOSUdharCustomer({
        tenantId: req.tenantId, customerId: udharCustomerId, phone: customerPhone, session,
      })
      : null;
    const customerInfo = udharCustomer
      ? { name: udharCustomer.name, phone: udharCustomer.phone }
      : { name: customerName || 'Walk-in Customer', ...(customerPhone && { phone: customerPhone }) };

    const enriched = [];
    for (const item of normalizeItems(items)) {
      const product = await Product.findOne({
        _id: item.productId, tenantId: req.tenantId, isActive: true,
      }).session(session);
      if (!product) throw new AppError('One or more POS products were not found.', 404);
      const variant = product.variants.id(item.variantId);
      if (!variant?.isActive) throw new AppError(`Variant not available for ${product.name}.`, 404);
      const baseValue = variant.offerPrice ?? variant.retailPrice;
      const baseMinor = toMinorUnits(baseValue, `${product.name} price`, { allowZero: false });
      let sellingMinor = baseMinor;
      if (item.price != null) {
        const requestedMinor = toMinorUnits(item.price, `${product.name} requested price`, { allowZero: false });
        if (requestedMinor < baseMinor && !hasPermission(req.user, PERMISSIONS.POS_DISCOUNT)) {
          throw new AppError('You do not have permission to discount POS items.', 403);
        }
        if (requestedMinor > baseMinor && !hasPermission(req.user, PERMISSIONS.POS_PRICE_OVERRIDE)) {
          throw new AppError('You do not have permission to override POS prices.', 403);
        }
        sellingMinor = requestedMinor;
      }
      const totalMinor = sellingMinor * item.qty;
      if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new AppError('POS line total is invalid.', 400);
      enriched.push({
        productId: product._id,
        variantId: variant._id,
        name: product.name,
        variantName: variant.name,
        unit: variant.unit,
        image: product.images?.find((image) => image.isMain)?.url ?? product.images?.[0]?.url,
        quantity: item.qty,
        mrp: fromMinorUnits(toMinorUnits(variant.retailPrice, 'retail price', { allowZero: false })),
        price: fromMinorUnits(sellingMinor),
        unitCost: variant.purchasePrice ?? null,
        total: fromMinorUnits(totalMinor),
      });
    }

    const subtotalMinor = enriched.reduce((sum, item) => sum + toMinorUnits(item.total), 0);
    const discountMinor = toMinorUnits(overallDiscount, 'overall discount');
    if (discountMinor > 0 && !hasPermission(req.user, PERMISSIONS.POS_DISCOUNT)) {
      throw new AppError('You do not have permission to apply POS discounts.', 403);
    }
    if (discountMinor >= subtotalMinor) {
      throw new AppError('Overall discount must be less than the POS subtotal.', 400);
    }
    const grandTotalMinor = subtotalMinor - discountMinor;
    const cashMinor = payments === undefined ? (paymentMethod === 'counter' ? grandTotalMinor : 0)
      : toMinorUnits(payments.cash ?? 0, 'cash payment');
    const upiMinor = payments === undefined ? (paymentMethod === 'upi_id' ? grandTotalMinor : 0)
      : toMinorUnits(payments.upi ?? 0, 'UPI payment');
    const receivedMinor = cashMinor + upiMinor;
    if (!Number.isSafeInteger(receivedMinor) || receivedMinor > grandTotalMinor) {
      throw new AppError('Cash and UPI payments cannot exceed the bill total.', 400);
    }
    const pendingMinor = grandTotalMinor - receivedMinor;
    if (pendingMinor > 0 && !udharCustomer) {
      throw new AppError('Select an Udhar account for the unpaid amount.', 400);
    }
    const isInstant = saleType === 'instant';
    const soldAt = new Date();
    let packer = null;
    if (!isInstant) {
      const targetId = packingAssigneeId === undefined ? req.user._id : packingAssigneeId;
      if (targetId) {
        if (String(targetId) !== String(req.user._id) && !hasPermission(req.user, PERMISSIONS.ORDERS_ASSIGN)) {
          throw new AppError('You do not have permission to assign packing to another employee.', 403);
        }
        packer = await User.findOne({ _id: targetId, tenantId: req.tenantId, isActive: true,
          role: { $in: ['store_owner', 'staff', 'packer', 'delivery'] } }).session(session);
        if (!packer || !hasPermission(packer, PERMISSIONS.PACKING_PERFORM)) throw new AppError('Choose an active employee with packing permission.', 400);
      }
    }
    const createdOrder = new Order({
      tenantId: req.tenantId,
      orderType: 'counter',
      orderSubmission,
      udharCustomerId: udharCustomer?._id,
      saleType,
      items: enriched,
      customerInfo,
      pricing: {
        subtotal: fromMinorUnits(subtotalMinor),
        couponDiscount: fromMinorUnits(discountMinor),
        deliveryCharge: 0,
        tax: 0,
        grandTotal: fromMinorUnits(grandTotalMinor),
      },
      paymentMethod: pendingMinor > 0 ? 'credit' : (upiMinor > 0 && cashMinor === 0 ? 'upi_id' : 'counter'),
      checkoutPayments: [
        ...(cashMinor > 0 ? [{ method: 'cash', amount: fromMinorUnits(cashMinor), paidAt: soldAt }] : []),
        ...(upiMinor > 0 ? [{ method: 'upi', amount: fromMinorUnits(upiMinor), paidAt: soldAt }] : []),
      ],
      udharAmount: fromMinorUnits(pendingMinor),
      receivedAmount: fromMinorUnits(receivedMinor),
      status: isInstant ? 'delivered' : 'accepted',
      note: String(note).trim().slice(0, 500),
      deliveredAt: isInstant ? soldAt : undefined,
      assignedTo: packer?._id,
      stockReservationState: isInstant ? 'consumed' : 'reserved',
    });
    if (isInstant) {
      recordOrderAction(createdOrder, req.user, 'counter_handover', `Counter sale handed over by ${req.user.name}`, { field: 'deliveredBy', at: soldAt });
    } else {
      createdOrder.set('fulfillment.packingAssignedTo', actorSnapshot(packer, soldAt));
      recordOrderAction(createdOrder, req.user, 'packing_assigned', packer ? `Packing assigned to ${packer.name}` : 'Packing pending; assignment needed', {
        field: 'packingAssignedBy', assignee: packer, at: soldAt,
      });
    }
    if (pendingMinor === 0) createdOrder.recordPayment(soldAt);
    snapshotRefundLines(createdOrder);
    await createdOrder.save({ session });
    await reserveOrderStock({
      tenantId: req.tenantId,
      order: createdOrder,
      actorId: req.user._id,
      session,
      movementType: isInstant ? 'ORDER_SOLD' : 'ORDER_RESERVED',
    });
    if (udharCustomer && pendingMinor > 0) {
      await recordUdharEntry({
        customer: udharCustomer,
        type: 'debit',
        amountMinor: pendingMinor,
        description: `POS bill ${createdOrder.orderNumber}`,
        referenceType: 'pos_order',
        referenceId: createdOrder._id,
        actor: req.user,
        session,
      });
    }
    return Order.findById(createdOrder._id).session(session);
  });

  if (replayed) return sendSuccess(res, { order });
  if (order.saleType === 'parcha') {
    try { emitToWorkers(req.tenantId, 'order:updated', { orderId: order._id, status: order.status }); } catch {}
    if (order.assignedTo) await notifyStaff(req.tenantId, order.assignedTo, 'order_assigned', 'POS order ready for packing',
      `Pack POS bill ${order.orderNumber}.`, { orderId: order._id, orderNumber: order.orderNumber, task: 'packing' });
  }

  safeEmit(req.tenantId, 'order:new', {
    orderId: order._id, orderNumber: order.orderNumber, orderType: 'counter',
  });
  await logAudit({
    tenantId: req.tenantId,
    action: 'pos_bill_created',
    user: req.user,
    resource: { type: 'Order', id: order._id, label: order.orderNumber },
    description: `POS bill ${order.orderNumber} created`,
    req,
  });
  sendSuccess(res, { order }, 201);
});

export const getPOSUdharCustomer = asyncHandler(async (req, res) => {
  const { _id, name, phone } = await resolvePOSUdharCustomer({
    tenantId: req.tenantId, phone: req.query.phone,
  });
  sendSuccess(res, { customer: { _id, name, phone } });
});

export const getPOSUdharCustomers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, isActive: true, phone: /^[6-9]\d{9}$/ };
  if (req.query.search?.trim()) {
    const pattern = new RegExp(escapeRegex(req.query.search.trim().slice(0, 80)), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }];
  }
  const [customers, total] = await Promise.all([
    UdharCustomer.find(filter).select('name phone balance').sort({ name: 1, _id: 1 }).skip(skip).limit(limit),
    UdharCustomer.countDocuments(filter),
  ]);
  sendPaginated(res, customers, total, page, limit);
});

export const getPOSOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, orderType: 'counter' };
  if (req.query.date) {
    filter.createdAt = accountingDateFilter(req.query.date, req.query.date, req.storeTimeZone);
  }
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  sendPaginated(res, orders, total, page, limit);
});
