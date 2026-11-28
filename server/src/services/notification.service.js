import Notification from '../models/Notification.js';
import { logger } from '../config/logger.js';
import { emitToTenantRoles, emitToUser } from '../config/socket.js';
import User from '../models/User.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';

export function publishNotification(notification) {
  const { tenantId, userId, role } = notification;
  const payload = { notification };
  try {
    if (userId) emitToUser(userId.toString(), 'notification:new', payload);
    else {
      const roles = role === 'admin' ? ['store_owner'] : role === 'staff' ? ['staff', 'packer', 'delivery'] : ['customer'];
      emitToTenantRoles(tenantId.toString(), roles, 'notification:new', payload);
    }
  } catch { /* The persisted inbox and revision check recover missed socket delivery. */ }
}

// Called inside checkout's existing transaction: an acknowledged new order has
// its owner/team inbox records, even if the process exits before socket delivery.
export async function saveNewOrderNotifications(order, session) {
  const recipients = await User.find({ tenantId: order.tenantId, isActive: true,
    role: { $in: ['staff', 'packer', 'delivery'] } }).select('_id').session(session).lean();
  const values = {
    tenantId: order.tenantId, type: 'new_order', title: 'New Order Received',
    body: `Order #${order.orderNumber} received`, data: { orderId: order._id, orderNumber: order.orderNumber },
  };
  return Notification.insertMany([
    { ...values, role: 'admin' },
    ...recipients.map(({ _id }) => ({ ...values, userId: _id, role: 'staff' })),
  ], { session, ordered: true });
}

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
