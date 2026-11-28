import { useEffect } from 'react';
import { useSelector, useStore } from 'react-redux';
import { selectSessionEpoch, selectCurrentUser } from '../features/auth/authSlice';
import { scheduleBackgroundTasks } from './backgroundTasks';
import { queriesSettled } from './queryWarmup';
import { prefetchRoute } from './routePrefetch';
import { workspaceReadPlan } from './workspaceReadPlan';

export const loadPOS = () => import('../pages/store-owner/pos/POSPage');
export const loadProducts = () => import('../pages/store-owner/products/ProductList');
export const loadOwnerOrders = () => import('../pages/store-owner/orders/OrdersManagement');
export const loadStaffOrders = () => import('../pages/staff/OperationalOrdersPage');

export function useWorkspaceWarmup() {
  const store = useStore();
  const epoch = useSelector(selectSessionEpoch);
  const user = useSelector(selectCurrentUser);
  const authenticated = useSelector((state) => Boolean(state.auth.accessToken));
  const restoring = useSelector((state) => state.savedData.restoring);
  const workspace = useSelector((state) => state.auth.store);

  useEffect(() => {
    if (!authenticated || restoring || !['store_owner', 'staff', 'packer', 'delivery'].includes(user?.role)) return;
    let disposed = false;
    const active = () => !disposed && selectSessionEpoch(store.getState()) === epoch;
    // Warm a few common screen chunks, not every report and business dataset.
    // Hover/focus prefetch still downloads the exact destination's data.
    const tasks = workspaceReadPlan(user, workspace).slice(0, 3)
      .map(({ path }) => () => active() && prefetchRoute(path));
    const cancel = scheduleBackgroundTasks(tasks, {
      isCurrent: active, isReady: () => queriesSettled(store), delay: 100,
    });
    return () => { disposed = true; cancel(); };
  }, [epoch, store, user, authenticated, restoring, workspace]);
}
