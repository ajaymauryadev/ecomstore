import { useRef, useState } from 'react';
import { PAGE_SIZE } from '../constants/pagination';

// Every list uses the same page size, regardless of layout or viewport.
export function usePageSize() {
  const contentRef = useRef(null);
  return { limit: PAGE_SIZE, contentRef };
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
