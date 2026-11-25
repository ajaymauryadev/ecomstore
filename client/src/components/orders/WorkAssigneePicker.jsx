import { useEffect, useRef, useState } from 'react';
import { useGetStaffQuery } from '../../features/staff/staffApi';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { useAuth } from '../../hooks/useAuth';
import { actorLabel } from '../../utils/orderResponsibility';
import Button from '../ui/Button';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PAGE_SIZE } from '../../constants/pagination';

export default function WorkAssigneePicker({ kind, current, snapshot, onSave, saving, disabled, draft = false }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const currentId = current?._id || (typeof current === 'string' ? current : '') || snapshot?.userId || '';
  const savedId = useRef(null);
  useEffect(() => {
    if (savedId.current === currentId) return;
    savedId.current = currentId;
    setSelected(currentId ? { ...(typeof current === 'object' ? current : snapshot), _id: currentId } : null);
  }, [current, snapshot, currentId]);
  const settledSearch = useDebouncedValue(search.trim());
  const { data, isFetching, isError, refetch } = useGetStaffQuery({ page, limit: PAGE_SIZE, search: settledSearch || undefined });
  const permission = kind === 'packing' ? PERMISSIONS.PACKING_PERFORM : PERMISSIONS.DELIVERY_UPDATE;
  const term = search.trim().toLowerCase();
  const candidates = [user, ...(data?.data || [])].filter((member) => member && member.isActive !== false && hasPermission(member, permission)
    && (!term || [member.name, member.email].some((value) => value?.toLowerCase().includes(term))));
  const matches = candidates.length;
  if (selected && !candidates.some((member) => member._id === selected._id)) candidates.unshift(selected);
  const options = [...new Map(candidates.map((member) => [member._id, member])).values()];
  const label = kind === 'packing' ? 'Packing' : 'Delivery';
  return <fieldset disabled={disabled || saving} className="space-y-2 disabled:opacity-60">
    <legend className="text-xs text-slate-400 mb-2">{label} assignment</legend>
    <input className="input min-h-11" aria-label={`Search ${label.toLowerCase()} staff`} placeholder="Search employee name or email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
    {isError && <p className="text-xs text-red-400">Staff could not be loaded. <button type="button" onClick={refetch}>Retry</button></p>}
    {(isFetching || settledSearch !== search.trim()) && <p role="status" className="text-xs text-slate-500">Finding employees…</p>}
    {!isFetching && settledSearch === search.trim() && term && !matches && !isError && <p role="status" className="text-xs text-slate-500">No matching employees with {kind} permission.</p>}
    <div className="flex flex-col sm:flex-row gap-2">
      <select className="input min-h-11" aria-label={`${label} assignee`} value={selected?._id || ''} onChange={(event) => {
        const member = options.find((row) => row._id === event.target.value) || null;
        setSelected(member); if (draft) onSave(member?._id || null);
      }}>
        <option value="">Unassigned</option>
        {options.map((member) => <option key={member._id} value={member._id}>{actorLabel(member)}{member._id === user?._id ? ' — Me' : ''}</option>)}
      </select>
      {!draft && <Button size="sm" variant="primary" isLoading={saving} disabled={saving || (selected?._id || '') === currentId} onClick={() => onSave(selected?._id || null)}>Assign</Button>}
    </div>
    {!draft && (selected?._id || '') !== currentId && <p className="text-xs text-amber-400">Not saved yet. Click Assign to confirm {selected ? actorLabel(selected) : 'unassignment'}.</p>}
    {data?.meta?.totalPages > 1 && <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
      <button type="button" className="min-h-11" disabled={page === 1 || isFetching} onClick={() => setPage((value) => value - 1)}>Previous staff</button>
      <span>Page {page} of {data.meta.totalPages}</span>
      <button type="button" className="min-h-11" disabled={page >= data.meta.totalPages || isFetching} onClick={() => setPage((value) => value + 1)}>Next staff</button>
    </div>}
  </fieldset>;
}
