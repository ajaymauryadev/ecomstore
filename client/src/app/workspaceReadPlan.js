import { PERMISSIONS as P, hasPermission } from '../constants/permissions';
import { PAGE_SIZE } from '../constants/pagination';
import { POS_CATALOG_PARAMS } from '../features/pos/catalog';
import { accountingDate, resolveStoreTimeZone } from '../utils/accounting';

// Match each page's initial arguments exactly: RTK Query keys include empty
// filters and distinguish undefined from {}. Never prefetch writes or exports.
export function workspaceReadPlan(user, store) {
  const page = { page: 1, limit: PAGE_SIZE };
  const today = accountingDate(undefined, resolveStoreTimeZone(store?.settings?.timezone));
  const range = { startDate: today.slice(0, 8) + '01', endDate: today };
  const month = { monthYear: today.slice(0, 7) };
  const reads = [];
  const add = (permission, path, ...queries) => {
    if (hasPermission(user, permission)) reads.push({ path, queries });
  };
  add(P.POS_ACCESS, '/store/pos', ['getProducts', POS_CATALOG_PARAMS]);
  add(P.PRODUCTS_VIEW, '/store/products', ['getProducts', page]);
  add(P.ACCOUNTING_VIEW, '/store/supplier-payments', ['getSuppliers', page]);
  add(P.CATEGORIES_VIEW, '/store/categories', ['getCategories']);
  add(P.DASHBOARD_VIEW, user.role === 'store_owner' ? '/store/dashboard' : '/staff/dashboard', ['getDashboard']);
  if (store?.slug) {
    add(P.ORDERS_VIEW, '/store/orders', ['getAdminOrders', { slug: store.slug, ...(user.role === 'store_owner' && { status: '' }), ...page }]);
    add(P.ORDERS_PAYMENT_VERIFY, '/store/orders/payment-queue', ['getPaymentQueue', { slug: store.slug, ...page }]);
  }
  add(P.PACKING_VERIFY, '/store/packing', ['getPackingQueue', page]);
  add(P.PACKING_VIEW, '/store/packing/work', ['getMyPackingOrders']);
  add(P.DELIVERY_VIEW, '/store/deliveries', ['getDeliveryOrders', page]);
  add(P.INVENTORY_VIEW, '/store/inventory', ['getInventoryDashboard'], ['getInventoryList', { search: '', categoryId: '', stockStatus: '', ...page }]);
  add(P.INVENTORY_VIEW, '/store/inventory/low-stock', ['getLowStockProducts']);
  add(P.SUPPLIERS_VIEW, '/store/suppliers', ['getSuppliers', { search: '', ...page }]);
  add(P.PURCHASES_VIEW, '/store/purchases', ['getPurchases', { search: '', paymentStatus: '', ...page }], ['getPurchaseStats', {}]);
  add(P.ACCOUNTING_VIEW, '/store/udhar', ['getUdharCustomers', page], ['getUdharStats']);
  add(P.ACCOUNTING_VIEW, '/store/daily-closing', ['getDailySummary', { date: today }], ['getDailyClosings', page]);
  add(P.ACCOUNTING_VIEW, '/store/expenses', ['getExpenses', { ...page, ...range }], ['getExpenseStats', range]);
  add(P.SALARY_VIEW, '/store/salary', ['getSalaryRecords', { ...month, ...page }], ['getSalaryStats', month], ['getStaffList']);
  add(P.RETURNS_VIEW, '/store/returns', ['getReturns', { type: 'customer_return', ...page }],
    ...(hasPermission(user, P.RETURNS_PROCESS) ? [['getReturnStats', {}]] : []));
  add(P.REPORTS_SENSITIVE, '/store/profit-loss', ['getProfitLoss', range]);
  add(P.REPORTS_SENSITIVE, '/store/sales', ['getSalesOverview', { startDate: today, endDate: today, ...page }]);
  add(P.REPORTS_SENSITIVE, '/store/reports', ['getDailySales', { date: today }]);
  add(P.STAFF_MANAGE, '/store/staff', ['getStaff', page]);
  add(P.PACKING_REPORTS, '/store/staff-activity', ['getStaffActivityLogs', { highValueOnly: false, ...page }]);
  add(P.COUPONS_VIEW, '/store/coupons', ['getCoupons', page]);
  add(P.OFFERS_VIEW, '/store/offers', ['getOffers', page]);
  add(P.SETTINGS_VIEW, '/store/settings', ['getMyStore']);
  add(P.NOTIFICATIONS_VIEW, '/store/notifications', ['getNotifications', page]);
  add(P.BACKUP_EXPORT, '/store/backup');
  add(P.AUDIT_LOGS_VIEW, '/store/audit-logs', ['getAuditLogs', page]);
  return reads;
}
