import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import {
  Activity, AlertTriangle, ShieldAlert, RefreshCw, Filter,
  User, Package, Hash,
} from 'lucide-react';
import {
  useGetStaffActivityLogsQuery,
  useGetMissingItemsReportQuery,
  useGetHighValueAlertsQuery,
} from '../../../features/packing/packingApi';
import { cn } from '../../../utils/cn';

const ACTION_META = {
  packing_started:      { label: 'Started Packing',    color: 'text-blue-400',    dot: 'bg-blue-400' },
  item_picked:          { label: 'Item Picked',         color: 'text-sky-400',     dot: 'bg-sky-400' },
  item_packed:          { label: 'Item Packed',         color: 'text-emerald-400', dot: 'bg-emerald-400' },
  item_missing:         { label: 'Item Missing',        color: 'text-red-400',     dot: 'bg-red-400' },
  replacement_suggested:{ label: 'Replacement',         color: 'text-amber-400',   dot: 'bg-amber-400' },
  packing_completed:    { label: 'Packing Completed',   color: 'text-purple-400',  dot: 'bg-purple-400' },
  packing_verified:     { label: 'Packing Verified',    color: 'text-gold-400',    dot: 'bg-gold-400' },
  packing_rejected:     { label: 'Packing Rejected',    color: 'text-orange-400',  dot: 'bg-orange-400' },
  order_assigned:       { label: 'Order Assigned',      color: 'text-slate-400',   dot: 'bg-slate-400' },
  status_updated:       { label: 'Status Updated',      color: 'text-slate-400',   dot: 'bg-slate-400' },
  delivery_started:     { label: 'Delivery Started',    color: 'text-blue-400',    dot: 'bg-blue-400' },
  delivery_completed:   { label: 'Delivery Completed',  color: 'text-emerald-400', dot: 'bg-emerald-400' },
};

const TABS = ['Activity Log', 'Missing Report', 'High-Value Alerts'];

function ActivityLog() {
  const [filters, setFilters] = useState({ highValueOnly: false });
  const [showFilters, setShowFilters] = useState(false);
  const paging = usePagination(JSON.stringify({ ...filters, page: undefined, limit: undefined }));
  const { data, isLoading, isFetching } = useGetStaffActivityLogsQuery({ ...filters, page: paging.page, limit: paging.limit });

  const logs = data?.data ?? [];
  const meta = data?.meta ?? {};

  const setFilter = (key, val) => setFilters((f) => ({ ...f, [key]: val, page: 1 }));

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
            showFilters ? 'border-gold-500/50 text-gold-400 bg-gold-500/10' : 'border-navy-600 text-slate-400'
          )}
        >
          <Filter size={12} /> Filters
        </button>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.highValueOnly}
            onChange={(e) => setFilter('highValueOnly', e.target.checked)}
            className="accent-gold-500 w-3.5 h-3.5"
          />
          <span className="text-xs text-amber-400 font-medium">High-value only</span>
        </label>
        {(isFetching) && <RefreshCw size={13} className="text-slate-500 animate-spin ml-auto" />}
      </div>

      {showFilters && (
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Action</label>
              <select
                value={filters.action || ''}
                onChange={(e) => setFilter('action', e.target.value || undefined)}
                className="w-full bg-navy-900 border border-navy-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-gold-500/60"
              >
                <option value="">All actions</option>
                {Object.entries(ACTION_META).map(([val, { label }]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Date</label>
              <input
                type="date"
                value={filters.date || ''}
                onChange={(e) => setFilter('date', e.target.value || undefined)}
                className="w-full bg-navy-900 border border-navy-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-gold-500/60"
              />
            </div>
          </div>
        </div>
      )}

      {/* Log list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-navy-800 rounded-xl animate-pulse" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12">
          <Activity size={32} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No activity logs found</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => {
            const meta = ACTION_META[log.action] || { label: log.action, color: 'text-slate-400', dot: 'bg-slate-400' };
            return (
              <div
                key={log._id}
                className={cn(
                  'flex items-start gap-3 bg-navy-800 border rounded-xl px-4 py-3',
                  log.isHighValue ? 'border-amber-500/30' : 'border-navy-700/40'
                )}
              >
                <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', meta.dot)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-xs font-semibold', meta.color)}>{meta.label}</span>
                    {log.isHighValue && (
                      <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle size={8} /> HIGH VALUE
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <User size={10} /> {log.staffName}{log.staffRole && ` (${log.staffRole.replaceAll('_', ' ')})`}
                    </span>
                    {log.orderNumber && (
                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Hash size={10} /> {log.orderNumber}
                      </span>
                    )}
                    {log.productName && (
                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Package size={10} /> {log.productName}
                        {log.variantName && ` · ${log.variantName}`}
                        {log.qty && ` ×${log.qty}`}
                      </span>
                    )}
                  </div>
                  {log.action === 'order_assigned' && <p className="text-xs text-slate-400 mt-1">{log.metadata?.task === 'delivery' ? 'Delivery' : 'Packing'}: {log.metadata?.assignee?.name || 'Unassigned'}{log.metadata?.previousAssignee?.name && ` · Previously ${log.metadata.previousAssignee.name}`}</p>}
                  {log.metadata?.status && <p className="text-xs text-slate-400 mt-1">Status: {log.metadata.status.replaceAll('_', ' ')}</p>}
                </div>
                <p className="text-[10px] text-slate-600 shrink-0 mt-0.5">
                  {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <Pagination meta={meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} label="activity logs" />
    </div>
  );
}

function MissingReport() {
  const paging = usePagination();
  const { data, isLoading, isFetching } = useGetMissingItemsReportQuery({ page: paging.page, limit: paging.limit });
  const items = data?.data?.report ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-navy-800 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <Package size={32} className="text-slate-600 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No missing items recorded</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Items sorted by missing frequency. High-value items shown first.</p>
      {items.map((item, idx) => (
        <div
          key={item.productId}
          className={cn(
            'flex items-center gap-3 bg-navy-800 border rounded-xl px-4 py-3',
            item.isHighValue ? 'border-amber-500/30' : 'border-navy-700/40'
          )}
        >
          <span className="text-xl font-black text-navy-600 w-6 text-center shrink-0">
            {(paging.page - 1) * paging.limit + idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-200 truncate">{item.productName}</p>
              {item.isHighValue && <AlertTriangle size={12} className="text-amber-400 shrink-0" />}
            </div>
            {item.variantName && <p className="text-xs text-slate-500">{item.variantName}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-bold text-red-400">{item.occurrences}×</p>
            <p className="text-[10px] text-slate-500">{item.totalMissingQty} units</p>
          </div>
        </div>
      ))}
      <Pagination meta={data?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} />
    </div>
  );
}

function HighValueAlerts() {
  const paging = usePagination();
  const { data, isLoading, isFetching } = useGetHighValueAlertsQuery({ page: paging.page, limit: paging.limit });
  const alerts = data?.data?.alerts ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-navy-800 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="text-center py-12">
        <ShieldAlert size={32} className="text-slate-600 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No high-value alerts in the last 7 days</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">High-value missing item events in the last 7 days</p>
      {alerts.map((log) => (
        <div
          key={log._id}
          className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/25 rounded-xl px-4 py-3"
        >
          <ShieldAlert size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200">
              {log.productName}
              {log.variantName && <span className="text-slate-500 text-xs"> · {log.variantName}</span>}
            </p>
            <div className="flex flex-wrap gap-x-3 mt-0.5">
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <User size={10} /> {log.staffName}
              </span>
              {log.orderNumber && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Hash size={10} /> #{log.orderNumber}
                </span>
              )}
            </div>
            {log.metadata?.missingReason && (
              <p className="text-xs text-red-400 mt-1">&quot;{log.metadata.missingReason}&quot;</p>
            )}
          </div>
          <p className="text-[10px] text-slate-500 shrink-0 mt-0.5">
            {new Date(log.createdAt).toLocaleDateString()}
          </p>
        </div>
      ))}
      <Pagination meta={data?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} />
    </div>
  );
}

export default function StaffActivityPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Staff Activity</h1>
        <p className="text-xs text-slate-500 mt-0.5">Anti-theft monitoring & audit trail</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-navy-800 border border-navy-700/60 rounded-xl p-1">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={cn(
              'flex-1 py-2 rounded-lg text-xs font-semibold transition-all',
              activeTab === i ? 'bg-navy-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 0 && <ActivityLog />}
      {activeTab === 1 && <MissingReport />}
      {activeTab === 2 && <HighValueAlerts />}
    </div>
  );
}
