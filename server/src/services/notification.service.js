import Notification from '../models/Notification.js';
import { logger } from '../config/logger.js';
import { emitToTenantRoles, emitToUser } from '../config/socket.js';
import User from '../models/User.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';

export const notify = async ({ tenantId, userId, role, type, title, body = '', data = {} }) => {
  try {
    const notification = await Notification.create({ tenantId, userId, role, type, title, body, data });
    const payload = { notification };
    if (userId) {
      try { emitToUser(userId.toString(), 'notification:new', payload); } catch {}
    } else {
      const roles = role === 'admin' ? ['store_owner'] : role === 'staff' ? ['staff', 'packer', 'delivery'] : ['customer'];
      try { emitToTenantRoles(tenantId.toString(), roles, 'notification:new', payload); } catch {}
    }
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
