import { useEffect } from 'react';
import Button from './Button';

export default function Pagination({ meta, page, onPageChange, isFetching = false, label = 'records' }) {
  const total = meta?.total ?? 0;
  const pages = meta?.totalPages ?? 0;
  useEffect(() => {
    if (!isFetching && meta && page > Math.max(1, pages)) onPageChange(Math.max(1, pages));
  }, [page, pages, isFetching, meta, onPageChange]);
  if (!meta || !total) return null;
  const limit = meta.limit || Math.ceil(total / (pages || 1));
  return <nav aria-label={`${label} pagination`} className="flex flex-wrap items-center justify-between gap-3 py-3">
    <p role="status" className="text-xs text-slate-500">{Math.min(total, (page - 1) * limit + 1)}–{Math.min(total, page * limit)} of {total} {label} · Page {page} of {Math.max(1, pages)}</p>
    {pages > 1 && <div className="flex gap-2"><Button type="button" variant="secondary" size="sm" disabled={isFetching || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button><Button type="button" variant="secondary" size="sm" disabled={isFetching || page >= pages} onClick={() => onPageChange(page + 1)}>Next</Button></div>}
  </nav>;
}
