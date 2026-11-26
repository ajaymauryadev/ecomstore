import Order from '../models/Order.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { parsePagination } from '../utils/query.js';
import { canTransitionOrder } from '../constants/orderStatus.js';
import { consumeOrderReservation } from '../services/stock.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { emitToUser, emitToWorkers } from '../config/socket.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';
import { notifyAdmin, recordCustomerOrderUpdate, publishNotification } from '../services/notification.service.js';
import { logAudit } from '../services/audit.service.js';
import { recordOrderAction } from '../utils/orderAttribution.js';
import StaffActivityLog from '../models/StaffActivityLog.js';

const deliveryScope = (req) => hasPermission(req.user, PERMISSIONS.DELIVERY_MANAGE)
  ? {} : { deliveryAssignedTo: req.user._id };

const safeEmitUser = (userId, event, payload) => {
  try { emitToUser(userId, event, payload); } catch {}
};

export const getDeliveryOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const filter = {
    tenantId: req.tenantId,
    ...deliveryScope(req),
    orderType: { $in: ['home_delivery', 'online'] },
  };
  if (req.query.status) filter.status = req.query.status;
  else filter.status = { $in: ['pending', 'payment_pending', 'payment_submitted', 'payment_verified', 'accepted', 'packing', 'packed', 'partially_fulfilled', 'out_for_delivery', 'delivered'] };
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select('orderNumber orderType deliveryArea items.name items.variantName items.quantity customerInfo.name customerInfo.phone customerInfo.address pricing.grandTotal status paymentStatus paymentMethod timeline assignedTo deliveryAssignedTo fulfillment createdAt deliveredAt')
      .populate('assignedTo', 'name role')
      .populate('deliveryAssignedTo', 'name role')
      .sort({ status: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);
  sendPaginated(res, orders, total, page, limit);
});

export const updateDeliveryStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  if (!['out_for_delivery', 'delivered'].includes(status)) {
    return next(new AppError('Invalid delivery status.', 400));
  }
  const order = await runInTransaction(async (session) => {
    const current = await Order.findOne({
      _id: req.params.orderId,
      tenantId: req.tenantId,
      ...deliveryScope(req),
      orderType: { $in: ['home_delivery', 'online'] },
    }).session(session);
    if (!current) throw new AppError('Assigned delivery order not found.', 404);
    if (current.status === status) return { order: current, changed: false };
    if (!canTransitionOrder(current.status, status)) {
      throw new AppError(`Delivery cannot transition from ${current.status} to ${status}.`, 409);
    }
    current.status = status;
    const at = new Date();
    const action = status === 'delivered' ? 'delivery_completed' : 'delivery_started';
    recordOrderAction(current, req.user, action,
      status === 'delivered' ? 'Order delivered' : 'Order is out for delivery',
      { field: status === 'delivered' ? 'deliveredBy' : 'deliveryStartedBy', at });
    if (status === 'delivered') {
      current.deliveredAt = at;
      if (current.paymentMethod === 'cod') current.recordPayment(current.deliveredAt);
      if (current.stockReservationState === 'reserved') {
        await consumeOrderReservation({ order: current, session });
      } else {
        await current.save({ session });
      }
    } else {
      await current.save({ session });
    }
    await StaffActivityLog.create([{
      tenantId: req.tenantId, staffId: req.user._id, staffName: req.user.name, staffRole: req.user.role,
      action, orderId: current._id, orderNumber: current.orderNumber,
    }], { session });
    return { order: current, changed: true, notification: await recordCustomerOrderUpdate(current, session) };
  });
  const updated = order.order;
  if (order.changed) {
    publishNotification(order.notification);
    try { emitToWorkers(req.tenantId, 'order:updated', { orderId: updated._id, status: updated.status }); } catch {}
    if (updated.customerId) safeEmitUser(updated.customerId, 'order:status_updated', {
      orderId: updated._id, orderNumber: updated.orderNumber, status: updated.status,
    });
    await notifyAdmin(req.tenantId, status, status === 'delivered' ? 'Order delivered' : 'Delivery started',
      `Order #${updated.orderNumber} updated by ${req.user.name}.`, { orderId: updated._id, orderNumber: updated.orderNumber });
    await logAudit({ tenantId: req.tenantId, action: status === 'delivered' ? 'order_delivered' : 'staff_action', user: req.user,
      resource: { type: 'Order', id: updated._id, label: updated.orderNumber }, description: `Delivery marked ${status} by ${req.user.name}`, req });
  }
  sendSuccess(res, { order: updated });
});
