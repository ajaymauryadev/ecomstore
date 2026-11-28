const id = (value) => String(value?._id ?? value ?? '');

export function notificationBelongsTo(user, notification) {
  if (!user || !notification?._id) return false;
  if (user.tenantId && notification.tenantId && id(user.tenantId) !== id(notification.tenantId)) return false;
  if (notification.userId) return id(notification.userId) === id(user._id);
  return user.role === 'store_owner' && notification.role === 'admin';
}
