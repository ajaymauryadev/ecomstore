import { useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { prefetchRoute } from '../app/routePrefetch';
import { backgroundAllowed } from '../app/backgroundTasks';
import { prefetchQuery } from '../app/queryWarmup';
import { workspaceReadPlan } from '../app/workspaceReadPlan';

export function useNavigationPrefetch() {
  const store = useStore();
  const timer = useRef();
  const cancel = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const anchor = (event) => event.target.closest?.('a[href]');
  const prepare = (url) => {
    if (!backgroundAllowed()) return;
    void prefetchRoute(url.pathname);
    const product = url.pathname.match(/^\/s\/([^/]+)\/p\/([^/]+)$/);
    if (product) void prefetchQuery(store, 'getPublicProduct', { slug: product[1], productId: product[2] });
    const { auth } = store.getState();
    if (!auth.accessToken || !['store_owner', 'staff', 'packer', 'delivery'].includes(auth.user?.role)) return;
    const target = workspaceReadPlan(auth.user, auth.store).find(({ path }) => path === url.pathname);
    for (const [endpoint, args] of target?.queries ?? []) void prefetchQuery(store, endpoint, args);
  };
  const schedule = (event) => {
    const link = anchor(event);
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    cancel();
    timer.current = window.setTimeout(() => prepare(url), 75);
  };
  return {
    onPointerOver: schedule, onFocusCapture: schedule,
    onPointerDownCapture: (event) => {
      const link = anchor(event);
      if (!link) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin) { cancel(); prepare(url); }
    },
    onPointerOut: (event) => {
      if (!(event.relatedTarget instanceof Node) || !anchor(event)?.contains(event.relatedTarget)) cancel();
    },
    onBlurCapture: cancel,
  };
}
