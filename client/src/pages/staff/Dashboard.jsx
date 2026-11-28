import { ClipboardList, PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetDashboardQuery } from '../../features/dashboard/dashboardApi';
import { useAuth } from '../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { ROUTES } from '../../constants/routes';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import { accountingDate, resolveStoreTimeZone } from '../../utils/accounting';

const actions = [
  { label: 'Open POS', to: ROUTES.STAFF.POS, icon: ShoppingCart, permission: PERMISSIONS.POS_ACCESS },
  { label: 'View orders', to: ROUTES.STAFF.ORDERS, icon: ClipboardList, permission: PERMISSIONS.ORDERS_VIEW },
  { label: 'Pack orders', to: ROUTES.STAFF.PACKING, icon: PackageCheck, permission: PERMISSIONS.PACKING_PERFORM },
  { label: 'My deliveries', to: ROUTES.STAFF.DELIVERIES, icon: Truck, permission: PERMISSIONS.DELIVERY_VIEW },
];

export default function StaffDashboard() {
  const { user, store } = useAuth();
  const { data, isLoading, isError, refetch } = useGetDashboardQuery(undefined, {
    pollingInterval: 0, skipPollingIfUnfocused: true, refetchOnFocus: true, refetchOnReconnect: true,
  });
  const dashboard = data?.data || {};
  const stats = dashboard.stats || {};
  const pending = dashboard.pendingOrders || [];
  const visibleActions = actions.filter((action) => hasPermission(user, action.permission));
  const isDelivery = user?.role === 'delivery';
  const historical = dashboard.businessDate && dashboard.businessDate !== accountingDate(undefined, resolveStoreTimeZone(store?.settings?.timezone));

  const metrics = isDelivery ? [
    { label: 'Assigned', value: stats.assignedOrders ?? '—', color: 'text-blue-400' },
    { label: 'Delivered today', value: stats.deliveredToday ?? '—', color: 'text-emerald-400' },
  ] : [
    { label: 'Sales today', value: stats.salesToday == null ? '—' : formatCurrency(stats.salesToday), color: 'text-gold-400' },
    { label: 'Orders today', value: stats.ordersToday ?? '—', color: 'text-blue-400' },
    { label: 'Items packed', value: stats.itemsPacked ?? '—', color: 'text-emerald-400' },
    { label: 'Assigned', value: stats.assignedOrders ?? '—', color: 'text-purple-400' },
  ];

  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold text-slate-100">Hello, {user?.name?.split(' ')[0]}</h1><p className="text-slate-400 text-sm mt-0.5 capitalize">{user?.role} at {store?.name}</p></div>
      {historical && <p role="status" className="workspace-feedback">Saved activity for {dashboard.businessDate}. These totals describe that day.</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {visibleActions.map((action) => <Link key={action.to} to={action.to} className="card-hover min-h-24 p-4 flex flex-col items-center justify-center gap-2 text-center"><action.icon size={24} className="text-gold-400" aria-hidden="true" /><span className="text-sm font-semibold text-slate-200">{action.label}</span></Link>)}
      </div>

      {isLoading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{metrics.map((metric) => <SkeletonCard key={metric.label} />)}</div> : isError ? (
        <EmptyState icon={ClipboardList} title="Dashboard could not be loaded" description="Try the request again." action={<Button size="sm" variant="secondary" onClick={refetch}>Retry</Button>} />
      ) : <>
        <section aria-labelledby="today-metrics"><h2 id="today-metrics" className="sr-only">{historical ? `Activity for ${dashboard.businessDate}` : "Today's activity"}</h2><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{metrics.map((metric) => <div key={metric.label} className="card p-4"><p className={`text-xl font-bold ${metric.color}`}>{metric.value}</p><p className="text-xs text-slate-400 mt-1">{historical ? metric.label.replace('today', `on ${dashboard.businessDate}`) : metric.label}</p></div>)}</div></section>

        <section aria-labelledby="assigned-orders" className="space-y-3"><div className="flex items-center justify-between"><h2 id="assigned-orders" className="font-semibold text-slate-200">Assigned work</h2><Badge variant="warning">{pending.length}</Badge></div>
          {pending.length === 0 ? <div className="rounded-2xl bg-navy-800/50 p-8 text-center"><PackageCheck size={34} className="mx-auto text-slate-600" aria-hidden="true" /><p className="mt-2 text-sm text-slate-400">No work is currently assigned to you.</p></div> : <div className="grid gap-3 lg:grid-cols-2">{pending.map((order) => <article key={order._id} className="card p-4 flex items-start justify-between gap-4"><div className="min-w-0"><p className="font-mono text-xs text-slate-500">{order.orderNumber}</p><h3 className="font-medium text-slate-200 truncate">{order.customerInfo?.name || 'Customer'}</h3><p className="text-xs text-slate-500 mt-1">{order.itemCount ? `${order.itemCount} items · ` : ''}{formatTimeAgo(order.createdAt)}</p></div><div className="text-right shrink-0"><Badge status={order.status}>{order.status?.replaceAll('_', ' ')}</Badge>{order.pricing?.grandTotal != null && <p className="text-sm font-semibold text-gold-400 mt-2">{formatCurrency(order.pricing.grandTotal)}</p>}</div></article>)}</div>}
        </section>
      </>}
    </div>
  );
}
