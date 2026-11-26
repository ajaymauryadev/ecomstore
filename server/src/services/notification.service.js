import Notification from '../models/Notification.js';
import { logger } from '../config/logger.js';
import { emitToTenantRoles, emitToUser } from '../config/socket.js';
import User from '../models/User.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';

export const publishNotification = (notification) => {
  if (!notification) return;
  try {
    if (notification.userId) emitToUser(String(notification.userId), 'notification:new', { notification });
    else {
      const roles = notification.role === 'admin' ? ['store_owner']
        : notification.role === 'staff' ? ['staff', 'packer', 'delivery'] : ['customer'];
      emitToTenantRoles(String(notification.tenantId), roles, 'notification:new', { notification });
    }
  } catch { /* The persisted inbox recovers updates when sockets reconnect. */ }
};

const customerStatusMessages = {
  accepted: ['order_accepted', 'Order accepted', 'Your order has been accepted by the store.'],
  packing: ['packing_started', 'Your order is being packed', 'The store has started preparing your order.'],
  packed: ['packing_completed', 'Your order is packed', 'Your items have been packed and are awaiting verification.'],
  ready_for_pickup: ['ready_for_pickup', 'Ready for pickup', 'Your order is ready to collect from the store.'],
  out_for_delivery: ['out_for_delivery', 'Out for delivery', 'Your order is on its way.'],
  delivered: ['delivered', 'Order delivered', 'Your order has been delivered.'],
  cancelled: ['order_cancelled', 'Order cancelled', 'Your order has been cancelled.'],
  rejected: ['order_cancelled', 'Order not accepted', 'The store could not accept your order.'],
};

// Called only for a real transition, within the order transaction. A retry
// cannot commit the status without its inbox entry or create a second entry.
export const recordCustomerOrderUpdate = async (order, session) => {
  const message = customerStatusMessages[order.status];
  if (!order.customerId || !message) return null;
  const [type, title, body] = message;
  const reason = ['cancelled', 'rejected'].includes(order.status) ? order.cancelReason : null;
  const [notification] = await Notification.create([{
    tenantId: order.tenantId, userId: order.customerId, role: 'customer', type, title,
    body: `Order #${order.orderNumber}: ${reason || body}`,
    data: { orderId: order._id, orderNumber: order.orderNumber, status: order.status },
  }], { session });
  return notification;
};

export const notify = async ({ tenantId, userId, role, type, title, body = '', data = {} }) => {
  try {
    const notification = await Notification.create({ tenantId, userId, role, type, title, body, data });
    publishNotification(notification);
    return notification;
  } catch (err) {
    logger.error(`Notification write failed: ${err.message}`);
  }
};

const delegatedNotifications = {
  packing_started: PERMISSIONS.PACKING_MANAGE,
  packing_completed: PERMISSIONS.PACKING_VERIFY,
  item_missing: PERMISSIONS.PACKING_MANAGE,
  payment_submitted: PERMISSIONS.ORDERS_PAYMENT_VERIFY,
  out_for_delivery: PERMISSIONS.DELIVERY_MANAGE,
  delivered: PERMISSIONS.DELIVERY_MANAGE,
};

export const notifyAdmin = async (tenantId, type, title, body = '', data = {}) => {
  const result = await notify({ tenantId, role: 'admin', type, title, body, data });
  const permission = delegatedNotifications[type];
  if (permission) {
    try {
      const team = await User.find({ tenantId, isActive: true, role: { $in: ['staff', 'packer', 'delivery'] } })
        .select('_id role permissions').lean();
      await Promise.all(team.filter((user) => hasPermission(user, permission))
        .map((user) => notifyStaff(tenantId, user._id, type, title, body, data)));
    } catch (error) { logger.error(`Delegated notification failed: ${error.message}`); }
  }
  return result;
};

export const notifyStaff = (tenantId, userId, type, title, body = '', data = {}) =>
  notify({ tenantId, userId, role: 'staff', type, title, body, data });

export const notifyCustomer = (tenantId, userId, type, title, body = '', data = {}) =>
  notify({ tenantId, userId, role: 'customer', type, title, body, data });

export const notifyTeam = async (tenantId, type, title, body = '', data = {}) => {
  try {
    const recipients = await User.find({ tenantId, isActive: true, role: { $in: ['staff', 'packer', 'delivery'] } }).select('_id').lean();
    await Promise.all(recipients.map(({ _id }) => notifyStaff(tenantId, _id, type, title, body, data)));
  } catch (err) { logger.error(`Team notification failed: ${err.message}`); }
};
