import { useEffect } from 'react';
import { useSelector, useStore } from 'react-redux';
import { hasPermission, PERMISSIONS } from '../constants/permissions';
import { selectSessionEpoch } from '../features/auth/authSlice';
import { POS_CATALOG_PARAMS } from '../features/pos/catalog';
import { PAGE_SIZE } from '../constants/pagination';

export const loadPOS = () => import('../pages/store-owner/pos/POSPage');
export const loadProducts = () => import('../pages/store-owner/products/ProductList');
export const loadOwnerOrders = () => import('../pages/store-owner/orders/OrdersManagement');
export const loadStaffOrders = () => import('../pages/staff/OperationalOrdersPage');

export function useWorkspaceWarmup() {
  const store = useStore();
  const epoch = useSelector(selectSessionEpoch);

  useEffect(() => {
    const { user, accessToken } = store.getState().auth;
    const connection = navigator.connection;
    if (!accessToken || !['store_owner', 'staff', 'packer'].includes(user?.role) ||
        connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) return;
    let disposed = false;
    const active = () => !disposed && selectSessionEpoch(store.getState()) === epoch;

    const warm = () => {
      if (!active() || document.visibilityState === 'hidden') return;
      const owner = user.role === 'store_owner';
      const slug = store.getState().auth.store?.slug;
      if (hasPermission(user, PERMISSIONS.POS_ACCESS)) {
        void loadPOS().catch(() => {});
        void import('../features/products/productApi').then(({ productApi }) => {
          if (active()) store.dispatch(productApi.util.prefetch('getProducts', POS_CATALOG_PARAMS, { ifOlderThan: 30 }));
        }).catch(() => {});
      }
      if (hasPermission(user, PERMISSIONS.PRODUCTS_VIEW)) {
        void loadProducts().catch(() => {});
        void import('../features/products/productApi').then(({ productApi }) => {
          if (active()) store.dispatch(productApi.util.prefetch('getProducts', { page: 1, limit: PAGE_SIZE }, { ifOlderThan: 30 }));
        }).catch(() => {});
      }
      if (slug && hasPermission(user, PERMISSIONS.ORDERS_VIEW)) {
        void (owner ? loadOwnerOrders() : loadStaffOrders()).catch(() => {});
        void import('../features/orders/orderApi').then(({ orderApi }) => {
          if (active()) store.dispatch(orderApi.util.prefetch('getAdminOrders', {
            slug, ...(owner && { status: '' }), page: 1, limit: PAGE_SIZE,
          }, { ifOlderThan: 30 }));
        }).catch(() => {});
      }
    };
    const idle = typeof window.requestIdleCallback === 'function';
    const scheduled = idle ? window.requestIdleCallback(warm, { timeout: 2000 }) : window.setTimeout(warm, 350);
    return () => {
      disposed = true;
      if (idle) window.cancelIdleCallback(scheduled);
      else window.clearTimeout(scheduled);
    };
  }, [epoch, store]);
}
