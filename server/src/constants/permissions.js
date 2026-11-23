export const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: 'dashboard.view',

  POS_ACCESS: 'pos.access',
  POS_DISCOUNT: 'pos.discount',
  POS_PRICE_OVERRIDE: 'pos.price_override',
  POS_REFUND: 'pos.refund',

  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',
  CATEGORIES_VIEW: 'categories.view',
  CATEGORIES_MANAGE: 'categories.manage',

  ORDERS_VIEW: 'orders.view',
  ORDERS_STATUS_UPDATE: 'orders.status.update',
  ORDERS_ASSIGN: 'orders.assign',
  ORDERS_CANCEL: 'orders.cancel',
  ORDERS_REJECT: 'orders.reject',
  ORDERS_PARTIAL_FULFILL: 'orders.partial_fulfill',
  ORDERS_PAYMENT_VERIFY: 'orders.payment.verify',

  PACKING_VIEW: 'packing.view',
  PACKING_PERFORM: 'packing.perform',
  PACKING_MANAGE: 'packing.manage',
  PACKING_VERIFY: 'packing.verify',
  PACKING_REPORTS: 'packing.reports',

  DELIVERY_VIEW: 'delivery.view',
  DELIVERY_UPDATE: 'delivery.update',
  DELIVERY_MANAGE: 'delivery.manage',

  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',

  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_MANAGE: 'purchases.manage',
  PURCHASES_PAY: 'purchases.pay',
  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  SUPPLIERS_PAY: 'suppliers.pay',

  RETURNS_VIEW: 'returns.view',
  RETURNS_CREATE: 'returns.create',
  RETURNS_PROCESS: 'returns.process',

  STAFF_VIEW: 'staff.view',
  STAFF_MANAGE: 'staff.manage',
  ACCOUNTING_VIEW: 'accounting.view',
  ACCOUNTING_MANAGE: 'accounting.manage',
  SALARY_VIEW: 'salary.view',
  SALARY_MANAGE: 'salary.manage',
  REPORTS_VIEW: 'reports.view',
  REPORTS_SENSITIVE: 'reports.sensitive',
  COUPONS_VIEW: 'coupons.view',
  COUPONS_MANAGE: 'coupons.manage',
  OFFERS_VIEW: 'offers.view',
  OFFERS_MANAGE: 'offers.manage',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  BACKUP_EXPORT: 'backup.export',
  AUDIT_LOGS_VIEW: 'audit_logs.view',
  NOTIFICATIONS_VIEW: 'notifications.view',
});

const ALL = Object.freeze(Object.values(PERMISSIONS));
// Owners choose additional duties for any employee. Only owners grant access.
const DELEGATABLE = Object.freeze(ALL.filter((permission) => permission !== PERMISSIONS.STAFF_MANAGE));

export const ROLE_ALLOWED_PERMISSIONS = Object.freeze({
  super_admin: ALL,
  store_owner: ALL,
  staff: DELEGATABLE,
  packer: DELEGATABLE,
  delivery: DELEGATABLE,
  customer: Object.freeze([]),
});

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  super_admin: ALL,
  store_owner: ALL,
  staff: Object.freeze([
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.POS_ACCESS,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CATEGORIES_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.PACKING_VIEW,
    PERMISSIONS.PACKING_PERFORM,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.SUPPLIERS_VIEW,
    PERMISSIONS.RETURNS_VIEW,
    PERMISSIONS.RETURNS_CREATE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ]),
  packer: Object.freeze([
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CATEGORIES_VIEW,
    PERMISSIONS.PACKING_VIEW,
    PERMISSIONS.PACKING_PERFORM,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ]),
  delivery: Object.freeze([
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DELIVERY_VIEW,
    PERMISSIONS.DELIVERY_UPDATE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ]),
  customer: Object.freeze([]),
});

export const getEffectivePermissions = (user) => {
  if (!user?.role) return [];
  const allowed = new Set(ROLE_ALLOWED_PERMISSIONS[user.role] || []);
  const defaults = ROLE_DEFAULT_PERMISSIONS[user.role] || [];
  const assigned = Array.isArray(user.permissions) ? user.permissions : [];
  return [...new Set([...defaults, ...assigned].filter((permission) => allowed.has(permission)))];
};

export const hasPermission = (user, permission) =>
  getEffectivePermissions(user).includes(permission);

export const canAssignPermissions = (role, permissions = []) => {
  const allowed = new Set(ROLE_ALLOWED_PERMISSIONS[role] || []);
  return permissions.every((permission) => allowed.has(permission));
};

export const ALL_PERMISSIONS = ALL;
