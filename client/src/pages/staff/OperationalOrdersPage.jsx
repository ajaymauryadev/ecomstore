import Pagination from '../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../hooks/usePagination';
import OrderResponsibility from '../../components/orders/OrderResponsibility';
import { useState } from 'react';
import { ClipboardList, RefreshCw, Search } from 'lucide-react';
import { useGetAdminOrdersQuery } from '../../features/orders/orderApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { SkeletonTable } from '../../components/ui/Skeleton';

const STATUS_OPTIONS = ['', 'pending', 'accepted', 'payment_verified', 'packing', 'packed', 'out_for_delivery', 'delivered'];

export default function OperationalOrdersPage() {
  const { store } = useAuth();
  const [search, setSearch] = useState('');
  const settledSearch = useDebouncedValue(search.trim());
  const [status, setStatus] = useState('');
  const { limit } = usePageSize('cards');
  const [page, setPage] = usePageState(limit);
  const { data, isLoading, isError, isFetching, refetch } = useGetAdminOrdersQuery(
    { slug: store?.slug, search: settledSearch || undefined, status: status || undefined, page, limit },
    { skip: !store?.slug },
  );

  const orders = data?.data || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-5" aria-busy={isFetching}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Store orders</h1>
          <p className="text-sm text-slate-400">Live operational view. Administrative changes require an owner.</p>
        </div>
        <button type="button" onClick={refetch} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl hover:bg-navy-800 text-slate-400" aria-label="Refresh orders" title="Refresh orders">
          <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-56">
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9 min-h-11"
            aria-label="Search orders"
            placeholder="Order number or customer"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
        </div>
        <select className="input min-h-11 min-w-48" aria-label="Filter order status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          {STATUS_OPTIONS.map((value) => <option key={value || 'all'} value={value}>{value ? value.replaceAll('_', ' ') : 'All statuses'}</option>)}
        </select>
      </div>

      {isLoading ? <SkeletonTable rows={6} cols={5} /> : isError ? (
        <EmptyState icon={ClipboardList} title="Orders could not be loaded" description="Check the connection and try again." action={<Button size="sm" variant="secondary" onClick={refetch}>Retry</Button>} />
      ) : orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No matching orders" description="New orders will appear here automatically." />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {orders.map((order) => (
              <article key={order._id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-mono text-xs text-slate-400">{order.orderNumber}</p><h2 className="font-semibold text-slate-100">{order.customerInfo?.name || 'Customer'}</h2></div>
                  <p className="font-bold text-gold-400">{formatCurrency(order.pricing?.grandTotal || 0)}</p>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                  <Badge status={order.status}>{order.status?.replaceAll('_', ' ')}</Badge>
                  <span>{order.items?.length || 0} lines · {formatTimeAgo(order.createdAt)}</span>
                </div>
                <OrderResponsibility order={order} compact />
              </article>
            ))}
          </div>
          <div className="card p-0 overflow-hidden hidden md:block"><div className="overflow-x-auto">
            <table className="table min-w-[720px]"><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Status</th><th>Responsibility</th><th>Items</th><th>Total</th><th>Received</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order._id}>
                <td className="font-mono text-xs">{order.orderNumber}</td><td>{order.customerInfo?.name || 'Customer'}</td><td className="capitalize">{order.orderType?.replaceAll('_', ' ')}</td>
                <td><Badge status={order.status}>{order.status?.replaceAll('_', ' ')}</Badge></td><td><OrderResponsibility order={order} compact /></td><td>{order.items?.length || 0}</td><td className="font-semibold text-gold-400">{formatCurrency(order.pricing?.grandTotal || 0)}</td><td className="text-slate-500">{formatTimeAgo(order.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div></div>
        </>
      )}

      <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="orders" />
    </div>
  );
}
