import { useState } from 'react';
import { Shield } from 'lucide-react';
import { useGetSAAuditLogsQuery } from '../../features/superAdmin/superAdminApi';
import { formatDateTime } from '../../utils/formatters';
import { SkeletonTable } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { cn } from '../../utils/cn';

const ACTION_COLORS = {
  order_created: 'text-blue-400 bg-blue-500/10',
  pos_bill_created: 'text-gold-400 bg-gold-500/10',
  payment_verified: 'text-green-400 bg-green-500/10',
  payment_rejected: 'text-red-400 bg-red-500/10',
  stock_adjusted: 'text-orange-400 bg-orange-500/10',
  expense_added: 'text-purple-400 bg-purple-500/10',
  salary_paid: 'text-teal-400 bg-teal-500/10',
  plan_changed: 'text-purple-400 bg-purple-500/10',
  store_updated: 'text-slate-400 bg-navy-700',
  admin_login: 'text-yellow-400 bg-yellow-500/10',
  default: 'text-slate-400 bg-navy-700',
};

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const params = { page, limit: 50 };
  if (action) params.action = action;
  if (from) params.from = from;
  if (to) params.to = to;

  const { data, isLoading } = useGetSAAuditLogsQuery(params);
  const logs = data?.data ?? [];
  const meta = data?.meta ?? {};

  const ACTIONS = [
    'order_created', 'pos_bill_created', 'payment_verified', 'payment_rejected',
    'stock_adjusted', 'expense_added', 'salary_paid', 'plan_changed', 'store_updated', 'admin_login',
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">System Audit Logs</h1>
        <p className="text-slate-500 text-sm mt-0.5">{meta.total ?? 0} entries</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select className="input w-48 text-sm py-2.5" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <input className="input w-48 text-sm py-2.5" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} placeholder="From date" />
        <input className="input w-48 text-sm py-2.5" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} placeholder="To date" />
      </div>

      {isLoading ? <SkeletonTable rows={8} cols={4} /> : logs.length === 0 ? (
        <EmptyState icon={Shield} title="No audit logs found" description="Logs appear as users take actions in the system." />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Performed By</th>
                  <th>Description</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const colorCls = ACTION_COLORS[log.action] || ACTION_COLORS.default;
                  return (
                    <tr key={log._id}>
                      <td>
                        <span className={cn('badge text-[11px] font-mono border-0', colorCls)}>
                          {log.action}
                        </span>
                      </td>
                      <td>
                        <p className="text-sm text-slate-200">{log.performedBy?.name || 'System'}</p>
                        <p className="text-xs text-slate-500">{log.performedBy?.role}</p>
                      </td>
                      <td>
                        <p className="text-sm text-slate-300 max-w-xs truncate">{log.description || '—'}</p>
                        {log.resource?.label && <p className="text-xs text-slate-500">{log.resource.type}: {log.resource.label}</p>}
                      </td>
                      <td>
                        <p className="text-sm text-slate-400 whitespace-nowrap">{formatDateTime(log.createdAt)}</p>
                        {log.ip && <p className="text-xs text-slate-600">{log.ip}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-navy-700/60">
              <span className="text-xs text-slate-500">Page {page} of {meta.totalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">Prev</button>
                <button onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
