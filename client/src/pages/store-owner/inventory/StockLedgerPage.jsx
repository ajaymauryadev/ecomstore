import Pagination from '../../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../../hooks/usePagination';
import { useSavedViewState } from '../../../offline/useSavedViewState';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, BookOpen } from 'lucide-react';
import { useGetStockLedgerQuery } from '../../../features/inventory/inventoryApi';
import { useGetProductQuery } from '../../../features/products/productApi';
import Spinner from '../../../components/ui/Spinner';
import { cn } from '../../../utils/cn';
import { ROUTES } from '../../../constants/routes';

const MOVEMENT_META = {
  PURCHASE_IN:          { label: 'Purchase In',          icon: '📦', color: 'text-emerald-400', bg: 'bg-emerald-500/10', dir: 'in' },
  ORDER_RESERVED:       { label: 'Order Reserved',        icon: '🔒', color: 'text-blue-400',    bg: 'bg-blue-500/10',    dir: 'out' },
  ORDER_SOLD:           { label: 'Order Sold',            icon: '✅', color: 'text-emerald-400', bg: 'bg-emerald-500/10', dir: 'out' },
  ORDER_CANCEL_RESTORE: { label: 'Order Cancelled',       icon: '↩️', color: 'text-slate-400',   bg: 'bg-slate-500/10',   dir: 'in' },
  DAMAGE_OUT:           { label: 'Damage Out',            icon: '🔴', color: 'text-red-400',     bg: 'bg-red-500/10',     dir: 'out' },
  ADJUSTMENT_ADD:       { label: 'Adjustment Add',        icon: '➕', color: 'text-emerald-400', bg: 'bg-emerald-500/10', dir: 'in' },
  ADJUSTMENT_REMOVE:    { label: 'Adjustment Remove',     icon: '➖', color: 'text-amber-400',   bg: 'bg-amber-500/10',   dir: 'out' },
  RETURN_IN:            { label: 'Return In',             icon: '↩️', color: 'text-emerald-400', bg: 'bg-emerald-500/10', dir: 'in' },
  PURCHASE_RETURN:      { label: 'Purchase Return',       icon: '🔙', color: 'text-red-400',     bg: 'bg-red-500/10',     dir: 'out' },
};

function formatDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export default function StockLedgerPage() {
  const { productId } = useParams();
  const [variantId, setVariantId] = useSavedViewState('variant-filter', '');
  const [movementType, setMovementType] = useSavedViewState('movement-filter', '');
  const { limit } = usePageSize('compact');
  const [page, setPage] = usePageState(limit);

  const { data: productData } = useGetProductQuery(productId);
  const { data, isLoading, isFetching } = useGetStockLedgerQuery({ productId, variantId, movementType, page, limit });

  const product = productData?.data?.product;
  const entries = data?.data?.entries || [];
  const meta = data?.meta || {};
  const variants = product?.variants || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Link to={ROUTES.STORE.INVENTORY} className="p-2 rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="page-title flex items-center gap-2">
              <BookOpen size={20} className="text-gold-400" />
              Stock Ledger
            </h1>
            {product && <p className="text-slate-400 text-sm mt-0.5">{product.name}</p>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={variantId}
          onChange={(e) => { setVariantId(e.target.value); setPage(1); }}
          className="input min-w-[150px]"
        >
          <option value="">All Variants</option>
          {variants.map((v) => (
            <option key={v._id} value={v._id}>{v.name}{v.isActive ? '' : ' (archived)'}</option>
          ))}
        </select>

        <select
          value={movementType}
          onChange={(e) => { setMovementType(e.target.value); setPage(1); }}
          className="input min-w-[180px]"
        >
          <option value="">All Movements</option>
          {Object.entries(MOVEMENT_META).map(([key, meta]) => (
            <option key={key} value={key}>{meta.icon} {meta.label}</option>
          ))}
        </select>
      </div>

      {/* Entries */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" className="text-gold-500" /></div>
      ) : entries.length === 0 ? (
        <div className="card p-12 text-center">
          <BookOpen size={40} strokeWidth={1} className="mx-auto text-navy-600 mb-3" />
          <p className="text-slate-400 font-medium">No ledger entries yet</p>
        </div>
      ) : (
        <div className="space-y-2" aria-busy={isFetching}>
          {entries.map((entry) => {
            const meta = MOVEMENT_META[entry.movementType] || {};
            const isIn = entry.quantityChange > 0;
            return (
              <div key={entry._id} className="card flex items-start gap-3 py-3 px-4">
                {/* Type badge */}
                <div className={cn('p-2 rounded-xl text-base shrink-0', meta.bg)}>
                  {meta.icon}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className={cn('text-sm font-semibold', meta.color)}>{meta.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {entry.reason && <span className="capitalize">{entry.reason.replace(/_/g, ' ')} · </span>}
                        {entry.note}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn('flex items-center gap-1 text-sm font-bold', isIn ? 'text-emerald-400' : 'text-red-400')}>
                        {isIn ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                        {isIn ? '+' : ''}{entry.quantityChange}
                      </div>
                      <p className="text-xs text-slate-500">{entry.balanceBefore} → <span className="text-slate-300 font-medium">{entry.balanceAfter}</span></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <p className="text-xs text-slate-500">{formatDate(entry.createdAt)}</p>
                    {entry.createdBy?.name && (
                      <p className="text-xs text-slate-600">by {entry.createdBy.name}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="stock entries" />
        </div>
      )}
    </div>
  );
}
