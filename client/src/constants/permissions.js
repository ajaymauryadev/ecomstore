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

const ALL = Object.values(PERMISSIONS);
const DELEGATABLE = ALL.filter((permission) => permission !== PERMISSIONS.STAFF_MANAGE);
export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  super_admin: ALL,
  store_owner: ALL,
  staff: [
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
  ],
  packer: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CATEGORIES_VIEW,
    PERMISSIONS.PACKING_VIEW,
    PERMISSIONS.PACKING_PERFORM,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ],
  delivery: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DELIVERY_VIEW,
    PERMISSIONS.DELIVERY_UPDATE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ],
  customer: [],
});

export const ROLE_ALLOWED_PERMISSIONS = Object.freeze({
  super_admin: ALL,
  store_owner: ALL,
  staff: DELEGATABLE,
  packer: DELEGATABLE,
  delivery: DELEGATABLE,
  customer: [],
});

export const effectivePermissions = (user) =>
  [...new Set([...(ROLE_DEFAULT_PERMISSIONS[user?.role] || []), ...(user?.permissions || [])])]
    .filter((permission) => (ROLE_ALLOWED_PERMISSIONS[user?.role] || []).includes(permission));

export const hasPermission = (user, permission) =>
  effectivePermissions(user).includes(permission);

export const hasEveryPermission = (user, permissions = []) =>
  permissions.every((permission) => hasPermission(user, permission));

export const hasAnyPermission = (user, permissions = []) =>
  permissions.some((permission) => hasPermission(user, permission));

export const permissionDependencies = (permission) => {
  const module = permission.split('.')[0];
  const view = `${module}.view`;
  const dependencies = view !== permission && ALL.includes(view) ? [view] : [];
  if (permission.startsWith('pos.') && permission !== PERMISSIONS.POS_ACCESS) dependencies.push(PERMISSIONS.POS_ACCESS);
  if (permission === PERMISSIONS.POS_ACCESS) dependencies.push(PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.CATEGORIES_VIEW);
  if (permission === PERMISSIONS.PACKING_PERFORM) dependencies.push(PERMISSIONS.PRODUCTS_VIEW);
  if (permission === PERMISSIONS.PURCHASES_MANAGE) dependencies.push(PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.SUPPLIERS_VIEW);
  if (permission === PERMISSIONS.RETURNS_CREATE) dependencies.push(PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.ORDERS_VIEW);
  if (permission === PERMISSIONS.SUPPLIERS_PAY || permission === PERMISSIONS.PURCHASES_PAY) dependencies.push(PERMISSIONS.ACCOUNTING_VIEW);
  if (permission === PERMISSIONS.ORDERS_ASSIGN) dependencies.push(PERMISSIONS.STAFF_VIEW);
  if (permission === PERMISSIONS.PACKING_MANAGE) dependencies.push(PERMISSIONS.PACKING_PERFORM);
  if (permission === PERMISSIONS.DELIVERY_MANAGE) dependencies.push(PERMISSIONS.DELIVERY_UPDATE);
  return dependencies;
};

export const withPermissionDependencies = (permissions) => {
  const result = new Set(permissions);
  for (const permission of result) for (const dependency of permissionDependencies(permission)) result.add(dependency);
  return [...result];
};
