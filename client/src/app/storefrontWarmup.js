import { useEffect } from 'react';
import { useStore } from 'react-redux';
import { scheduleBackgroundTasks } from './backgroundTasks';
import { prefetchQuery, queriesSettled } from './queryWarmup';
import { prefetchRoute } from './routePrefetch';
import { CATALOG_BATCH_SIZE } from '../hooks/useInfiniteProducts';
import { selectSessionEpoch } from '../features/auth/authSlice';

export function useStorefrontWarmup(slug, ready) {
  const store = useStore();
  useEffect(() => {
    if (!slug || !ready) return;
    const epoch = selectSessionEpoch(store.getState());
    const tasks = [
      () => prefetchQuery(store, 'getPublicCategories', slug),
      () => prefetchQuery(store, 'getPublicProducts', { slug, page: 1, limit: CATALOG_BATCH_SIZE }),
      ...['', '/categories', '/cart', '/account', '/auth', '/checkout', '/orders']
        .map((suffix) => () => prefetchRoute(`/s/${slug}${suffix}`)),
    ];
    return scheduleBackgroundTasks(tasks, {
      isCurrent: () => selectSessionEpoch(store.getState()) === epoch,
      isReady: () => queriesSettled(store), delay: 100,
    });
  }, [slug, ready, store]);
}
