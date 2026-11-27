import { AlertTriangle, ArrowRight, BookOpen, CalendarDays, ClipboardList, Package, Plus, RefreshCw, TrendingUp, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { useAuth } from '../../hooks/useAuth';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import { accountingDate, resolveStoreTimeZone } from '../../utils/accounting';
import { ROUTES } from '../../constants/routes';
import { PERMISSIONS, hasPermission } from '../../constants/permissions';
import { useGetDashboardQuery } from '../../features/dashboard/dashboardApi';

function OverviewMetric({ title, value, detail, icon: Icon, tone, to }) {
  const Tag = to ? Link : 'article';
  return (
    <Tag to={to} className={`card flex min-w-0 gap-3 p-4 sm:p-5 ${to ? 'metric-link' : ''}`}>
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>
        <Icon size={19} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <p className="break-words text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{value}</p>
        {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
      </div>
    </Tag>
  );
}

function Queue({ id, title, to, action, children }) {
  return (
    <section className="card p-0 min-w-0 overflow-hidden" aria-labelledby={id}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 border-b border-navy-700 px-4 py-2 sm:px-5">
        <h2 id={id} className="text-base font-bold tracking-tight">{title}</h2>
        <Link to={to} className="workspace-link">{action}<ArrowRight size={15} aria-hidden="true" /></Link>
      </header>
      {children}
    </section>
  );
}

export default function StoreOwnerDashboard() {
  const { user, store } = useAuth();
  const { data, isLoading, isError, error, refetch } = useGetDashboardQuery();
  const { kpis = {}, pendingOrders = [], lowStock = [] } = data?.data || {};

  const now = new Date();
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const date = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone });
  const trend = kpis.revenueChange;
  const savedDate = data?.data?.businessDate;
  const historical = savedDate && savedDate !== accountingDate(undefined, timeZone);

  return (
    <div className="space-y-6">
      <header className="dashboard-welcome flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-sm font-medium text-slate-500">{date}</p>
          <h1>{greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
        </div>
        {hasPermission(user, PERMISSIONS.POS_ACCESS) && (
          <Link to={ROUTES.STORE.POS} className="btn-primary"><Plus size={19} aria-hidden="true" /> New Bill</Link>
        )}
      </header>

      <nav className="dashboard-shortcuts" aria-label="Quick actions">
        {[
          { label: 'Add product', detail: 'Set up a new item', to: `${ROUTES.STORE.PRODUCTS}/new`, permission: PERMISSIONS.PRODUCTS_CREATE, icon: Package },
          { label: 'Record purchase', detail: 'Add incoming stock', to: ROUTES.STORE.PURCHASE_NEW, permission: PERMISSIONS.PURCHASES_MANAGE, icon: Truck },
          { label: 'Udhar accounts', detail: 'View dues and payments', to: ROUTES.STORE.UDHAR, permission: PERMISSIONS.ACCOUNTING_VIEW, icon: BookOpen },
          { label: 'Day close', detail: 'Check the day’s cash', to: ROUTES.STORE.DAILY_CLOSING, permission: PERMISSIONS.ACCOUNTING_VIEW, icon: CalendarDays },
        ].filter((action) => hasPermission(user, action.permission)).map(({ label, detail, to, icon: Icon }) => <Link key={to} to={to} className="dashboard-shortcut">
          <span className="dashboard-shortcut-icon"><Icon size={20} aria-hidden="true" /></span><span className="min-w-0"><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={15} className="shrink-0 text-slate-500" aria-hidden="true" />
        </Link>)}
      </nav>

      {isError ? (
        <div className="workspace-feedback flex flex-wrap items-center justify-between gap-3" role="alert">
          <div>
            <p className="font-semibold">Dashboard data is unavailable</p>
            {error?.data?.message && <p className="mt-1 text-sm">{error.data.message}</p>}
          </div>
          <button type="button" className="btn-secondary" onClick={refetch}><RefreshCw size={16} aria-hidden="true" /> Try again</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4" aria-busy={isLoading}>
            {isLoading ? (
              <>
                <p className="sr-only" role="status">Loading dashboard</p>
                {[0, 1, 2].map((index) => <SkeletonCard key={index} />)}
              </>
            ) : (
              <>
                <OverviewMetric title={historical ? `Sales on ${savedDate}` : "Today's sales"} value={formatCurrency(kpis.revenueToday ?? 0)} icon={TrendingUp}
                  to={hasPermission(user, PERMISSIONS.REPORTS_SENSITIVE) ? ROUTES.STORE.SALES : undefined}
                  detail={trend != null ? `${trend > 0 ? '+' : ''}${trend}% vs yesterday · View breakdown` : 'View POS & online breakdown'} tone="bg-blue-500/10 text-blue-400" />
                <OverviewMetric title="Pending orders" value={kpis.pendingOrderCount ?? pendingOrders.length} icon={ClipboardList}
                  to={ROUTES.STORE.ORDERS} tone="bg-purple-500/10 text-purple-400" />
                <OverviewMetric title="Low stock" value={kpis.lowStockCount ?? lowStock.length} icon={AlertTriangle}
                  to={ROUTES.STORE.INVENTORY_LOW_STOCK} detail="Product variants" tone="bg-amber-500/10 text-amber-400" />
              </>
            )}
          </div>

          {!isLoading && (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Queue id="order-queue" title="Order queue" to={ROUTES.STORE.ORDERS} action="View orders">
                {pendingOrders.length ? (
                  <ul className="divide-y divide-navy-700">
                    {pendingOrders.map((order) => (
                      <li key={order._id}>
                        <Link to={`${ROUTES.STORE.ORDERS}?orderId=${order._id}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-navy-750 focus-visible:-outline-offset-2 sm:px-5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{order.customerInfo?.name || 'Walk-in customer'}</p>
                            <p className="mt-1 break-words text-xs text-slate-500">{order.orderNumber} · {formatTimeAgo(order.createdAt)}</p>
                          </div>
                          <div className="text-right">
                            <p className="mb-1 text-sm font-bold tabular-nums">{formatCurrency(order.pricing?.grandTotal ?? 0)}</p>
                            <Badge variant="info" className="capitalize">{order.status?.replaceAll('_', ' ')}</Badge>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={ClipboardList} title="No pending orders" className="py-10" />}
              </Queue>
              <Queue id="stock-alerts" title="Stock alerts" to={ROUTES.STORE.INVENTORY_LOW_STOCK} action="View low stock">
                {lowStock.length ? (
                  <ul className="divide-y divide-navy-700">
                    {lowStock.map((item) => (
                      <li key={`${item._id}-${item.variantId}`} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.name}</p>
                          <p className="mt-1 text-xs text-amber-400">{item.variantName} · {item.stock} {item.unit} left</p>
                        </div>
                        {hasPermission(user, PERMISSIONS.INVENTORY_ADJUST) && (
                          <Link to={`${ROUTES.STORE.INVENTORY_LOW_STOCK}?productId=${item._id}&variantId=${item.variantId}`}
                            className="workspace-link shrink-0">Restock<span className="sr-only"> {item.name} {item.variantName}</span></Link>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={Package} title="Stock levels look good" className="py-10" />}
              </Queue>
            </div>
          )}
        </>
      )}
    </div>
  );
}
