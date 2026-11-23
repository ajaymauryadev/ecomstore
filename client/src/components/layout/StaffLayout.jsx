import { ClipboardList, LayoutDashboard, Package, ShoppingCart, Truck } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { ROUTES } from '../../constants/routes';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import WorkspaceFrame from './WorkspaceFrame';
import NotificationBell from './NotificationBell';
import { OWNER_NAV_SECTIONS } from './StoreOwnerLayout';

export const STAFF_NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, to: ROUTES.STAFF.DASHBOARD, permission: PERMISSIONS.DASHBOARD_VIEW },
  { label: 'Orders', icon: ClipboardList, to: ROUTES.STAFF.ORDERS, permission: PERMISSIONS.ORDERS_VIEW },
  { label: 'POS', icon: ShoppingCart, to: ROUTES.STAFF.POS, permission: PERMISSIONS.POS_ACCESS },
  { label: 'Packing', icon: Package, to: ROUTES.STAFF.PACKING, permission: PERMISSIONS.PACKING_VIEW },
  { label: 'Deliveries', icon: Truck, to: ROUTES.STAFF.DELIVERIES, permission: PERMISSIONS.DELIVERY_VIEW },
];

export default function StaffLayout() {
  const { user, store, logout, isLoggingOut } = useAuth();
  const items = STAFF_NAV.filter((item) => hasPermission(user, item.permission));
  const staffRoutes = new Map([
    [ROUTES.STORE.DASHBOARD, ROUTES.STAFF.DASHBOARD], [ROUTES.STORE.POS, ROUTES.STAFF.POS],
    [ROUTES.STORE.ORDERS, ROUTES.STAFF.ORDERS], [ROUTES.STORE.PACKING_WORK, ROUTES.STAFF.PACKING],
    [ROUTES.STORE.DELIVERIES, ROUTES.STAFF.DELIVERIES],
  ]);
  const sections = OWNER_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasPermission(user, item.permission)).map((item) => ({
      ...item, to: staffRoutes.get(item.to) || item.to,
      ...(item.to === ROUTES.STORE.PACKING_WORK && { label: 'Packing' }),
    })),
  })).filter((section) => section.items.length);

  return (
    <WorkspaceFrame sections={sections} accordionNavigation staffTabs mobileItems={items}
      user={user} store={store} logout={logout} isLoggingOut={isLoggingOut}
      notifications={<NotificationBell />} />
  );
}
