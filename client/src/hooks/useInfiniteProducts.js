import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useSelector, useStore } from 'react-redux';
import { productApi } from '../features/products/productApi';
import { useSavedViewState } from '../offline/useSavedViewState';

// Network batches are an implementation detail; shoppers see one continuous list.
export const CATALOG_BATCH_SIZE = 20;

export function useInfiniteProducts(slug, filters) {
  const store = useStore();
  const scope = JSON.stringify([slug, filters]);
  const [saved, setSaved] = useSavedViewState('continuous-catalog', { scope, pages: 1, scroll: 0 });
  const view = saved.scope === scope ? saved : { scope, pages: 1, scroll: 0 };
  const pages = Math.max(1, view.pages);
  const sentinel = useRef(null);
  const advancing = useRef(false);
  const offline = useSelector((state) => state.savedData.offline);
  const args = useMemo(() => Array.from({ length: pages }, (_, i) => ({ slug, ...JSON.parse(scope)[1], page: i + 1, limit: CATALOG_BATCH_SIZE })), [scope, slug, pages]);
  const selectPages = useMemo(() => createSelector(args.map((arg) => productApi.endpoints.getPublicProducts.select(arg)), (...results) => results), [args]);
  const results = useSelector(selectPages);
  const data = results.map((result) => {
    const status = result.error?.status;
    return typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status) ? undefined : result.data;
  });
  const products = useMemo(() => {
    const unique = new Map();
    for (const result of results) {
      const status = result.error?.status;
      if (typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status)) continue;
      for (const product of result.data?.data ?? []) if (!unique.has(product._id)) unique.set(product._id, product);
    }
    return [...unique.values()];
  }, [results]);
  const missing = results.findIndex((result, i) => !data[i] && result.isError);
  // Background reconciliation of an already visible batch stays silent and
  // never holds up scrolling into the next batch.
  const fetching = results.some((result, i) => !data[i] && (result.status === 'pending' || result.isUninitialized));
  const meta = data[0]?.meta;
  const totalPages = meta?.totalPages;
  const hasMore = Boolean(data[pages - 1] && pages < totalPages);

  useEffect(() => {
    if (saved.scope !== scope) setSaved({ scope, pages: 1, scroll: 0 });
  }, [scope, saved.scope, setSaved]);
  useEffect(() => {
    const subscriptions = args.map((arg) => store.dispatch(productApi.endpoints.getPublicProducts.initiate(arg)));
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [args, store]);
  useEffect(() => {
    if (totalPages !== undefined && pages > Math.max(1, totalPages)) setSaved((previous) => ({ ...previous, pages: Math.max(1, totalPages) }));
  }, [totalPages, pages, setSaved]);
  useEffect(() => { advancing.current = false; }, [pages, scope]);

  const loadMore = useCallback(() => {
    if (advancing.current || fetching || missing !== -1 || !hasMore) return;
    if (offline || navigator.onLine === false) {
      const next = productApi.endpoints.getPublicProducts.select({ ...args[0], page: pages + 1 })(store.getState());
      if (!next.data) return;
    }
    advancing.current = true;
    setSaved((previous) => ({ scope, scroll: previous.scope === scope ? previous.scroll : 0, pages: pages + 1 }));
  }, [args, fetching, hasMore, missing, offline, pages, scope, setSaved, store]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || fetching || missing !== -1 || !globalThis.IntersectionObserver) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: node.closest('.customer-scroll'), rootMargin: '0px 0px 300px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, fetching, missing, loadMore]);

  // Restore the complete downloaded list and its scroll position before paint.
  useLayoutEffect(() => {
    const root = sentinel.current?.closest('.customer-scroll');
    if (!root) return;
    root.scrollTo({ top: view.scroll || 0, behavior: 'instant' });
    let timer;
    let position = view.scroll || 0;
    const savePosition = () => setSaved((previous) => previous.scope === scope ? { ...previous, scroll: position } : previous);
    const remember = () => {
      clearTimeout(timer);
      position = root.scrollTop;
      timer = setTimeout(savePosition, 150);
    };
    root.addEventListener('scroll', remember, { passive: true });
    return () => { clearTimeout(timer); root.removeEventListener('scroll', remember); if (position !== (view.scroll || 0)) savePosition(); };
    // Restore once per catalog view, never while appending products.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const retry = () => {
    for (const [i, result] of results.entries()) if (result.isError) {
      void store.dispatch(productApi.endpoints.getPublicProducts.initiate(args[i], { subscribe: false, forceRefetch: true }));
    }
  };
  return { products, meta, sentinel, loadMore, hasMore, offline: offline || navigator.onLine === false,
    fetching, initialLoading: !products.length && fetching, error: missing === -1 ? null : results[missing].error, retry };
}
