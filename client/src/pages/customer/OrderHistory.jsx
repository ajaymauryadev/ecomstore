import Pagination from '../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../hooks/usePagination';
import { Link, useParams } from 'react-router-dom';
import { ShoppingBag, ChevronRight, ArrowLeft } from 'lucide-react';
import { useGetOrdersQuery } from '../../features/orders/orderApi';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import Spinner from '../../components/ui/Spinner';
import LoadError from '../../components/ui/LoadError';

const STATUS_META = {
  pending:          { label: 'Pending',        color: 'text-gold-400',    dot: 'bg-gold-400' },
  payment_pending: { label: 'Awaiting payment', color: 'text-amber-400', dot: 'bg-amber-400' },
  payment_submitted: { label: 'Payment submitted', color: 'text-blue-400', dot: 'bg-blue-400' },
  payment_verified: { label: 'Payment verified', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  accepted: { label: 'Accepted', color: 'text-blue-400', dot: 'bg-blue-400' },
  packing: { label: 'Being packed', color: 'text-amber-400', dot: 'bg-amber-400' },
  packed: { label: 'Packed', color: 'text-amber-400', dot: 'bg-amber-400' },
  ready_for_pickup: { label: 'Ready for pickup', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  partially_fulfilled: { label: 'Partially fulfilled', color: 'text-amber-400', dot: 'bg-amber-400' },
  rejected: { label: 'Rejected', color: 'text-red-400', dot: 'bg-red-400' },
  confirmed:        { label: 'Confirmed',       color: 'text-blue-400',    dot: 'bg-blue-400' },
  preparing:        { label: 'Preparing',       color: 'text-amber-400',   dot: 'bg-amber-400' },
  ready:            { label: 'Ready',           color: 'text-emerald-400', dot: 'bg-emerald-400' },
  out_for_delivery: { label: 'On the way',      color: 'text-purple-400',  dot: 'bg-purple-400' },
  delivered:        { label: 'Delivered',       color: 'text-emerald-400', dot: 'bg-emerald-400' },
  cancelled:        { label: 'Cancelled',       color: 'text-red-400',     dot: 'bg-red-400' },
};

const ORDER_TYPE_LABELS = {
  home_delivery: '🚚 Delivery', self_pickup: '🏪 Pickup',
  online: '🌐 Online', counter: '🧾 Counter', wholesale: '📦 Wholesale',
};

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OrderHistory() {
  const { storeSlug } = useParams();
  const { limit } = usePageSize('cards');
  const [page, setPage] = usePageState(limit);
  const { data, isLoading, isFetching, isError, error, refetch } = useGetOrdersQuery({ slug: storeSlug, page, limit });

  const orders = data?.data || [];
  const meta = data?.meta || {};

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Spinner size="lg" className="text-gold-500" />
    </div>
  );

  if (isError) return <LoadError title="Orders could not be loaded" error={error} retry={refetch} />;

  return (
    <div className="max-w-4xl mx-auto animate-fade-in space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <Link to={`/s/${storeSlug}/account`} aria-label="Back to account" className="workspace-row-action rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-100">My Orders</h1>
          <p className="text-xs text-slate-400">{meta.total ?? 0} total orders</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-slate-500">
          <ShoppingBag size={56} strokeWidth={1} />
          <p className="font-medium text-slate-400">No orders yet</p>
          <Link to={`/s/${storeSlug}`} className="btn btn-primary btn-sm">Start Shopping</Link>
        </div>
      ) : (
        <div className={cn('space-y-3', isFetching && 'opacity-75')}>
          {orders.map((order) => {
            const sm = STATUS_META[order.status] || {};
            return (
              <Link
                key={order._id}
                to={`/s/${storeSlug}/orders/${order._id}`}
                className="card hover:border-navy-600 transition-all block"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-mono text-slate-400">{order.orderNumber}</p>
                      <span className="text-xs text-slate-500">{ORDER_TYPE_LABELS[order.orderType]}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-200 mt-1">
                      {order.items?.length} item{order.items?.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(order.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gold-400">{formatCurrency(order.pricing?.grandTotal)}</p>
                    <div className="flex items-center gap-1.5 justify-end mt-1">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', sm.dot)} />
                      <span className={cn('text-xs font-medium', sm.color)}>{sm.label}</span>
                    </div>
                  </div>
                </div>

                {/* Item thumbnails */}
                {order.items?.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-3">
                    {order.items.slice(0, 4).map((item, i) => (
                      <div key={i} className="text-xs text-slate-400 bg-navy-700 rounded-lg px-2 py-1 line-clamp-1 max-w-[100px]">
                        {item.name}
                      </div>
                    ))}
                    {order.items.length > 4 && (
                      <span className="text-xs text-slate-500">+{order.items.length - 4} more</span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-1 mt-2 text-xs text-slate-500">
                  View details <ChevronRight size={12} />
                </div>
              </Link>
            );
          })}

          <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="orders" />
        </div>
      )}
    </div>
  );
}
