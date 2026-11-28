import { lazy } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { selectCurrentUser } from './features/auth/authSlice';
import AuthInit from './components/shared/AuthInit';
import ProtectedRoute from './components/shared/ProtectedRoute';
import UnauthorizedPage from './components/shared/UnauthorizedPage';
import ErrorBoundary from './components/shared/ErrorBoundary';
import SocketProvider from './components/shared/SocketProvider';
import LiveUpdates from './components/shared/LiveUpdates';
import SavedDataStatus from './offline/SavedDataStatus';
import StableRoutes from './components/layout/StableRoutes';
import { ROLES } from './constants/roles';
import { PERMISSIONS, hasAnyPermission } from './constants/permissions';
import { dashboardRouteForRole, ROUTES } from './constants/routes';
import { pageLoaders } from './app/routePrefetch';
import { loadPOS, loadProducts, loadOwnerOrders, loadStaffOrders, useWorkspaceWarmup } from './app/workspaceWarmup';

const SuperAdminLayout = lazy(pageLoaders.SuperAdminLayout);
const StoreOwnerLayout = lazy(pageLoaders.StoreOwnerLayout);
const StaffLayout = lazy(pageLoaders.StaffLayout);
const CustomerLayout = lazy(pageLoaders.CustomerLayout);
const Login = lazy(pageLoaders.Login);
const Register = lazy(pageLoaders.Register);
const StoreOwnerDashboard = lazy(pageLoaders.StoreOwnerDashboard);
const StaffDashboard = lazy(pageLoaders.StaffDashboard);
const OperationalOrdersPage = lazy(loadStaffOrders);
const StaffOrdersPage = lazy(pageLoaders.StaffOrdersPage);
const StaffPackingPage = lazy(pageLoaders.StaffPackingPage);
const DeliveryOrdersPage = lazy(pageLoaders.DeliveryOrdersPage);
const StoreFront = lazy(pageLoaders.StoreFront);
const ProductDetail = lazy(pageLoaders.ProductDetail);
const CartPage = lazy(pageLoaders.CartPage);
const Checkout = lazy(pageLoaders.Checkout);
const OrderTracking = lazy(pageLoaders.OrderTracking);
const OrderHistory = lazy(pageLoaders.OrderHistory);
const AccountPage = lazy(pageLoaders.AccountPage);
const CustomerAuth = lazy(pageLoaders.CustomerAuth);
const NotFound = lazy(pageLoaders.NotFound);
const ProductList = lazy(loadProducts);
const ProductForm = lazy(pageLoaders.ProductForm);
const CategoriesPage = lazy(pageLoaders.CategoriesPage);
const SuppliersPage = lazy(pageLoaders.SuppliersPage);
const PurchaseList = lazy(pageLoaders.PurchaseList);
const PurchaseForm = lazy(pageLoaders.PurchaseForm);
const InventoryDashboard = lazy(pageLoaders.InventoryDashboard);
const LowStockPage = lazy(pageLoaders.LowStockPage);
const StockLedgerPage = lazy(pageLoaders.StockLedgerPage);
const OrdersManagement = lazy(loadOwnerOrders);
const PaymentVerificationPage = lazy(pageLoaders.PaymentVerificationPage);
const PackingVerificationPage = lazy(pageLoaders.PackingVerificationPage);
const StaffActivityPage = lazy(pageLoaders.StaffActivityPage);
const POSPage = lazy(loadPOS);
const DailyClosingPage = lazy(pageLoaders.DailyClosingPage);
const ReturnsPage = lazy(pageLoaders.ReturnsPage);
const UdharPage = lazy(pageLoaders.UdharPage);
const ExpensesPage = lazy(pageLoaders.ExpensesPage);
const SalaryPage = lazy(pageLoaders.SalaryPage);
const SupplierPaymentsPage = lazy(pageLoaders.SupplierPaymentsPage);
const ProfitLossPage = lazy(pageLoaders.ProfitLossPage);
const ReportsPage = lazy(pageLoaders.ReportsPage);
const SalesOverviewPage = lazy(pageLoaders.SalesOverviewPage);
const CouponsPage = lazy(pageLoaders.CouponsPage);
const OffersPage = lazy(pageLoaders.OffersPage);
const SettingsPage = lazy(pageLoaders.SettingsPage);
const NotificationsPage = lazy(pageLoaders.NotificationsPage);
const BackupPage = lazy(pageLoaders.BackupPage);
const AuditLogsStorePage = lazy(pageLoaders.AuditLogsStorePage);
const StaffManagementPage = lazy(pageLoaders.StaffManagementPage);
const SuperAdminDashboard = lazy(pageLoaders.SuperAdminDashboard);
const StoresPage = lazy(pageLoaders.StoresPage);
const TenantDetailPage = lazy(pageLoaders.TenantDetailPage);
const PlansPage = lazy(pageLoaders.PlansPage);
const SAuditLogsPage = lazy(pageLoaders.SAuditLogsPage);

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
        <SavedDataStatus />
        <StableRoutes>
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
              <Route index element={<RoleRedirect />} />
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

            <Route path={ROUTES.UNAUTHORIZED} element={<UnauthorizedPage />} />
            <Route path="*" element={<NotFound />} />
        </StableRoutes>

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
