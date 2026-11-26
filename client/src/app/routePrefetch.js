import { backgroundAllowed } from './backgroundTasks';

export const pageLoaders = {
  SuperAdminLayout: () => import('../components/layout/SuperAdminLayout'),
  StoreOwnerLayout: () => import('../components/layout/StoreOwnerLayout'),
  StaffLayout: () => import('../components/layout/StaffLayout'),
  CustomerLayout: () => import('../components/layout/CustomerLayout'),
  Login: () => import('../pages/auth/Login'),
  Register: () => import('../pages/auth/Register'),
  StoreOwnerDashboard: () => import('../pages/store-owner/Dashboard'),
  StaffDashboard: () => import('../pages/staff/Dashboard'),
  StaffOrdersPage: () => import('../pages/staff/StaffOrdersPage'),
  StaffPackingPage: () => import('../pages/staff/StaffPackingPage'),
  DeliveryOrdersPage: () => import('../pages/delivery/DeliveryOrdersPage'),
  StoreFront: () => import('../pages/customer/StoreFront'),
  ProductDetail: () => import('../pages/customer/ProductDetail'),
  CartPage: () => import('../pages/customer/CartPage'),
  Checkout: () => import('../pages/customer/Checkout'),
  OrderTracking: () => import('../pages/customer/OrderTracking'),
  OrderHistory: () => import('../pages/customer/OrderHistory'),
  AccountPage: () => import('../pages/customer/AccountPage'),
  CustomerAuth: () => import('../pages/customer/CustomerAuth'),
  NotFound: () => import('../pages/NotFound'),
  ProductForm: () => import('../pages/store-owner/products/ProductForm'),
  CategoriesPage: () => import('../pages/store-owner/categories/CategoriesPage'),
  SuppliersPage: () => import('../pages/store-owner/suppliers/SuppliersPage'),
  PurchaseList: () => import('../pages/store-owner/purchases/PurchaseList'),
  PurchaseForm: () => import('../pages/store-owner/purchases/PurchaseForm'),
  InventoryDashboard: () => import('../pages/store-owner/inventory/InventoryDashboard'),
  LowStockPage: () => import('../pages/store-owner/inventory/LowStockPage'),
  StockLedgerPage: () => import('../pages/store-owner/inventory/StockLedgerPage'),
  PaymentVerificationPage: () => import('../pages/store-owner/orders/PaymentVerificationPage'),
  PackingVerificationPage: () => import('../pages/store-owner/orders/PackingVerificationPage'),
  StaffActivityPage: () => import('../pages/store-owner/orders/StaffActivityPage'),
  DailyClosingPage: () => import('../pages/store-owner/daily-closing/DailyClosingPage'),
  ReturnsPage: () => import('../pages/store-owner/returns/ReturnsPage'),
  UdharPage: () => import('../pages/store-owner/accounting/UdharPage'),
  ExpensesPage: () => import('../pages/store-owner/accounting/ExpensesPage'),
  SalaryPage: () => import('../pages/store-owner/accounting/SalaryPage'),
  SupplierPaymentsPage: () => import('../pages/store-owner/accounting/SupplierPaymentsPage'),
  ProfitLossPage: () => import('../pages/store-owner/accounting/ProfitLossPage'),
  ReportsPage: () => import('../pages/store-owner/reports/ReportsPage'),
  SalesOverviewPage: () => import('../pages/store-owner/reports/SalesOverviewPage'),
  CouponsPage: () => import('../pages/store-owner/coupons/CouponsPage'),
  OffersPage: () => import('../pages/store-owner/offers/OffersPage'),
  SettingsPage: () => import('../pages/store-owner/settings/SettingsPage'),
  NotificationsPage: () => import('../pages/store-owner/notifications/NotificationsPage'),
  BackupPage: () => import('../pages/store-owner/backup/BackupPage'),
  AuditLogsStorePage: () => import('../pages/store-owner/audit/AuditLogsPage'),
  StaffManagementPage: () => import('../pages/store-owner/staff/StaffManagementPage'),
  SuperAdminDashboard: () => import('../pages/super-admin/Dashboard'),
  StoresPage: () => import('../pages/super-admin/StoresPage'),
  TenantDetailPage: () => import('../pages/super-admin/TenantDetailPage'),
  PlansPage: () => import('../pages/super-admin/PlansPage'),
  SAuditLogsPage: () => import('../pages/super-admin/AuditLogsPage'),
  POSPage: () => import('../pages/store-owner/pos/POSPage'),
  ProductList: () => import('../pages/store-owner/products/ProductList'),
  OrdersManagement: () => import('../pages/store-owner/orders/OrdersManagement'),
  OperationalOrdersPage: () => import('../pages/staff/OperationalOrdersPage'),
};

const routes = {
  '/store/dashboard': pageLoaders.StoreOwnerDashboard,
  '/store/pos': pageLoaders.POSPage,
  '/store/products': pageLoaders.ProductList,
  '/store/products/new': pageLoaders.ProductForm,
  '/store/categories': pageLoaders.CategoriesPage,
  '/store/inventory': pageLoaders.InventoryDashboard,
  '/store/inventory/low-stock': pageLoaders.LowStockPage,
  '/store/orders': pageLoaders.OrdersManagement,
  '/store/orders/payment-queue': pageLoaders.PaymentVerificationPage,
  '/store/packing': pageLoaders.PackingVerificationPage,
  '/store/packing/work': pageLoaders.StaffOrdersPage,
  '/store/deliveries': pageLoaders.DeliveryOrdersPage,
  '/store/staff-activity': pageLoaders.StaffActivityPage,
  '/store/staff': pageLoaders.StaffManagementPage,
  '/store/suppliers': pageLoaders.SuppliersPage,
  '/store/purchases': pageLoaders.PurchaseList,
  '/store/purchases/new': pageLoaders.PurchaseForm,
  '/store/daily-closing': pageLoaders.DailyClosingPage,
  '/store/returns': pageLoaders.ReturnsPage,
  '/store/udhar': pageLoaders.UdharPage,
  '/store/expenses': pageLoaders.ExpensesPage,
  '/store/salary': pageLoaders.SalaryPage,
  '/store/supplier-payments': pageLoaders.SupplierPaymentsPage,
  '/store/profit-loss': pageLoaders.ProfitLossPage,
  '/store/reports': pageLoaders.ReportsPage,
  '/store/sales': pageLoaders.SalesOverviewPage,
  '/store/coupons': pageLoaders.CouponsPage,
  '/store/offers': pageLoaders.OffersPage,
  '/store/settings': pageLoaders.SettingsPage,
  '/store/notifications': pageLoaders.NotificationsPage,
  '/store/backup': pageLoaders.BackupPage,
  '/store/audit-logs': pageLoaders.AuditLogsStorePage,
  '/staff/dashboard': pageLoaders.StaffDashboard,
  '/staff/pos': pageLoaders.POSPage,
  '/staff/packing': pageLoaders.StaffOrdersPage,
  '/staff/deliveries': pageLoaders.DeliveryOrdersPage,
  '/super-admin/dashboard': pageLoaders.SuperAdminDashboard,
  '/super-admin/stores': pageLoaders.StoresPage,
  '/super-admin/plans': pageLoaders.PlansPage,
  '/super-admin/audit-logs': pageLoaders.SAuditLogsPage,
};

function routeLoader(pathname) {
  if (routes[pathname]) return routes[pathname];
  if (/^\/s\/[^/]+(?:\/(?:search|categories))?$/.test(pathname)) return pageLoaders.StoreFront;
  if (/^\/s\/[^/]+\/p\/[^/]+$/.test(pathname)) return pageLoaders.ProductDetail;
  const customerPage = pathname.match(/^\/s\/[^/]+\/(cart|checkout|orders|account|auth)$/)?.[1];
  return ({ cart: pageLoaders.CartPage, checkout: pageLoaders.Checkout,
    orders: pageLoaders.OrderHistory, account: pageLoaders.AccountPage, auth: pageLoaders.CustomerAuth })[customerPage];
}

const loaded = new Map();
// Chunk preloading performs no writes or authenticated API reads.
export function prefetchRoute(pathname) {
  const load = routeLoader(pathname);
  if (!load || !backgroundAllowed()) return;
  if (!loaded.has(load)) loaded.set(load, load().catch(() => { loaded.delete(load); }));
  return loaded.get(load);
}
