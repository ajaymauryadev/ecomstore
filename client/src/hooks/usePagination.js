import { useEffect, useRef, useState } from 'react';

export function pageCapacity({ width, height, top = 320, mode = 'rows', gridColumns }) {
  const available = Math.max(120, height - Math.max(0, top) - 88);
  const cards = ['cards', 'products', 'storefront'].includes(mode);
  const columns = gridColumns || (mode === 'storefront' ? (width < 640 ? 2 : width < 768 ? 3 : 4) : cards ? Math.max(1, Math.min(mode === 'products' ? 4 : 3, Math.floor((width + 16) / (mode === 'products' ? 270 : 300)))) : 1);
  const rowHeight = cards ? (mode === 'products' ? 420 : mode === 'storefront' ? 360 : 260) : width < 640 ? 190 : mode === 'compact' ? 56 : 90;
  return Math.max(columns, Math.min(50, Math.floor(available / rowHeight) * columns));
}

// Measure the actual list when a ref is attached; otherwise use the workspace width.
export function usePageSize(mode = 'rows') {
  const contentRef = useRef(null);
  const [size, setSize] = useState(() => pageCapacity({ width: typeof window === 'undefined' ? 1000 : Math.max(320, window.innerWidth - (window.innerWidth >= 1024 ? 304 : 32)), height: typeof window === 'undefined' ? 800 : window.innerHeight, mode }));
  useEffect(() => {
    const measure = () => {
      const element = contentRef.current;
      const main = element || document.querySelector('main');
      const rect = main?.getBoundingClientRect();
      // Scroll position must not alter capacity when a resize happens mid-page.
      const top = element ? Math.min(450, Math.max(120, rect.top + window.scrollY)) : 320;
      const template = element ? window.getComputedStyle(element).gridTemplateColumns : '';
      const gridColumns = template && template !== 'none' ? template.split(' ').filter(Boolean).length : undefined;
      setSize(pageCapacity({ width: rect?.width || window.innerWidth - 32, height: window.innerHeight, top, mode, gridColumns }));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const main = document.querySelector('main');
    if (main) observer?.observe(main);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [mode]);
  return { limit: size, contentRef };
}

export function usePageState(limit) {
  const [state, setState] = useState({ page: 1, limit });
  const page = state.limit === limit ? state.page : 1;
  const setPage = (value) => setState((previous) => ({ limit, page: Math.max(1, typeof value === 'function' ? value(previous.limit === limit ? previous.page : 1) : value) }));
  return [page, setPage];
}

export function usePagination(scope = '', mode = 'rows') {
  const { limit, contentRef } = usePageSize(mode);
  const [state, setState] = useState({ scope, limit, page: 1 });
  const page = state.scope === scope && state.limit === limit ? state.page : 1;
  const setPage = (value) => setState({ scope, limit, page: Math.max(1, typeof value === 'function' ? value(page) : value) });
  return { page, limit, setPage, contentRef };
}

export function useClientPagination(items, scope = '', mode = 'rows') {
  const paging = usePagination(scope, mode);
  const totalPages = Math.ceil(items.length / paging.limit);
  const page = Math.max(1, Math.min(paging.page, totalPages || 1));
  return { ...paging, page, items: items.slice((page - 1) * paging.limit, page * paging.limit), meta: { total: items.length, totalPages, page, limit: paging.limit } };
}
