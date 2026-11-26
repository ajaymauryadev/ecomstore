import Order from '../models/Order.js';
import { fulfilledDiscountMinor, snapshotRefundLines } from '../utils/refundAmounts.js';
import Product from '../models/Product.js';
import PackingSession from '../models/PackingSession.js';
import StaffActivityLog from '../models/StaffActivityLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { emitToTenant, emitToUser, emitToWorkers } from '../config/socket.js';
import { notifyAdmin, notifyStaff } from '../services/notification.service.js';
import { logAudit } from '../services/audit.service.js';
import { isHighValue } from '../models/PackingSession.js';
import Store from '../models/Store.js';
import { runInTransaction } from '../utils/transaction.js';
import { restoreUnfulfilledStock } from '../services/stock.service.js';
import { canTransitionOrder } from '../constants/orderStatus.js';
import { fromMinorUnits, percentOf, toMinorUnits } from '../utils/money.js';
import { parsePagination } from '../utils/query.js';
import { stripOrderItemCosts } from '../utils/orderResponse.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';
import { actorSnapshot, recordOrderAction } from '../utils/orderAttribution.js';
import { adjustPOSUdharBalance } from '../services/udharLedger.service.js';

const managesPacking = (req) => hasPermission(req.user, PERMISSIONS.PACKING_MANAGE);
const sessionScope = (req) => managesPacking(req) ? {} : { staffId: req.user._id };
const refreshPacking = (req) => {
  try { emitToWorkers(req.tenantId, 'packing:updated', { orderId: req.params.orderId }); } catch {}
};

const safeEmitTenant = (tenantId, event, data) => {
  try { emitToTenant(tenantId, event, data); } catch {}
};
const safeEmitUser = (userId, event, data) => {
  try { emitToUser(userId, event, data); } catch {}
};

/* ─────────────────────────────────────────────────
   STAFF ENDPOINTS
   ───────────────────────────────────────────────── */

export const getMyOrders = asyncHandler(async (req, res, next) => {
  const filter = {
    tenantId: req.tenantId,
    ...(!managesPacking(req) && { assignedTo: req.user._id }),
    status: { $in: ['pending', 'payment_pending', 'payment_submitted', 'accepted', 'packing', 'packed', 'payment_verified'] },
  };

  const orders = await Order.find(filter)
    .sort({ createdAt: 1 })
    .limit(100)
    .select('orderNumber orderType status paymentStatus paymentMethod customerInfo.name pricing items createdAt assignedTo deliveryAssignedTo fulfillment')
    .populate('assignedTo', 'name role')
    .populate('deliveryAssignedTo', 'name role')
    .lean();

  // Attach packing session status
  const orderIds = orders.map((o) => o._id);
  const sessions = await PackingSession.find({ tenantId: req.tenantId, orderId: { $in: orderIds } })
    .select('orderId status totalRequired totalPacked totalMissing staffId staffName staffRole completedBy')
    .lean();

  const sessionMap = {};
  sessions.forEach((s) => { sessionMap[s.orderId.toString()] = s; });

  const enriched = orders.map((o) => ({
    ...stripOrderItemCosts(o),
    packingSession: sessionMap[o._id.toString()] || null,
  }));

  sendSuccess(res, { orders: enriched });
});

export const acceptPackingOrder = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async (session) => {
    const scope = { _id: req.params.orderId, tenantId: req.tenantId };
    if (!managesPacking(req)) scope.assignedTo = req.user._id;
    const order = await Order.findOne(scope).session(session);
    if (!order) throw new AppError('Assigned order not found.', 404);
    if (order.status === 'accepted') return { order, changed: false };
    if (!canTransitionOrder(order.status, 'accepted')) {
      throw new AppError(`Cannot accept an order from ${order.status}. Payment orders must be verified first.`, 409);
    }
    if (order.status === 'pending' && !['cod', 'cash_on_pickup', 'counter'].includes(order.paymentMethod) && order.paymentStatus !== 'paid') {
      throw new AppError('Payment must be verified before accepting this order.', 409);
    }
    order.status = 'accepted';
    recordOrderAction(order, req.user, 'order_accepted', `Order accepted by ${req.user.name}`);
    await order.save({ session });
    await StaffActivityLog.create([{
      tenantId: req.tenantId, staffId: req.user._id, staffName: req.user.name, staffRole: req.user.role,
      action: 'status_updated', orderId: order._id, orderNumber: order.orderNumber,
      metadata: { status: 'accepted', source: 'packing' },
    }], { session });
    return { order, changed: true };
  });
  if (result.changed) {
    const order = result.order;
    try { emitToWorkers(req.tenantId, 'order:updated', { orderId: order._id, status: 'accepted' }); } catch {}
    if (order.customerId) safeEmitUser(order.customerId, 'order:status_updated', {
      orderId: order._id, orderNumber: order.orderNumber, status: 'accepted', message: 'Your order has been accepted.',
    });
    await notifyAdmin(req.tenantId, 'order_accepted', 'Order accepted',
      `Order #${order.orderNumber} was accepted by ${req.user.name}.`, { orderId: order._id, orderNumber: order.orderNumber });
    if (order.assignedTo && String(order.assignedTo) !== String(req.user._id)) {
      await notifyStaff(req.tenantId, order.assignedTo, 'order_accepted', 'Order ready for packing',
        `Order #${order.orderNumber} is accepted. You can start packing.`, { orderId: order._id, orderNumber: order.orderNumber });
    }
  }
  sendSuccess(res, { order: { _id: result.order._id, orderNumber: result.order.orderNumber, status: result.order.status } });
});

export const startPackingSession = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async (mongoSession) => {
    const orderFilter = { _id: req.params.orderId, tenantId: req.tenantId };
    if (!managesPacking(req)) orderFilter.assignedTo = req.user._id;
    const order = await Order.findOne(orderFilter).session(mongoSession);
    if (!order) throw new AppError('Assigned order not found.', 404);

    const existing = await PackingSession.findOne({
      orderId: order._id, tenantId: req.tenantId,
    }).session(mongoSession);
    if (existing) {
      if (existing.staffId.toString() !== req.user._id.toString() && !managesPacking(req)) {
        throw new AppError('This order is being packed by another staff member.', 409);
      }
      return { session: existing, created: false };
    }
    if (!canTransitionOrder(order.status, 'packing')) {
      throw new AppError(`Cannot start packing from ${order.status}.`, 409);
    }

    const items = order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      variantName: item.variantName,
      unit: item.unit,
      image: item.image,
      requiredQty: item.fulfilledQty ?? item.quantity,
      mrp: item.mrp,
      price: item.price,
      isHighValue: isHighValue(item.name),
      status: 'pending',
    }));
    const [packing] = await PackingSession.create([{
      tenantId: req.tenantId,
      orderId: order._id,
      orderNumber: order.orderNumber,
      staffId: req.user._id,
      staffName: req.user.name,
      staffRole: req.user.role,
      items,
      totalRequired: items.reduce((sum, item) => sum + item.requiredQty, 0),
    }], { session: mongoSession });

    order.status = 'packing';
    recordOrderAction(order, req.user, 'packing_started', `Packing started by ${req.user.name}`, { field: 'packingStartedBy' });
    await order.save({ session: mongoSession });
    await StaffActivityLog.create([{
      tenantId: req.tenantId,
      staffId: req.user._id,
      staffName: req.user.name,
      staffRole: req.user.role,
      action: 'packing_started',
      orderId: order._id,
      orderNumber: order.orderNumber,
    }], { session: mongoSession });
    return { session: packing, created: true };
  });

  if (result.created) {
    try { emitToWorkers(req.tenantId, 'order:updated', { orderId: req.params.orderId, status: 'packing' }); } catch {}
    await notifyAdmin(req.tenantId, 'packing_started', 'Packing started',
      `Order #${result.session.orderNumber} is being packed by ${req.user.name}.`,
      { orderId: result.session.orderId, orderNumber: result.session.orderNumber });
  }
  sendSuccess(res, {
    session: result.session,
    ...(!result.created ? { message: 'Packing session already exists.' } : {}),
  }, result.created ? 201 : 200);
});
export const getPackingSession = asyncHandler(async (req, res, next) => {
  const filter = { orderId: req.params.orderId, tenantId: req.tenantId };
  Object.assign(filter, sessionScope(req));

  const session = await PackingSession.findOne(filter);
  if (!session) return next(new AppError('Packing session not found.', 404));

  const order = await Order.findOne({ _id: session.orderId, tenantId: req.tenantId })
    .select('orderNumber orderType status customerInfo.name assignedTo deliveryAssignedTo fulfillment')
    .populate('assignedTo', 'name role').populate('deliveryAssignedTo', 'name role').lean();
  sendSuccess(res, { session, order });
});

export const updateItemStatus = asyncHandler(async (req, res, next) => {
  const { action, pickedQty, missingReason } = req.body;
  if (!['pick', 'pack', 'missing'].includes(action)) {
    return next(new AppError('Action must be pick, pack, or missing.', 400));
  }

  const result = await runInTransaction(async (mongoSession) => {
    const packing = await PackingSession.findOne({
      orderId: req.params.orderId,
      ...sessionScope(req),
      tenantId: req.tenantId,
      status: 'in_progress',
    }).session(mongoSession);
    if (!packing) throw new AppError('Active packing session not found.', 404);
    const item = packing.items.id(req.params.itemId);
    if (!item) throw new AppError('Item not found in packing session.', 404);

    const now = new Date();
    let activity;
    if (action === 'pick') {
      const qty = pickedQty == null ? item.requiredQty : Number(pickedQty);
      if (!Number.isSafeInteger(qty) || qty <= 0 || qty > item.requiredQty) {
        throw new AppError('Picked quantity must be a positive whole number within the required quantity.', 400);
      }
      item.pickedQty = qty;
      item.status = 'picked';
      item.pickedAt = now;
      item.pickedBy = actorSnapshot(req.user, now);
      item.packedBy = undefined;
      item.packedAt = undefined;
      activity = { action: 'item_picked', qty };
    } else if (action === 'pack') {
      if (item.status !== 'picked') throw new AppError('Item must be picked before marking as packed.', 400);
      item.status = 'packed';
      item.packedAt = now;
      item.packedBy = actorSnapshot(req.user, now);
      activity = { action: 'item_packed', qty: item.pickedQty };
    } else {
      item.status = 'missing';
      item.pickedQty = 0;
      item.missingReason = String(missingReason || 'Not available in stock').trim().slice(0, 300);
      item.markedMissingAt = now;
      item.markedMissingBy = actorSnapshot(req.user, now);
      item.packedBy = undefined;
      item.packedAt = undefined;
      activity = {
        action: 'item_missing',
        qty: item.requiredQty,
        metadata: { missingReason: item.missingReason },
      };
    }

    await packing.save({ session: mongoSession });
    await StaffActivityLog.create([{
      tenantId: req.tenantId,
      staffId: req.user._id,
      staffName: req.user.name,
      staffRole: req.user.role,
      action: activity.action,
      orderId: packing.orderId,
      orderNumber: packing.orderNumber,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.name,
      variantName: item.variantName,
      qty: activity.qty,
      isHighValue: item.isHighValue,
      metadata: activity.metadata,
    }], { session: mongoSession });
    return { session: packing, item: item.toObject() };
  });

  if (action === 'missing' && result.item.isHighValue) {
    safeEmitTenant(req.tenantId, 'packing:high_value_missing', {
      orderId: result.session.orderId,
      orderNumber: result.session.orderNumber,
      staffName: req.user.name,
      staffRole: req.user.role,
      productName: result.item.name,
      variantName: result.item.variantName,
      qty: result.item.requiredQty,
    });
    await notifyAdmin(
      req.tenantId,
      'item_missing',
      'High-Value Item Missing',
      `${result.item.name} (${result.item.variantName}) missing in Order #${result.session.orderNumber}`,
      { orderId: result.session.orderId, orderNumber: result.session.orderNumber }
    );
  }

  refreshPacking(req);
  sendSuccess(res, { session: result.session });
});
export const suggestReplacement = asyncHandler(async (req, res) => {
  const { replacementProductId, replacementVariantId, replacementNote } = req.body;
  if (!replacementProductId || !replacementVariantId) {
    throw new AppError('A replacement product and variant are required.', 400);
  }

  const packing = await runInTransaction(async (mongoSession) => {
    const replacement = await Product.findOne({
      _id: replacementProductId,
      tenantId: req.tenantId,
      isActive: true,
      variants: {
        $elemMatch: { _id: replacementVariantId, isActive: true, stock: { $gt: 0 } },
      },
    }).session(mongoSession);
    if (!replacement) throw new AppError('Replacement product variant is unavailable.', 400);

    const current = await PackingSession.findOne({
      orderId: req.params.orderId,
      ...sessionScope(req),
      tenantId: req.tenantId,
      status: 'in_progress',
    }).session(mongoSession);
    if (!current) throw new AppError('Active packing session not found.', 404);
    const item = current.items.id(req.params.itemId);
    if (!item) throw new AppError('Item not found.', 404);
    if (item.status !== 'missing') {
      throw new AppError('A replacement can only be suggested for a missing item.', 409);
    }

    item.replacementProductId = replacement._id;
    item.replacementVariantId = replacementVariantId;
    item.replacementNote = String(replacementNote || '').trim().slice(0, 300) || null;
    await current.save({ session: mongoSession });
    await StaffActivityLog.create([{
      tenantId: req.tenantId,
      staffId: req.user._id,
      staffName: req.user.name,
      staffRole: req.user.role,
      action: 'replacement_suggested',
      orderId: current.orderId,
      orderNumber: current.orderNumber,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.name,
      isHighValue: item.isHighValue,
      metadata: {
        replacementProductId: replacement._id,
        replacementVariantId,
        replacementNote: item.replacementNote,
      },
    }], { session: mongoSession });
    return current;
  });

  refreshPacking(req);
  sendSuccess(res, { session: packing });
});
export const completePackingSession = asyncHandler(async (req, res) => {
  const staffNotes = String(req.body.staffNotes || '').trim().slice(0, 500) || null;
  const result = await runInTransaction(async (mongoSession) => {
    const packing = await PackingSession.findOne({
      orderId: req.params.orderId,
      ...sessionScope(req),
      tenantId: req.tenantId,
      status: 'in_progress',
    }).session(mongoSession);
    if (!packing) throw new AppError('Active packing session not found.', 404);

    const unhandled = packing.items.filter((item) => !['packed', 'missing'].includes(item.status));
    if (unhandled.length > 0) {
      throw new AppError(
        `${unhandled.length} item(s) must be packed or marked missing before completion.`,
        400
      );
    }

    const totalPacked = packing.items
      .filter((item) => item.status === 'packed')
      .reduce((sum, item) => sum + item.pickedQty, 0);
    const totalMissing = packing.items
      .filter((item) => item.status === 'missing')
      .reduce((sum, item) => sum + item.requiredQty, 0);
    const highValueMissingCount = packing.items
      .filter((item) => item.status === 'missing' && item.isHighValue).length;

    const orderFilter = { _id: packing.orderId, tenantId: req.tenantId };
    if (!managesPacking(req)) orderFilter.assignedTo = req.user._id;
    const order = await Order.findOne(orderFilter).session(mongoSession);
    if (!order) throw new AppError('Assigned order not found.', 404);
    if (!canTransitionOrder(order.status, 'packed')) {
      throw new AppError(`Order cannot be completed from ${order.status}.`, 409);
    }

    packing.status = 'completed';
    packing.completedAt = new Date();
    packing.completedBy = actorSnapshot(req.user, packing.completedAt);
    packing.staffNotes = staffNotes;
    packing.totalPacked = totalPacked;
    packing.totalMissing = totalMissing;
    packing.highValueMissingCount = highValueMissingCount;
    order.status = 'packed';
    recordOrderAction(order, req.user, 'packing_completed',
      `Packing completed by ${req.user.name}. Packed: ${totalPacked}, Missing: ${totalMissing}`, { field: 'packingCompletedBy' });
    await packing.save({ session: mongoSession });
    await order.save({ session: mongoSession });
    await StaffActivityLog.create([{
      tenantId: req.tenantId,
      staffId: req.user._id,
      staffName: req.user.name,
      staffRole: req.user.role,
      action: 'packing_completed',
      orderId: packing.orderId,
      orderNumber: packing.orderNumber,
      metadata: { totalPacked, totalMissing, highValueMissingCount },
    }], { session: mongoSession });
    return { packing, totalPacked, totalMissing, highValueMissingCount };
  });

  safeEmitTenant(req.tenantId, 'packing:completed', {
    orderId: result.packing.orderId,
    orderNumber: result.packing.orderNumber,
    staffName: req.user.name,
      staffRole: req.user.role,
    totalPacked: result.totalPacked,
    totalMissing: result.totalMissing,
    highValueMissingCount: result.highValueMissingCount,
  });
  await notifyAdmin(req.tenantId, 'packing_completed', 'Packing ready for verification',
    `Order #${result.packing.orderNumber} was packed by ${req.user.name}.`,
    { orderId: result.packing.orderId, orderNumber: result.packing.orderNumber });
  await logAudit({
    tenantId: req.tenantId,
    action: 'order_packed',
    user: req.user,
    resource: {
      type: 'Order',
      id: result.packing.orderId,
      label: `#${result.packing.orderNumber}`,
    },
    description: `Packed by ${req.user.name}: ${result.totalPacked} packed, ${result.totalMissing} missing`,
    req,
  });

  sendSuccess(res, { session: result.packing });
});
export const getPackingQueue = asyncHandler(async (req, res, next) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, status: 'completed' };

  const [sessions, total] = await Promise.all([
    PackingSession.find(filter)
      .sort({ completedAt: -1 }).skip(skip).limit(limit).lean(),
    PackingSession.countDocuments(filter),
  ]);

  sendPaginated(res, sessions, total, page, limit);
});

export const getAdminPackingSession = asyncHandler(async (req, res, next) => {
  const session = await PackingSession.findOne({ _id: req.params.sessionId, tenantId: req.tenantId });
  if (!session) return next(new AppError('Packing session not found.', 404));
  const order = await Order.findOne({ _id: session.orderId, tenantId: req.tenantId })
    .select('orderNumber orderType status customerInfo pricing').lean();
  sendSuccess(res, { session, order });
});

export const verifyPackingSession = asyncHandler(async (req, res, next) => {
  const { action, rejectionReason, adminNotes, nextStatus } = req.body;
  if (!['approve', 'reject'].includes(action)) return next(new AppError('Action must be approve or reject.', 400));

  const result = await runInTransaction(async (session) => {
    const packing = await PackingSession.findOne({
      _id: req.params.sessionId, tenantId: req.tenantId,
    }).session(session);
    if (!packing) throw new AppError('Packing session not found.', 404);
    if (action === 'approve' && packing.status === 'verified') {
      const existingOrder = await Order.findOne({ _id: packing.orderId, tenantId: req.tenantId }).session(session);
      return { packing, order: existingOrder };
    }
    if (packing.status !== 'completed') throw new AppError('Only completed packing sessions can be verified.', 409);

    const order = await Order.findOne({ _id: packing.orderId, tenantId: req.tenantId }).session(session);
    if (!order) throw new AppError('Associated order not found.', 404);
    const now = new Date();

    if (action === 'approve') {
      const fulfilledQuantities = new Map(packing.items.map((item) => [
        String(item.variantId),
        item.status === 'missing' ? 0 : Number(item.pickedQty),
      ]));
      await restoreUnfulfilledStock({
        order,
        fulfilledQuantities,
        tenantId: req.tenantId,
        actorId: req.user._id,
        session,
        note: `Packing shortfall for ${order.orderNumber}`,
      });
      const subtotalMinor = order.items.reduce((sum, item) => {
        const quantity = item.fulfilledQty == null ? item.quantity : item.fulfilledQty;
        return sum + toMinorUnits(item.price, 'order item price') * quantity;
      }, 0);
      const discountMinor = fulfilledDiscountMinor(order);
      const store = await Store.findById(req.tenantId).select('taxSettings').session(session);
      const taxPercent = order.orderType !== 'counter' && store?.taxSettings?.enableGST
        ? Number(store.taxSettings.cgstPercent || 0) + Number(store.taxSettings.sgstPercent || 0)
        : 0;
      const taxMinor = percentOf(subtotalMinor - discountMinor, taxPercent, 'tax percentage');
      const deliveryMinor = toMinorUnits(order.pricing.deliveryCharge || 0);
      const nextTotalMinor = subtotalMinor - discountMinor + taxMinor + deliveryMinor;
      if (order.udharCustomerId) await adjustPOSUdharBalance({ order,
        amountChangeMinor: nextTotalMinor - toMinorUnits(order.pricing.grandTotal), actor: req.user,
        description: `Packing adjustment for ${order.orderNumber}`, session });
      order.pricing.subtotal = fromMinorUnits(subtotalMinor);
      order.pricing.couponDiscount = fromMinorUnits(discountMinor);
      order.pricing.tax = fromMinorUnits(taxMinor);
      order.pricing.grandTotal = fromMinorUnits(subtotalMinor - discountMinor + taxMinor + deliveryMinor);
      snapshotRefundLines(order);

      const automaticStatus = ['self_pickup', 'counter'].includes(order.orderType) ? 'ready_for_pickup' : 'out_for_delivery';
      const dispatchStatus = nextStatus || automaticStatus;
      if (dispatchStatus !== automaticStatus || !canTransitionOrder(order.status, dispatchStatus)) {
        throw new AppError('Invalid dispatch status for this order.', 409);
      }
      packing.status = 'verified';
      packing.verifiedAt = now;
      packing.verifiedBy = req.user._id;
      packing.verifierName = req.user.name;
      packing.verifierRole = req.user.role;
      packing.adminNotes = String(adminNotes || '').trim().slice(0, 500) || null;
      order.status = dispatchStatus;
      recordOrderAction(order, req.user, 'packing_verified', 'Packing verified and order released for fulfillment.', { field: 'packingVerifiedBy', at: now });
      order.set('fulfillment.dispatchedBy', actorSnapshot(req.user, now));
      await packing.save({ session });
      await order.save({ session });
      await StaffActivityLog.create([{
        tenantId: req.tenantId,
        staffId: req.user._id,
        staffName: req.user.name,
      staffRole: req.user.role,
        action: 'packing_verified',
        orderId: order._id,
        orderNumber: order.orderNumber,
        metadata: { approved: true },
      }], { session });
    } else {
      if (!String(rejectionReason || '').trim()) throw new AppError('Rejection reason is required.', 400);
      if (!canTransitionOrder(order.status, 'packing')) throw new AppError('Order cannot return to packing.', 409);
      packing.status = 'in_progress';
      packing.completedAt = null;
      packing.completedBy = undefined;
      packing.rejectionReason = String(rejectionReason).trim().slice(0, 500);
      packing.adminNotes = String(adminNotes || '').trim().slice(0, 500) || null;
      order.status = 'packing';
      recordOrderAction(order, req.user, 'packing_rejected', `Packing rejected: ${packing.rejectionReason}`, { at: now });
      order.set('fulfillment.packingCompletedBy', undefined);
      await packing.save({ session });
      await order.save({ session });
      await StaffActivityLog.create([{
        tenantId: req.tenantId,
        staffId: req.user._id,
        staffName: req.user.name,
      staffRole: req.user.role,
        action: 'packing_rejected',
        orderId: order._id,
        orderNumber: order.orderNumber,
        metadata: { rejectionReason: packing.rejectionReason },
      }], { session });
    }
    return { packing, order };
  });

  safeEmitUser(result.packing.staffId, action === 'approve' ? 'packing:verified' : 'packing:rejected', {
    orderId: result.order._id,
    orderNumber: result.order.orderNumber,
    status: action === 'approve' ? 'approved' : 'rejected',
    ...(action === 'reject' ? { reason: result.packing.rejectionReason } : {}),
  });
  try { emitToWorkers(req.tenantId, 'order:updated', { orderId: result.packing.orderId }); } catch {}
  await notifyStaff(req.tenantId, result.packing.staffId, action === 'approve' ? 'packing_verified' : 'packing_rejected',
    action === 'approve' ? 'Packing verified' : 'Packing needs attention',
    `Order #${result.packing.orderNumber}: ${action === 'approve' ? 'packing approved.' : 'please review and repack.'}`,
    { orderId: result.packing.orderId, orderNumber: result.packing.orderNumber });
  if (action === 'approve' && result.order.deliveryAssignedTo) {
    await notifyStaff(req.tenantId, result.order.deliveryAssignedTo, 'out_for_delivery', 'Order ready for delivery',
      `Order #${result.order.orderNumber} is packed and verified.`,
      { orderId: result.order._id, orderNumber: result.order.orderNumber });
  }
  sendSuccess(res, { session: result.packing, order: result.order });
});

export const getStaffActivityLogs = asyncHandler(async (req, res, next) => {
  const { staffId, action, highValueOnly, dateFrom, dateTo } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = { tenantId: req.tenantId };

  if (staffId) filter.staffId = staffId;
  if (action) filter.action = action;
  if (highValueOnly === 'true') filter.isHighValue = true;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  const [logs, total] = await Promise.all([
    StaffActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StaffActivityLog.countDocuments(filter),
  ]);

  sendPaginated(res, logs, total, page, limit);
});

export const getMissingItemsReport = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const matchFilter = {
    tenantId: req.tenantId,
    action: 'item_missing',
  };
  if (dateFrom || dateTo) {
    matchFilter.createdAt = {};
    if (dateFrom) matchFilter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchFilter.createdAt.$lte = new Date(dateTo);
  }

  const report = await StaffActivityLog.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: { productId: '$productId', variantId: '$variantId' },
        productName: { $first: '$productName' },
        variantName: { $first: '$variantName' },
        isHighValue: { $first: '$isHighValue' },
        totalMissingQty: { $sum: '$qty' },
        occurrences: { $sum: 1 },
        staffList: { $addToSet: '$staffName' },
        lastMissing: { $max: '$createdAt' },
      },
    },
    { $sort: { isHighValue: -1, occurrences: -1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: limit }], count: [{ $count: 'total' }] } },
  ]);

  sendSuccess(res, { report: report[0]?.rows || [] }, 200, { meta: { page, limit, total: report[0]?.count[0]?.total || 0, totalPages: Math.ceil((report[0]?.count[0]?.total || 0) / limit) } });
});

export const getHighValueAlerts = asyncHandler(async (req, res, next) => {
  // Recent high-value missing items (last 7 days)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {
    tenantId: req.tenantId,
    action: 'item_missing',
    isHighValue: true,
    createdAt: { $gte: since },
  };
  const [alerts, total] = await Promise.all([StaffActivityLog.find(filter).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit).lean(), StaffActivityLog.countDocuments(filter)]);

  sendSuccess(res, { alerts }, 200, { meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

export const getStaffPackingSessions = asyncHandler(async (req, res, next) => {
  const { staffId, status } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { tenantId: req.tenantId };
  if (staffId) filter.staffId = staffId;
  if (status) filter.status = status;

  const [sessions, total] = await Promise.all([
    PackingSession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PackingSession.countDocuments(filter),
  ]);

  sendPaginated(res, sessions, total, page, limit);
});
