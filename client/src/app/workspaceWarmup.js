import { useEffect } from 'react';
import { useSelector, useStore } from 'react-redux';
import { hasPermission, PERMISSIONS } from '../constants/permissions';
import { selectSessionEpoch, selectCurrentUser } from '../features/auth/authSlice';
import { POS_CATALOG_PARAMS } from '../features/pos/catalog';
import { scheduleBackgroundTasks } from './backgroundTasks';
import { prefetchQuery, queriesSettled } from './queryWarmup';
import { PAGE_SIZE } from '../constants/pagination';

export const loadPOS = () => import('../pages/store-owner/pos/POSPage');
export const loadProducts = () => import('../pages/store-owner/products/ProductList');
export const loadOwnerOrders = () => import('../pages/store-owner/orders/OrdersManagement');
export const loadStaffOrders = () => import('../pages/staff/OperationalOrdersPage');

export function useWorkspaceWarmup() {
  const store = useStore();
  const epoch = useSelector(selectSessionEpoch);
  const user = useSelector(selectCurrentUser);
  const authenticated = useSelector((state) => Boolean(state.auth.accessToken));

  useEffect(() => {
    if (!authenticated || !['store_owner', 'staff', 'packer'].includes(user?.role)) return;
    let disposed = false;
    const active = () => !disposed && selectSessionEpoch(store.getState()) === epoch;
    const owner = user.role === 'store_owner';
    const slug = store.getState().auth.store?.slug;
    const tasks = [];
    if (hasPermission(user, PERMISSIONS.POS_ACCESS)) {
      tasks.push(loadPOS, async () => {
        await import('../features/products/productApi');
        if (active()) return prefetchQuery(store, 'getProducts', POS_CATALOG_PARAMS);
      });
    }
    if (hasPermission(user, PERMISSIONS.PRODUCTS_VIEW)) {
      tasks.push(loadProducts, async () => {
        await import('../features/products/productApi');
        if (active()) return prefetchQuery(store, 'getProducts', { page: 1, limit: PAGE_SIZE });
      });
    }
    if (slug && hasPermission(user, PERMISSIONS.ORDERS_VIEW)) {
      tasks.push(owner ? loadOwnerOrders : loadStaffOrders, async () => {
        await import('../features/orders/orderApi');
        if (active()) return prefetchQuery(store, 'getAdminOrders', {
          slug, ...(owner && { status: '' }), page: 1, limit: PAGE_SIZE,
        });
      });
    }
    const cancel = scheduleBackgroundTasks(tasks, {
      isCurrent: active, isReady: () => queriesSettled(store),
    });
    return () => { disposed = true; cancel(); };
  }, [epoch, store, user, authenticated]);
}
