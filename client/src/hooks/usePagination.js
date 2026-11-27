import { useEffect, useRef } from 'react';
import { useSavedViewState } from '../offline/useSavedViewState';
import { PAGE_SIZE } from '../constants/pagination';

// Every list uses the same page size, regardless of layout or viewport.
export function usePageSize() {
  const contentRef = useRef(null);
  return { limit: PAGE_SIZE, contentRef };
}

export function usePageState(limit, name = 'page') {
  const [state, setState] = useSavedViewState(name, { page: 1, limit });
  const page = state.limit === limit ? state.page : 1;
  const setPage = (value) => setState((previous) => ({ limit, page: Math.max(1, typeof value === 'function' ? value(previous.limit === limit ? previous.page : 1) : value) }));
  return [page, setPage];
}

export function usePagination(scope = '', mode = 'rows', name = 'pagination') {
  const { limit, contentRef } = usePageSize(mode);
  const [state, setState] = useSavedViewState(name, { scope, limit, page: 1 });
  const page = state.scope === scope && state.limit === limit ? state.page : 1;
  useEffect(() => {
    // Commit the filter reset so clearing it cannot resurrect an older page.
    // Mounting the same saved view still keeps its previous page.
    if (state.scope !== scope || state.limit !== limit) setState({ scope, limit, page: 1 });
  }, [scope, limit, state.scope, state.limit, setState]);
  const setPage = (value) => setState({ scope, limit, page: Math.max(1, typeof value === 'function' ? value(page) : value) });
  return { page, limit, setPage, contentRef };
}

export function useClientPagination(items, scope = '', mode = 'rows', name = 'pagination') {
  const paging = usePagination(scope, mode, name);
  const totalPages = Math.ceil(items.length / paging.limit);
  const page = Math.max(1, Math.min(paging.page, totalPages || 1));
  return { ...paging, page, items: items.slice((page - 1) * paging.limit, page * paging.limit), meta: { total: items.length, totalPages, page, limit: paging.limit } };
}
