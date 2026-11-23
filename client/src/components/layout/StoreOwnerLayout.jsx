import {
  LayoutDashboard, ShoppingCart, Package, ClipboardList, Warehouse, Users,
  BarChart2, Settings, Truck, UserCheck, CreditCard, ShoppingBag, PackageCheck,
  Activity, CalendarDays, ArrowLeftRight, BookOpen, Receipt, TrendingUp, Wallet,
  Tag, Gift, Bell, HardDrive, ScrollText,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useGetPaymentQueueQuery } from '../../features/orders/orderApi';
import { useGetPackingQueueQuery } from '../../features/packing/packingApi';
import { ROUTES, dashboardRouteForRole } from '../../constants/routes';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import NotificationBell from './NotificationBell';
import WorkspaceFrame from './WorkspaceFrame';

export const OWNER_NAV_SECTIONS = [
  { label: 'Overview', icon: LayoutDashboard, items: [
    { label: 'Dashboard', icon: LayoutDashboard, to: ROUTES.STORE.DASHBOARD, permission: PERMISSIONS.DASHBOARD_VIEW },
  ] },
  { label: 'Sales', icon: ShoppingBag, items: [
    { label: 'POS', icon: ShoppingCart, to: ROUTES.STORE.POS, permission: PERMISSIONS.POS_ACCESS },
    { label: 'Sales & Collections', icon: TrendingUp, to: ROUTES.STORE.SALES, permission: PERMISSIONS.REPORTS_SENSITIVE },
    { label: 'Udhar Accounts', icon: BookOpen, to: ROUTES.STORE.UDHAR, permission: PERMISSIONS.ACCOUNTING_VIEW },
    { label: 'Orders', icon: ShoppingBag, to: ROUTES.STORE.ORDERS, end: true, permission: PERMISSIONS.ORDERS_VIEW },
    { label: 'Payments', icon: CreditCard, to: ROUTES.STORE.PAYMENT_QUEUE, badgeKey: 'paymentQueue', permission: PERMISSIONS.ORDERS_PAYMENT_VERIFY },
    { label: 'Pack Orders', icon: Package, to: ROUTES.STORE.PACKING_WORK, permission: PERMISSIONS.PACKING_VIEW },
    { label: 'Packing Verification', icon: PackageCheck, to: ROUTES.STORE.PACKING_QUEUE, end: true, badgeKey: 'packingQueue', permission: PERMISSIONS.PACKING_VERIFY },
    { label: 'Deliveries', icon: Truck, to: ROUTES.STORE.DELIVERIES, permission: PERMISSIONS.DELIVERY_VIEW },
    { label: 'Returns', icon: ArrowLeftRight, to: ROUTES.STORE.RETURNS, permission: PERMISSIONS.RETURNS_VIEW },
  ] },
  { label: 'Catalog', icon: Package, items: [
    { label: 'Products', icon: Package, to: ROUTES.STORE.PRODUCTS, permission: PERMISSIONS.PRODUCTS_VIEW },
    { label: 'Categories', icon: ClipboardList, to: ROUTES.STORE.CATEGORIES, permission: PERMISSIONS.CATEGORIES_VIEW },
    { label: 'Inventory', icon: Warehouse, to: ROUTES.STORE.INVENTORY, permission: PERMISSIONS.INVENTORY_VIEW },
  ] },
  { label: 'Purchasing', icon: Truck, items: [
    { label: 'Purchases', icon: Truck, to: ROUTES.STORE.PURCHASES, permission: PERMISSIONS.PURCHASES_VIEW },
    { label: 'Suppliers', icon: UserCheck, to: ROUTES.STORE.SUPPLIERS, permission: PERMISSIONS.SUPPLIERS_VIEW },
  ] },
  { label: 'Accounting', icon: BookOpen, items: [
    { label: 'Day Close', icon: CalendarDays, to: ROUTES.STORE.DAILY_CLOSING, permission: PERMISSIONS.ACCOUNTING_VIEW },
    { label: 'Expenses', icon: Receipt, to: ROUTES.STORE.EXPENSES, permission: PERMISSIONS.ACCOUNTING_VIEW },
    { label: 'Salary', icon: Wallet, to: ROUTES.STORE.SALARY, permission: PERMISSIONS.SALARY_VIEW },
    { label: 'Supplier Dues', icon: Truck, to: ROUTES.STORE.SUPPLIER_PAYMENTS, permission: PERMISSIONS.ACCOUNTING_VIEW },
  ] },
  { label: 'Insights', icon: BarChart2, items: [
    { label: 'Profit & Loss', icon: TrendingUp, to: ROUTES.STORE.PROFIT_LOSS, permission: PERMISSIONS.REPORTS_SENSITIVE },
    { label: 'Reports', icon: BarChart2, to: ROUTES.STORE.REPORTS, permission: PERMISSIONS.REPORTS_SENSITIVE },
  ] },
  { label: 'Team', icon: Users, items: [
    { label: 'Staff', icon: Users, to: ROUTES.STORE.STAFF, permission: PERMISSIONS.STAFF_MANAGE },
    { label: 'Staff Activity', icon: Activity, to: ROUTES.STORE.STAFF_ACTIVITY, permission: PERMISSIONS.PACKING_REPORTS },
  ] },
  { label: 'Marketing', icon: Tag, items: [
    { label: 'Coupons', icon: Tag, to: ROUTES.STORE.COUPONS, permission: PERMISSIONS.COUPONS_VIEW },
    { label: 'Offers', icon: Gift, to: ROUTES.STORE.OFFERS, permission: PERMISSIONS.OFFERS_VIEW },
  ] },
  { label: 'Administration', icon: Settings, items: [
    { label: 'Settings', icon: Settings, to: ROUTES.STORE.SETTINGS, permission: PERMISSIONS.SETTINGS_VIEW },
    { label: 'Notifications', icon: Bell, to: ROUTES.STORE.NOTIFICATIONS, permission: PERMISSIONS.NOTIFICATIONS_VIEW },
    { label: 'Backup', icon: HardDrive, to: ROUTES.STORE.BACKUP, permission: PERMISSIONS.BACKUP_EXPORT },
    { label: 'Audit Logs', icon: ScrollText, to: ROUTES.STORE.AUDIT_LOGS, permission: PERMISSIONS.AUDIT_LOGS_VIEW },
  ] },
];

export default function StoreOwnerLayout() {
  const { user, store, logout, isLoggingOut } = useAuth();
  const visibleSections = OWNER_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasPermission(user, item.permission)).map((item) =>
      item.to === ROUTES.STORE.DASHBOARD ? { ...item, to: dashboardRouteForRole(user.role) } : item),
  })).filter((section) => section.items.length > 0);

  const mobileRoutes = [ROUTES.STORE.POS, ROUTES.STORE.DASHBOARD, ROUTES.STORE.UDHAR, ROUTES.STORE.PRODUCTS];
  const visibleItems = visibleSections.flatMap(({ items }) => items);
  const mobileItems = mobileRoutes.map((to) => visibleItems.find((item) => item.to === to)).filter(Boolean);

  const { data: payments } = useGetPaymentQueueQuery(
    { slug: store?.slug, limit: 1 },
    { skip: !store?.slug || !hasPermission(user, PERMISSIONS.ORDERS_PAYMENT_VERIFY), pollingInterval: 30000, skipPollingIfUnfocused: true }
  );
  const { data: packing } = useGetPackingQueueQuery(
    { limit: 1 },
    { skip: !hasPermission(user, PERMISSIONS.PACKING_VERIFY), pollingInterval: 30000, skipPollingIfUnfocused: true }
  );
  return (
    <WorkspaceFrame
      sections={visibleSections} accordionNavigation mobileItems={mobileItems} user={user} store={store} logout={logout} isLoggingOut={isLoggingOut}
      badges={{ paymentQueue: payments?.meta?.total ?? 0, packingQueue: packing?.meta?.total ?? 0 }}
      notifications={hasPermission(user, PERMISSIONS.NOTIFICATIONS_VIEW) && <NotificationBell />}
    />
  );
}
