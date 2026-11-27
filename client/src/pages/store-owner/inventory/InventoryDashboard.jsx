import { useSavedViewState } from '../../../offline/useSavedViewState';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import Pagination from '../../../components/ui/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { useState } from 'react';
import { Package, AlertTriangle, TrendingUp, DollarSign, Search, ArrowUpDown } from 'lucide-react';
import { useGetInventoryDashboardQuery, useGetInventoryListQuery } from '../../../features/inventory/inventoryApi';
import { useGetCategoriesQuery } from '../../../features/categories/categoryApi';
import StockAdjustmentModal from '../../../components/inventory/StockAdjustmentModal';
import { formatCurrency } from '../../../utils/formatters';
import { cn } from '../../../utils/cn';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../../constants/routes';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';
import LoadError from '../../../components/ui/LoadError';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) {
  if (!url) return null;
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

function KpiCard({ icon, label, value, sub, color = 'gold' }) {
  const colorMap = {
    gold: 'text-gold-400',
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
  };
  return (
    <div className="kpi-card">
      <div className={cn('p-2.5 rounded-xl bg-navy-700/60 w-fit', colorMap[color])}>
        {icon}
      </div>
      <div className="mt-3">
        <p className="text-xs text-slate-400">{label}</p>
        <p className={cn('text-2xl font-bold mt-0.5', colorMap[color])}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function StockDot({ stock, lowStockLimit }) {
  if (stock <= 0) return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />;
  if (stock <= lowStockLimit) return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />;
}

export default function InventoryDashboard() {
  const { user } = useAuth();
  const canAdjust = hasPermission(user, PERMISSIONS.INVENTORY_ADJUST);
  const [search, setSearch] = useSavedViewState('InventoryDashboard:InventoryDashboard:search', '');
  const [categoryId, setCategoryId] = useSavedViewState('InventoryDashboard:InventoryDashboard:categoryId', '');
  const [stockStatus, setStockStatus] = useSavedViewState('stock-status', '');
  const settledSearch = useDebouncedValue(search.trim(), 250);
  const { page, setPage, limit } = usePagination(JSON.stringify([settledSearch, categoryId, stockStatus]), 'compact');
  const [adjustTarget, setAdjustTarget] = useState(null); // { product, variant }

  const { data: dashData, isLoading: dashLoading, isError: dashFailed, error: dashError, refetch: reloadDashboard } = useGetInventoryDashboardQuery();
  const { data: listData, isLoading: listLoading, isFetching, isError, error, refetch } = useGetInventoryListQuery({
    search: settledSearch, categoryId, stockStatus, page, limit,
  });
  const { data: catData } = useGetCategoriesQuery();

  const stats = dashData?.data?.stats || {};
  const products = listData?.data?.products || [];
  const meta = listData?.meta || {};
  const categories = catData?.data?.categories || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="text-slate-400 text-sm mt-0.5">Stock levels & adjustments</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={ROUTES.STORE.INVENTORY_LOW_STOCK}
            className="btn btn-secondary btn-sm gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
          >
            <AlertTriangle size={14} />
            Low Stock
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      {dashFailed ? <LoadError title="Could not load stock summary" error={dashError} retry={reloadDashboard} /> : dashLoading ? (
        <div aria-busy="true" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="kpi-card animate-pulse">
              <div className="w-10 h-10 bg-navy-700 rounded-xl" />
              <div className="mt-3 space-y-2">
                <div className="h-3 bg-navy-700 rounded w-2/3" />
                <div className="h-6 bg-navy-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <KpiCard icon={<Package size={18} />} label="Total Products" value={stats.totalProducts ?? 0} color="blue" />
          <KpiCard icon={<ArrowUpDown size={18} />} label="Total Variants" value={stats.totalVariants ?? 0} color="gold" />
          <KpiCard icon={<TrendingUp size={18} />} label="Stock Value" value={formatCurrency(stats.totalStockValue ?? 0)} sub="purchase cost" color="emerald" />
          <KpiCard icon={<AlertTriangle size={18} />} label="Low Stock" value={stats.lowStockCount ?? 0} sub="variants" color="amber" />
          <KpiCard icon={<DollarSign size={18} />} label="Out of Stock" value={stats.outOfStockCount ?? 0} sub="variants" color="red" />
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(10rem,1fr)_minmax(9rem,auto)_minmax(8rem,auto)]">
        <div className="relative col-span-2 min-w-0 md:col-span-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search products..."
            aria-label="Search inventory"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="input pl-8 w-full"
          />
        </div>

        <select
          value={categoryId}
          aria-label="Filter inventory by category"
          onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}
          className="input min-w-0"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>{c.emoji} {c.name}</option>
          ))}
        </select>

        <select
          value={stockStatus}
          aria-label="Filter by stock status"
          onChange={(e) => { setStockStatus(e.target.value); setPage(1); }}
          className="input min-w-0"
        >
          <option value="">All Stock</option>
          <option value="in_stock">In Stock</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
        </select>
      </div>

      {/* Table */}
      {isError ? <LoadError title="Could not load inventory" error={error} retry={refetch} /> : listLoading ? (
        <div className="flex justify-center py-12" role="status" aria-label="Loading inventory"><Spinner size="lg" className="text-gold-500" /></div>
      ) : products.length === 0 ? (
        <div className="card p-12 text-center">
          <Package size={40} strokeWidth={1} className="mx-auto text-navy-600 mb-3" />
          <p className="text-slate-400 font-medium">No products found</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden" aria-busy={isFetching}>
          <div className="workspace-table-scroll" role="region" aria-label="Inventory list" tabIndex={0}>
            <table className="table workspace-list md:min-w-[760px]" role="table">
              <thead>
                <tr>
                  {['Product', 'Category', 'Variant', 'Unit', 'Stock', 'Value', 'Status'].map((heading) => <th key={heading} scope="col">{heading}</th>)}
                  {canAdjust && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((product) =>
                  product.variants
                    ?.filter((v) => v.isActive || !stockStatus)
                    .map((variant) => (
                      <tr key={`${product._id}_${variant._id}`} className="hover:bg-navy-700/10 transition-colors">
                        <td className="workspace-list-wide">
                          <div className="flex items-center gap-2.5">
                            {product.mainImage ? (
                              <img src={imgSrc(product.mainImage)} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-lg bg-navy-700 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-200">{product.name}</p>
                              {product.brand && <p className="text-xs text-slate-500 truncate">{product.brand}</p>}
                            </div>
                          </div>
                        </td>
                        <td data-label="Category">
                          <span className="text-sm text-slate-400">
                            {product.categoryId ? `${product.categoryId.emoji ?? ''} ${product.categoryId.name}` : '—'}
                          </span>
                        </td>
                        <td data-label="Variant"><span className="text-sm text-slate-300">{variant.name}</span></td>
                        <td data-label="Unit"><span className="text-sm text-slate-500">{variant.unit}</span></td>
                        <td data-label="Stock">
                          <div className="flex items-center gap-1.5">
                            <StockDot stock={variant.stock} lowStockLimit={variant.lowStockLimit} />
                            <span className={cn(
                              'text-sm font-bold',
                              variant.stock <= 0 ? 'text-red-400' :
                              variant.stock <= variant.lowStockLimit ? 'text-amber-400' : 'text-slate-200'
                            )}>
                              {variant.stock}
                            </span>
                          </div>
                        </td>
                        <td data-label="Value">
                          <span className="text-sm text-slate-300">
                            {formatCurrency((variant.purchasePrice || variant.retailPrice) * variant.stock)}
                          </span>
                        </td>
                        <td data-label="Status">
                          {!variant.isActive ? (
                            <Badge status="inactive">Archived</Badge>
                          ) : variant.stock <= 0 ? (
                            <Badge status="inactive">Out of Stock</Badge>
                          ) : variant.stock <= variant.lowStockLimit ? (
                            <Badge variant="warning">Low</Badge>
                          ) : (
                            <Badge status="active">OK</Badge>
                          )}
                        </td>
                        {canAdjust && <td className="workspace-list-wide">
                          <button
                            onClick={() => setAdjustTarget({ product, variant })}
                            aria-label={`Adjust stock for ${product.name} ${variant.name}`}
                            className="workspace-row-action px-2 text-sm font-semibold text-gold-400"
                          >
                            Adjust
                          </button>
                        </td>}
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="variants" />
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
