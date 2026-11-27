import { useSavedViewState } from '../../offline/useSavedViewState';
import { useClientPagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Power, Package, ShoppingBag, Users, Check, Shield, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useGetStoreDetailQuery, useUpdateSubscriptionMutation,
  useToggleStoreStatusMutation, useUpdateModulesMutation,
  useUpdateLimitsMutation, useLogSupportAccessMutation, useGetSupportAccessLogsQuery,
} from '../../features/superAdmin/superAdminApi';
import { useGetPlansQuery } from '../../features/plans/planApi';
import { formatDate, formatDateTime } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { cn } from '../../utils/cn';

const ALL_MODULES = ['pos', 'inventory', 'purchases', 'suppliers', 'packing', 'returns', 'daily_closing', 'accounting', 'reports', 'storefront', 'coupons', 'offers'];

const PLAN_VARIANTS = { trial: 'default', basic: 'info', premium: 'gold', enterprise: 'purple' };

export default function TenantDetailPage() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useSavedViewState('TenantDetailPage:TenantDetailPage:activeTab', 'overview');
  const [accessReason, setAccessReason] = useState('');

  const { data, isLoading } = useGetStoreDetailQuery(id);
  const { data: plansData } = useGetPlansQuery();
  const [updateSub, { isLoading: isUpdatingSub }] = useUpdateSubscriptionMutation();
  const [toggleStatus] = useToggleStoreStatusMutation();
  const [updateModules, { isLoading: isUpdatingModules }] = useUpdateModulesMutation();
  const [updateLimits, { isLoading: isUpdatingLimits }] = useUpdateLimitsMutation();
  const [logAccess] = useLogSupportAccessMutation();
  const { data: accessLogs } = useGetSupportAccessLogsQuery(id);

  const store = data?.data?.store;
  const stats = data?.data?.stats;
  const recentAudit = data?.data?.recentAudit ?? [];
  const plans = plansData?.data?.plans ?? [];
  const supportLogs = accessLogs?.data?.logs ?? [];
  const auditPaging = useClientPagination(recentAudit, id);
  const supportPaging = useClientPagination([...supportLogs].reverse(), id);

  const [subForm, setSubForm] = useState(null);
  const [limitsForm, setLimitsForm] = useState(null);

  const enabledModules = store?.moduleSettings?.enabledModules || [];

  if (isLoading) return (
    <div className="space-y-4">
      <SkeletonCard lines={3} />
      <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <SkeletonCard key={i} lines={2} />)}</div>
    </div>
  );

  if (!store) return (
    <div className="p-8 text-center text-slate-400">Store not found.</div>
  );

  const expired = store.subscription?.expiresAt && new Date(store.subscription.expiresAt) < new Date();

  const handleToggle = async () => {
    try { await toggleStatus(id).unwrap(); toast.success('Status toggled'); } catch { toast.error('Failed'); }
  };

  const handleSubSave = async () => {
    if (!subForm) return;
    try {
      await updateSub({ id, ...subForm }).unwrap();
      toast.success('Subscription updated');
      setSubForm(null);
    } catch (err) { toast.error(err?.data?.message || 'Failed'); }
  };

  const handleToggleModule = async (mod) => {
    const newMods = enabledModules.includes(mod) ? enabledModules.filter((m) => m !== mod) : [...enabledModules, mod];
    try { await updateModules({ id, enabledModules: newMods }).unwrap(); toast.success('Modules updated'); } catch { toast.error('Failed'); }
  };

  const handleLimitsSave = async () => {
    if (!limitsForm) return;
    try {
      await updateLimits({ id, ...Object.fromEntries(Object.entries(limitsForm).map(([k, v]) => [k, Number(v)])) }).unwrap();
      toast.success('Limits updated');
      setLimitsForm(null);
    } catch { toast.error('Failed'); }
  };

  const handleLogAccess = async () => {
    try {
      await logAccess({ id, reason: accessReason || 'Support access' }).unwrap();
      toast.success('Access logged');
      setAccessReason('');
    } catch { toast.error('Failed'); }
  };

  const TABS = ['overview', 'subscription', 'modules', 'limits', 'audit', 'support'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/super-admin/stores" aria-label="Back to stores" className="workspace-row-action shrink-0 hover:bg-navy-700 text-slate-400 hover:text-slate-100 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="w-10 h-10 shrink-0 bg-gradient-gold rounded-xl flex items-center justify-center">
            <span className="text-navy-950 font-bold">{store.name[0]}</span>
          </div>
          <div className="min-w-0 break-words">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100 break-words">{store.name}</h1>
              <Badge status={store.isActive ? 'active' : 'inactive'} dot>{store.isActive ? 'Active' : 'Inactive'}</Badge>
              {expired && <Badge variant="danger">Expired</Badge>}
            </div>
            <p className="text-slate-500 text-sm">/{store.slug} · {store.ownerId?.phone}</p>
          </div>
        </div>
        <div className="ml-auto">
          <button onClick={handleToggle} className={cn('btn-sm', store.isActive ? 'btn-danger' : 'btn-primary flex items-center gap-1')}>
            <Power size={14} /> {store.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Products', value: stats?.productCount ?? 0, icon: Package, color: 'text-blue-400 bg-blue-500/10' },
          { label: 'Orders', value: stats?.orderCount ?? 0, icon: ShoppingBag, color: 'text-gold-400 bg-gold-500/10' },
          { label: 'Staff', value: stats?.userCount ?? 0, icon: Users, color: 'text-purple-400 bg-purple-500/10' },
        ].map((s) => (
          <div key={s.label} className="kpi-card p-3 sm:p-5">
            <div className={cn('p-2.5 rounded-xl w-fit', s.color)}><s.icon size={18} /></div>
            <p className="text-2xl font-bold text-slate-100 mt-2">{s.value}</p>
            <p className="text-sm text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-navy-800 p-1 rounded-2xl border border-navy-700 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={cn('px-4 py-2 rounded-xl text-sm font-medium capitalize whitespace-nowrap transition-all', activeTab === t ? 'bg-purple-500/20 text-purple-300 border border-purple-500/20' : 'text-slate-400 hover:text-slate-200')}>
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-slate-200">Store Info</h3>
            {[
              ['Owner', store.ownerId?.name],
              ['Phone', store.ownerId?.phone],
              ['Email', store.ownerId?.email || '—'],
              ['City', store.address?.city || '—'],
              ['Created', formatDate(store.createdAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm py-1 border-b border-navy-700/40 last:border-0">
                <span className="text-slate-500">{k}</span>
                <span className="text-slate-200 font-medium">{v}</span>
              </div>
            ))}
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-slate-200">Recent Activity</h3>
            {recentAudit.length === 0 ? <p className="text-slate-500 text-sm">No activity yet</p> : (
              <div className="space-y-2">
                {recentAudit.slice(0, 7).map((log) => (
                  <div key={log._id} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full mt-2 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-300">{log.description || log.action}</p>
                      <p className="text-[10px] text-slate-600">{formatDateTime(log.createdAt)} · {log.performedBy?.name || 'System'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subscription */}
      {activeTab === 'subscription' && (
        <div className="card p-5 space-y-5">
          <h3 className="font-semibold text-slate-200">Subscription Settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Current Plan</label>
              <Badge variant={PLAN_VARIANTS[store.subscription?.plan] || 'default'} className="text-sm py-1 px-3">
                {store.subscription?.plan || 'trial'}
              </Badge>
            </div>
            <div>
              <label className="label">Expires</label>
              <p className={cn('text-sm font-medium', expired ? 'text-red-400' : 'text-slate-200')}>
                {store.subscription?.expiresAt ? formatDate(store.subscription.expiresAt) : '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Change Plan</label>
              <select className="input" value={subForm?.plan ?? store.subscription?.plan ?? 'trial'} onChange={(e) => setSubForm((f) => ({ ...(f || {}), plan: e.target.value }))}>
                {plans.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">New Expiry Date</label>
              <input className="input" type="date" value={subForm?.expiresAt ?? (store.subscription?.expiresAt ? store.subscription.expiresAt.slice(0, 10) : '')} onChange={(e) => setSubForm((f) => ({ ...(f || {}), expiresAt: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Payment Reference</label>
            <input className="input" placeholder="e.g. TXN1234567890" value={subForm?.paymentRef ?? store.subscription?.paymentRef ?? ''} onChange={(e) => setSubForm((f) => ({ ...(f || {}), paymentRef: e.target.value }))} />
          </div>

          <button className="btn-primary" onClick={handleSubSave} disabled={isUpdatingSub || !subForm}>
            {isUpdatingSub ? 'Saving...' : 'Update Subscription'}
          </button>

          {/* Upgrade guide */}
          <div className="p-4 bg-navy-900/60 rounded-xl border border-navy-700 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Manual Payment Flow</p>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
              <li>Customer contacts us via WhatsApp / phone</li>
              <li>Collect payment via UPI / bank transfer</li>
              <li>Update plan + expiry above and save</li>
              <li>Enter transaction ID in Payment Reference</li>
            </ol>
          </div>
        </div>
      )}

      {/* Modules */}
      {activeTab === 'modules' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-200">Module Access</h3>
          <p className="text-xs text-slate-500">Toggle modules on/off for this store. Changes take effect immediately.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {ALL_MODULES.map((mod) => {
              const enabled = enabledModules.includes(mod);
              return (
                <button key={mod} type="button" onClick={() => handleToggleModule(mod)} disabled={isUpdatingModules}
                  className={cn('flex items-center justify-between p-3 rounded-xl border text-sm font-medium transition-all', enabled ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'bg-navy-700/40 border-navy-600 text-slate-500 hover:border-navy-500')}>
                  <span className="capitalize">{mod.replace('_', ' ')}</span>
                  <div className={cn('w-5 h-5 rounded-full flex items-center justify-center border text-xs', enabled ? 'bg-purple-500 border-purple-400' : 'border-navy-500')}>
                    {enabled && <Check size={10} className="text-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Limits */}
      {activeTab === 'limits' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-200">Usage Limits</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { key: 'maxProducts', label: 'Max Products', current: store.limits?.maxProducts },
              { key: 'maxOrdersPerMonth', label: 'Orders/Month', current: store.limits?.maxOrdersPerMonth },
              { key: 'maxStaff', label: 'Max Staff', current: store.limits?.maxStaff },
              { key: 'maxCustomers', label: 'Max Customers', current: store.limits?.maxCustomers },
            ].map(({ key, label, current }) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input className="input" type="number" min="0"
                  value={limitsForm?.[key] ?? current ?? 0}
                  onChange={(e) => setLimitsForm((f) => ({ ...(f || store.limits || {}), [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={handleLimitsSave} disabled={isUpdatingLimits || !limitsForm}>
            {isUpdatingLimits ? 'Saving...' : 'Update Limits'}
          </button>
        </div>
      )}

      {/* Audit */}
      {activeTab === 'audit' && (
        <div className="card overflow-hidden p-0">
          <div className="px-5 py-4 border-b border-navy-700/60 flex items-center gap-2">
            <Clock size={16} className="text-purple-400" />
            <h3 className="font-semibold text-slate-200">Activity Log</h3>
          </div>
          <div className="divide-y divide-navy-700/30">
            {recentAudit.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">No audit logs yet</div>
            ) : (
              auditPaging.items.map((log) => (
                <div key={log._id} className="flex items-start gap-4 px-5 py-3.5">
                  <div className="w-8 h-8 rounded-full bg-navy-700 flex items-center justify-center shrink-0">
                    <Shield size={14} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">{log.description || log.action}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{log.performedBy?.name} ({log.performedBy?.role}) · {formatDateTime(log.createdAt)}</p>
                  </div>
                  <span className="text-[10px] font-mono bg-navy-700 text-slate-400 px-2 py-0.5 rounded border border-navy-600">{log.action}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Support */}
      {activeTab === 'support' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-slate-200">Log Support Access</h3>
            <p className="text-xs text-slate-500">Log your access to this tenant for audit purposes.</p>
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="Reason for access (e.g. billing issue)" value={accessReason} onChange={(e) => setAccessReason(e.target.value)} />
              <button className="btn-primary whitespace-nowrap" onClick={handleLogAccess}>Log Access</button>
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="px-5 py-4 border-b border-navy-700/60">
              <h3 className="font-semibold text-slate-200">Access History</h3>
            </div>
            {supportLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">No support access logged</div>
            ) : (
              <div className="divide-y divide-navy-700/30">
                {supportPaging.items.map((log, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
                      <Shield size={14} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200">{log.adminName}</p>
                      <p className="text-xs text-slate-500">{log.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">{formatDateTime(log.accessedAt)}</p>
                      {log.ip && <p className="text-[10px] text-slate-600">{log.ip}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'audit' && <Pagination meta={auditPaging.meta} page={auditPaging.page} onPageChange={auditPaging.setPage} label="audit logs" />}
      {activeTab === 'support' && <Pagination meta={supportPaging.meta} page={supportPaging.page} onPageChange={supportPaging.setPage} label="support logs" />}
    </div>
  );
}
