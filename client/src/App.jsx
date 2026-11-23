import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { selectCurrentUser } from './features/auth/authSlice';
import AuthInit from './components/shared/AuthInit';
import ProtectedRoute from './components/shared/ProtectedRoute';
import ErrorBoundary from './components/shared/ErrorBoundary';
import SocketProvider from './components/shared/SocketProvider';
import LiveUpdates from './components/shared/LiveUpdates';
import { PageLoader } from './components/ui/Spinner';
import { ROLES } from './constants/roles';
import { PERMISSIONS, hasAnyPermission } from './constants/permissions';
import { dashboardRouteForRole, ROUTES } from './constants/routes';
import { loadPOS, loadProducts, loadOwnerOrders, loadStaffOrders, useWorkspaceWarmup } from './app/workspaceWarmup';

const SuperAdminLayout = lazy(() => import('./components/layout/SuperAdminLayout'));
const StoreOwnerLayout = lazy(() => import('./components/layout/StoreOwnerLayout'));
const StaffLayout = lazy(() => import('./components/layout/StaffLayout'));
const CustomerLayout = lazy(() => import('./components/layout/CustomerLayout'));
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const StoreOwnerDashboard = lazy(() => import('./pages/store-owner/Dashboard'));
const StaffDashboard = lazy(() => import('./pages/staff/Dashboard'));
const OperationalOrdersPage = lazy(loadStaffOrders);
const StaffOrdersPage = lazy(() => import('./pages/staff/StaffOrdersPage'));
const StaffPackingPage = lazy(() => import('./pages/staff/StaffPackingPage'));
const DeliveryOrdersPage = lazy(() => import('./pages/delivery/DeliveryOrdersPage'));
const StoreFront = lazy(() => import('./pages/customer/StoreFront'));
const ProductDetail = lazy(() => import('./pages/customer/ProductDetail'));
const CartPage = lazy(() => import('./pages/customer/CartPage'));
const Checkout = lazy(() => import('./pages/customer/Checkout'));
const OrderTracking = lazy(() => import('./pages/customer/OrderTracking'));
const OrderHistory = lazy(() => import('./pages/customer/OrderHistory'));
const AccountPage = lazy(() => import('./pages/customer/AccountPage'));
const CustomerAuth = lazy(() => import('./pages/customer/CustomerAuth'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ProductList = lazy(loadProducts);
const ProductForm = lazy(() => import('./pages/store-owner/products/ProductForm'));
const CategoriesPage = lazy(() => import('./pages/store-owner/categories/CategoriesPage'));
const SuppliersPage = lazy(() => import('./pages/store-owner/suppliers/SuppliersPage'));
const PurchaseList = lazy(() => import('./pages/store-owner/purchases/PurchaseList'));
const PurchaseForm = lazy(() => import('./pages/store-owner/purchases/PurchaseForm'));
const InventoryDashboard = lazy(() => import('./pages/store-owner/inventory/InventoryDashboard'));
const LowStockPage = lazy(() => import('./pages/store-owner/inventory/LowStockPage'));
const StockLedgerPage = lazy(() => import('./pages/store-owner/inventory/StockLedgerPage'));
const OrdersManagement = lazy(loadOwnerOrders);
const PaymentVerificationPage = lazy(() => import('./pages/store-owner/orders/PaymentVerificationPage'));
const PackingVerificationPage = lazy(() => import('./pages/store-owner/orders/PackingVerificationPage'));
const StaffActivityPage = lazy(() => import('./pages/store-owner/orders/StaffActivityPage'));
const POSPage = lazy(loadPOS);
const DailyClosingPage = lazy(() => import('./pages/store-owner/daily-closing/DailyClosingPage'));
const ReturnsPage = lazy(() => import('./pages/store-owner/returns/ReturnsPage'));
const UdharPage = lazy(() => import('./pages/store-owner/accounting/UdharPage'));
const ExpensesPage = lazy(() => import('./pages/store-owner/accounting/ExpensesPage'));
const SalaryPage = lazy(() => import('./pages/store-owner/accounting/SalaryPage'));
const SupplierPaymentsPage = lazy(() => import('./pages/store-owner/accounting/SupplierPaymentsPage'));
const ProfitLossPage = lazy(() => import('./pages/store-owner/accounting/ProfitLossPage'));
const ReportsPage = lazy(() => import('./pages/store-owner/reports/ReportsPage'));
const SalesOverviewPage = lazy(() => import('./pages/store-owner/reports/SalesOverviewPage'));
const CouponsPage = lazy(() => import('./pages/store-owner/coupons/CouponsPage'));
const OffersPage = lazy(() => import('./pages/store-owner/offers/OffersPage'));
const SettingsPage = lazy(() => import('./pages/store-owner/settings/SettingsPage'));
const NotificationsPage = lazy(() => import('./pages/store-owner/notifications/NotificationsPage'));
const BackupPage = lazy(() => import('./pages/store-owner/backup/BackupPage'));
const AuditLogsStorePage = lazy(() => import('./pages/store-owner/audit/AuditLogsPage'));
const StaffManagementPage = lazy(() => import('./pages/store-owner/staff/StaffManagementPage'));
const SuperAdminDashboard = lazy(() => import('./pages/super-admin/Dashboard'));
const StoresPage = lazy(() => import('./pages/super-admin/StoresPage'));
const TenantDetailPage = lazy(() => import('./pages/super-admin/TenantDetailPage'));
const PlansPage = lazy(() => import('./pages/super-admin/PlansPage'));
const SAuditLogsPage = lazy(() => import('./pages/super-admin/AuditLogsPage'));

function Access({ children, permission, roles }) {
  return <ProtectedRoute allowedRoles={roles} requiredPermissions={permission ? [permission] : undefined}>{children}</ProtectedRoute>;
}

function RoleRedirect() {
  const user = useSelector(selectCurrentUser);
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  return <Navigate to={dashboardRouteForRole(user.role)} replace />;
}

function StaffOrderAccess() {
  const user = useSelector(selectCurrentUser);
  return hasAnyPermission(user, [
    PERMISSIONS.ORDERS_STATUS_UPDATE, PERMISSIONS.ORDERS_ASSIGN, PERMISSIONS.ORDERS_CANCEL,
    PERMISSIONS.ORDERS_REJECT, PERMISSIONS.ORDERS_PARTIAL_FULFILL, PERMISSIONS.ORDERS_PAYMENT_VERIFY,
  ]) ? <OrdersManagement /> : <OperationalOrdersPage />;
}

const storeRoles = [ROLES.STORE_OWNER, ROLES.STAFF, ROLES.PACKER, ROLES.DELIVERY];
const staffRoles = [ROLES.STAFF, ROLES.PACKER, ROLES.DELIVERY];

export default function App() {
  useWorkspaceWarmup();
  return (
    <ErrorBoundary>
      <AuthInit>
        <SocketProvider>
        <LiveUpdates />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path={ROUTES.LOGIN} element={<Login />} />
            <Route path={ROUTES.REGISTER} element={<Register />} />
            <Route path="/" element={<RoleRedirect />} />

            <Route path="/super-admin" element={<Access roles={[ROLES.SUPER_ADMIN]}><SuperAdminLayout /></Access>}>
              <Route path="dashboard" element={<SuperAdminDashboard />} />
              <Route path="stores" element={<StoresPage />} />
              <Route path="stores/:id" element={<TenantDetailPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="audit-logs" element={<SAuditLogsPage />} />
              <Route index element={<Navigate to="dashboard" replace />} />
            </Route>

            <Route path="/store" element={<Access roles={storeRoles}><StoreOwnerLayout /></Access>}>
              <Route path="dashboard" element={<Access roles={[ROLES.STORE_OWNER]}><StoreOwnerDashboard /></Access>} />
              <Route path="pos" element={<Access permission={PERMISSIONS.POS_ACCESS}><POSPage /></Access>} />
              <Route path="products" element={<Access permission={PERMISSIONS.PRODUCTS_VIEW}><ProductList /></Access>} />
              <Route path="products/new" element={<Access permission={PERMISSIONS.PRODUCTS_CREATE}><ProductForm /></Access>} />
              <Route path="products/:id/edit" element={<Access permission={PERMISSIONS.PRODUCTS_EDIT}><ProductForm /></Access>} />
              <Route path="categories" element={<Access permission={PERMISSIONS.CATEGORIES_VIEW}><CategoriesPage /></Access>} />
              <Route path="suppliers" element={<Access permission={PERMISSIONS.SUPPLIERS_VIEW}><SuppliersPage /></Access>} />
              <Route path="purchases" element={<Access permission={PERMISSIONS.PURCHASES_VIEW}><PurchaseList /></Access>} />
              <Route path="purchases/new" element={<Access permission={PERMISSIONS.PURCHASES_MANAGE}><PurchaseForm /></Access>} />
              <Route path="purchases/:id" element={<Access permission={PERMISSIONS.PURCHASES_VIEW}><PurchaseForm /></Access>} />
              <Route path="inventory" element={<Access permission={PERMISSIONS.INVENTORY_VIEW}><InventoryDashboard /></Access>} />
              <Route path="inventory/low-stock" element={<Access permission={PERMISSIONS.INVENTORY_VIEW}><LowStockPage /></Access>} />
              <Route path="inventory/ledger/:productId" element={<Access permission={PERMISSIONS.INVENTORY_VIEW}><StockLedgerPage /></Access>} />
              <Route path="orders" element={<Access permission={PERMISSIONS.ORDERS_VIEW}><OrdersManagement /></Access>} />
              <Route path="orders/payment-queue" element={<Access permission={PERMISSIONS.ORDERS_PAYMENT_VERIFY}><PaymentVerificationPage /></Access>} />
              <Route path="packing" element={<Access permission={PERMISSIONS.PACKING_VERIFY}><PackingVerificationPage /></Access>} />
              <Route path="packing/work" element={<Access permission={PERMISSIONS.PACKING_VIEW}><StaffOrdersPage packingPath={ROUTES.STORE.PACKING_WORK} /></Access>} />
              <Route path="packing/work/:orderId" element={<Access permission={PERMISSIONS.PACKING_VIEW}><StaffPackingPage packingPath={ROUTES.STORE.PACKING_WORK} /></Access>} />
              <Route path="deliveries" element={<Access permission={PERMISSIONS.DELIVERY_VIEW}><DeliveryOrdersPage /></Access>} />
              <Route path="staff-activity" element={<Access permission={PERMISSIONS.PACKING_REPORTS}><StaffActivityPage /></Access>} />
              <Route path="staff" element={<Access permission={PERMISSIONS.STAFF_MANAGE}><StaffManagementPage /></Access>} />
              <Route path="daily-closing" element={<Access permission={PERMISSIONS.ACCOUNTING_VIEW}><DailyClosingPage /></Access>} />
              <Route path="returns" element={<Access permission={PERMISSIONS.RETURNS_VIEW}><ReturnsPage /></Access>} />
              <Route path="udhar" element={<Access permission={PERMISSIONS.ACCOUNTING_VIEW}><UdharPage /></Access>} />
              <Route path="expenses" element={<Access permission={PERMISSIONS.ACCOUNTING_VIEW}><ExpensesPage /></Access>} />
              <Route path="salary" element={<Access permission={PERMISSIONS.SALARY_VIEW}><SalaryPage /></Access>} />
              <Route path="supplier-payments" element={<Access permission={PERMISSIONS.ACCOUNTING_VIEW}><SupplierPaymentsPage /></Access>} />
              <Route path="profit-loss" element={<Access permission={PERMISSIONS.REPORTS_SENSITIVE}><ProfitLossPage /></Access>} />
              <Route path="reports" element={<Access permission={PERMISSIONS.REPORTS_SENSITIVE}><ReportsPage /></Access>} />
              <Route path="sales" element={<Access permission={PERMISSIONS.REPORTS_SENSITIVE}><SalesOverviewPage /></Access>} />
              <Route path="coupons" element={<Access permission={PERMISSIONS.COUPONS_VIEW}><CouponsPage /></Access>} />
              <Route path="offers" element={<Access permission={PERMISSIONS.OFFERS_VIEW}><OffersPage /></Access>} />
              <Route path="settings" element={<Access permission={PERMISSIONS.SETTINGS_VIEW}><SettingsPage /></Access>} />
              <Route path="notifications" element={<Access permission={PERMISSIONS.NOTIFICATIONS_VIEW}><NotificationsPage /></Access>} />
              <Route path="backup" element={<Access permission={PERMISSIONS.BACKUP_EXPORT}><BackupPage /></Access>} />
              <Route path="audit-logs" element={<Access permission={PERMISSIONS.AUDIT_LOGS_VIEW}><AuditLogsStorePage /></Access>} />
              <Route index element={<Navigate to="dashboard" replace />} />
            </Route>

            <Route path="/staff" element={<Access roles={staffRoles}><StaffLayout /></Access>}>
              <Route path="dashboard" element={<Access permission={PERMISSIONS.DASHBOARD_VIEW}><StaffDashboard /></Access>} />
              <Route path="orders" element={<Access permission={PERMISSIONS.ORDERS_VIEW}><StaffOrderAccess /></Access>} />
              <Route path="pos" element={<Access permission={PERMISSIONS.POS_ACCESS}><POSPage /></Access>} />
              <Route path="packing" element={<Access permission={PERMISSIONS.PACKING_VIEW}><StaffOrdersPage /></Access>} />
              <Route path="packing/:orderId" element={<Access permission={PERMISSIONS.PACKING_VIEW}><StaffPackingPage /></Access>} />
              <Route path="deliveries" element={<Access permission={PERMISSIONS.DELIVERY_VIEW}><DeliveryOrdersPage /></Access>} />
              <Route index element={<Navigate to="dashboard" replace />} />
            </Route>

            <Route path="/s/:storeSlug" element={<CustomerLayout />}>
              <Route index element={<StoreFront />} />
              <Route path="p/:productId" element={<ProductDetail />} />
              <Route path="search" element={<StoreFront />} />
              <Route path="categories" element={<StoreFront showCategories />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="orders" element={<OrderHistory />} />
              <Route path="orders/:orderId" element={<OrderTracking />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="auth" element={<CustomerAuth />} />
            </Route>

            <Route path={ROUTES.UNAUTHORIZED} element={<div className="min-h-screen bg-navy-950 flex items-center justify-center p-6"><div className="text-center"><p aria-hidden="true" className="text-6xl mb-4">🚫</p><h1 className="text-xl font-bold text-slate-100">Access denied</h1><p className="text-slate-400 text-sm mt-2">You do not have permission to view this page.</p></div></div>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>

        <Toaster position="top-right" containerStyle={{ top: 'calc(4.5rem + env(safe-area-inset-top))' }} gutter={8} toastOptions={{
          duration: 3500,
          style: { background: '#fff', color: 'var(--brand-ink)', borderRadius: 'var(--brand-radius)', border: '1px solid var(--brand-line)', fontSize: '14px', padding: '12px 16px' },
          success: { iconTheme: { primary: '#12684b', secondary: '#fff' } },
          error: { iconTheme: { primary: 'var(--brand-error)', secondary: '#fff' } },
        }} />
        </SocketProvider>
      </AuthInit>
    </ErrorBoundary>
  );
}
