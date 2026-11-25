import { useEffect } from 'react';
import { useSelector, useStore } from 'react-redux';
import { selectSessionEpoch } from '../features/auth/authSlice';
import { scheduleBackgroundTasks } from '../app/backgroundTasks';
import { prefetchQuery, queriesSettled } from '../app/queryWarmup';

// Warm one adjacent page, never the entire catalog or every search result.
export function useNextPagePrefetch(endpoint, args, meta, { skip = false } = {}) {
  const store = useStore();
  const epoch = useSelector(selectSessionEpoch);
  const key = JSON.stringify(args);
  const totalPages = meta?.totalPages ?? 0;
  useEffect(() => {
    const currentArgs = JSON.parse(key);
    const nextPage = (Number(currentArgs.page) || 1) + 1;
    if (skip || nextPage > totalPages) return;
    return scheduleBackgroundTasks([() => prefetchQuery(store, endpoint, { ...currentArgs, page: nextPage })], {
      isCurrent: () => selectSessionEpoch(store.getState()) === epoch,
      isReady: () => queriesSettled(store),
    });
  }, [store, epoch, endpoint, key, totalPages, skip]);
}
