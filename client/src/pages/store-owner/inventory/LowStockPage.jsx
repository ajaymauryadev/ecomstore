import { useEffect, useState, useMemo } from 'react';
import { AlertTriangle, Package, ArrowLeft } from 'lucide-react';
import { useGetLowStockProductsQuery } from '../../../features/inventory/inventoryApi';
import StockAdjustmentModal from '../../../components/inventory/StockAdjustmentModal';
import Spinner from '../../../components/ui/Spinner';
import { Link, useSearchParams } from 'react-router-dom';
import { ROUTES } from '../../../constants/routes';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) {
  if (!url) return null;
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

export default function LowStockPage() {
  const { data, isLoading, refetch } = useGetLowStockProductsQuery();
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const products = useMemo(() => data?.data?.products || [], [data?.data?.products]);

  useEffect(() => {
    if (!products.length || adjustTarget) return;
    const productId = searchParams.get('productId');
    const variantId = searchParams.get('variantId');
    if (!productId || !variantId) return;
    const product = products.find((item) =>
      item._id === productId && item.variant?._id === variantId);
    if (product) setAdjustTarget({ product, variant: product.variant });
    setSearchParams({}, { replace: true });
  }, [products, adjustTarget, searchParams, setSearchParams]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Link to={ROUTES.STORE.INVENTORY} aria-label="Back to inventory" className="workspace-row-action rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="page-title flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-400" />
              Low Stock Alert
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">{products.length} variant(s) running low</p>
          </div>
        </div>
        <button onClick={refetch} className="btn btn-secondary btn-sm">Refresh</button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" className="text-gold-500" /></div>
      ) : products.length === 0 ? (
        <div className="card p-12 text-center">
          <Package size={40} strokeWidth={1} className="mx-auto text-emerald-500 mb-3" />
          <p className="text-slate-300 font-medium">All stocked up! 🎉</p>
          <p className="text-slate-500 text-sm mt-1">No low stock variants right now</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {products.map((item, idx) => {
            const variant = item.variant;
            const stockPct = Math.min(100, (variant.stock / variant.lowStockLimit) * 100);
            return (
              <div
                key={`${item._id}_${variant._id}_${idx}`}
                className="flex items-center gap-4 px-4 py-3.5 border-b border-navy-700/40 last:border-0 hover:bg-navy-700/10 transition-colors"
              >
                {/* Image */}
                {item.images?.[0]?.url ? (
                  <img src={imgSrc(item.images[0].url)} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-navy-700 shrink-0 flex items-center justify-center">
                    <Package size={16} className="text-navy-500" />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {item.category?.emoji} {item.category?.name} · {variant.name} · {variant.unit}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-amber-400">{variant.stock} left</p>
                      <p className="text-xs text-slate-500">limit: {variant.lowStockLimit}</p>
                    </div>
                  </div>

                  {/* Stock bar */}
                  <div className="mt-2 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all"
                      style={{ width: `${stockPct}%` }}
                    />
                  </div>
                </div>

                {/* Action */}
                <button
                  onClick={() => setAdjustTarget({ product: item, variant })}
                  className="btn btn-sm bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 shrink-0"
                >
                  Restock
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustTarget && (
        <StockAdjustmentModal
          isOpen={!!adjustTarget}
          onClose={() => setAdjustTarget(null)}
          product={adjustTarget.product}
          variant={adjustTarget.variant}
        />
      )}
    </div>
  );
}
