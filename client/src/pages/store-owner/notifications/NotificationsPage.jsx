import Pagination from '../../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../../hooks/usePagination';
import { useSavedViewState } from '../../../offline/useSavedViewState';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { notificationTarget } from '../../../utils/notificationTarget';
import LoadError from '../../../components/ui/LoadError';
import { Bell, CheckCheck, ShoppingCart, CreditCard, AlertTriangle, Package, User, X, Check } from 'lucide-react';
import { useGetNotificationsQuery, useMarkReadMutation, useMarkAllReadMutation } from '../../../features/notifications/notificationApi';
import { cn } from '../../../utils/cn';
import { formatDistanceToNow } from 'date-fns';

const TYPE_CONFIG = {
  new_order: { icon: ShoppingCart, color: 'text-blue-400 bg-blue-500/10', label: 'New Order' },
  payment_submitted: { icon: CreditCard, color: 'text-gold-400 bg-gold-500/10', label: 'Payment' },
  payment_verified: { icon: Check, color: 'text-green-400 bg-green-500/10', label: 'Payment' },
  payment_rejected: { icon: X, color: 'text-red-400 bg-red-500/10', label: 'Payment' },
  order_cancelled: { icon: X, color: 'text-red-400 bg-red-500/10', label: 'Order' },
  order_accepted: { icon: Check, color: 'text-green-400 bg-green-500/10', label: 'Order' },
  low_stock: { icon: AlertTriangle, color: 'text-orange-400 bg-orange-500/10', label: 'Stock' },
  item_missing: { icon: Package, color: 'text-red-400 bg-red-500/10', label: 'Packing' },
  stock_mismatch: { icon: AlertTriangle, color: 'text-yellow-400 bg-yellow-500/10', label: 'Stock' },
  order_assigned: { icon: User, color: 'text-indigo-400 bg-indigo-500/10', label: 'Staff' },
  packing_started: { icon: Package, color: 'text-blue-400 bg-blue-500/10', label: 'Packing' },
  ready_for_pickup: { icon: Package, color: 'text-teal-400 bg-teal-500/10', label: 'Order' },
  out_for_delivery: { icon: ShoppingCart, color: 'text-cyan-400 bg-cyan-500/10', label: 'Order' },
  delivered: { icon: Check, color: 'text-green-400 bg-green-500/10', label: 'Order' },
  default: { icon: Bell, color: 'text-slate-400 bg-navy-700', label: 'Notification' },
};

const ROLE_TABS = [
  { value: '', label: 'All' },
  { value: 'admin', label: 'Store alerts' },
];

export default function NotificationsPage() {
  const { user } = useAuth();
  const [roleFilter, setRoleFilter] = useSavedViewState('notifications-role', '');
  const [readFilter, setReadFilter] = useSavedViewState('notifications-read', '');
  const { limit } = usePageSize('rows');
  const [page, setPage] = usePageState(limit);

  const params = { limit, page };
  if (roleFilter) params.role = roleFilter;
  if (readFilter !== '') params.isRead = readFilter;

  const { data, isFetching, isLoading, isError, error, refetch } = useGetNotificationsQuery(params);
  const [markRead] = useMarkReadMutation();
  const [markAllRead] = useMarkAllReadMutation();

  const notifications = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="text-slate-500 text-sm mt-1">{meta.total == null ? 'Total unavailable' : `${meta.total} total`}</p>
        </div>
        <button className="btn-secondary flex items-center gap-2" onClick={() => markAllRead()}>
          <CheckCheck size={16} /> Mark All Read
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-navy-800 p-1 rounded-xl border border-navy-700">
          {ROLE_TABS.map((t) => (
            <button key={t.value}
              onClick={() => { setRoleFilter(t.value); setPage(1); }}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', roleFilter === t.value ? 'bg-gold-500/20 text-gold-400' : 'text-slate-400 hover:text-slate-200')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-navy-800 p-1 rounded-xl border border-navy-700">
          {[['', 'All'], ['false', 'Unread'], ['true', 'Read']].map(([val, label]) => (
            <button key={val}
              onClick={() => { setReadFilter(val); setPage(1); }}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', readFilter === val ? 'bg-gold-500/20 text-gold-400' : 'text-slate-400 hover:text-slate-200')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {isError ? <LoadError title="Could not load notifications" error={error} retry={refetch} /> : isLoading ? (
          <div role="status" aria-label="Loading notifications" className="space-y-3">{[0, 1, 2].map((index) => <div key={index} className="notification-card min-h-20 animate-pulse" aria-hidden="true" />)}</div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center">
            <Bell size={36} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No notifications</p>
          </div>
        ) : (
          notifications.map((n) => {
            const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.default;
            const Icon = cfg.icon;
            return (
              <div key={n._id} className={cn('notification-card', !n.isRead && 'is-unread')}>
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5', cfg.color)}>
                  <Icon size={16} />
                </div>
                <div className="min-w-0 notification-copy">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{cfg.label}</span>
                      <p className={cn('text-sm font-medium leading-snug', n.isRead ? 'text-slate-400' : 'text-slate-100')}>{n.title}</p>
                      {n.body && <p className="text-sm text-slate-500 mt-1">{n.body}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-600 whitespace-nowrap">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                      {!n.isRead && (
                        <button onClick={() => markRead(n._id)} className="workspace-row-action hover:bg-navy-700 text-slate-500 hover:text-green-400" title="Mark as read" aria-label="Mark notification as read">
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="badge bg-navy-700 text-slate-500 border border-navy-600 text-[10px]">{n.role}</span>
                    {notificationTarget(user, n) && <Link to={notificationTarget(user, n)} onClick={() => { if (!n.isRead) markRead(n._id); }} className="workspace-link">View details</Link>}
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-gold-500 shrink-0" />}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="notifications" />
    </div>
  );
}
