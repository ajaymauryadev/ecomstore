import { hasPermission, PERMISSIONS } from '../constants/permissions';

export function notificationTarget(user, notification, storeSlug) {
  if (user?.role === 'customer') {
    return storeSlug && notification.data?.orderId
      ? `/s/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(notification.data.orderId)}` : null;
  }
  const owner = user?.role === 'store_owner';
  if (notification.type === 'low_stock' && hasPermission(user, PERMISSIONS.INVENTORY_VIEW)) return '/store/inventory/low-stock';
  const id = notification.data?.orderId;
  if (!id) return null;
  if (notification.type === 'packing_completed' && hasPermission(user, PERMISSIONS.PACKING_VERIFY)) return '/store/packing';
  if (notification.type === 'payment_submitted' && hasPermission(user, PERMISSIONS.ORDERS_PAYMENT_VERIFY)) return '/store/orders/payment-queue';
  if ((['out_for_delivery', 'delivered'].includes(notification.type) || notification.data?.task === 'delivery') && hasPermission(user, PERMISSIONS.DELIVERY_VIEW)) return owner ? '/store/deliveries' : '/staff/deliveries';
  if (hasPermission(user, PERMISSIONS.ORDERS_VIEW)) return '/store/orders?orderId=' + encodeURIComponent(id);
  if (hasPermission(user, PERMISSIONS.PACKING_VIEW)) return owner ? '/store/packing/work' : '/staff/packing';
  if (hasPermission(user, PERMISSIONS.DELIVERY_VIEW)) return owner ? '/store/deliveries' : '/staff/deliveries';
  return null;
}
