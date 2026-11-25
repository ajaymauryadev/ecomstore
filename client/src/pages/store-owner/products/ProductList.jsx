import Pagination from '../../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../../hooks/usePagination';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Search, Filter, Edit2, Trash2, Eye, EyeOff,
  Package, AlertTriangle, ToggleLeft, ToggleRight, Star, LayoutGrid, List,
} from 'lucide-react';
import {
  useGetProductsQuery,
  useDeleteProductMutation,
  useToggleProductFieldMutation,
} from '../../../features/products/productApi';
import { useGetCategoriesQuery } from '../../../features/categories/categoryApi';
import Button from '../../../components/ui/Button';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import Modal from '../../../components/ui/Modal';
import { formatCurrency } from '../../../utils/formatters';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';
import LoadError from '../../../components/ui/LoadError';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';
import ProductImport from '../../../components/products/ProductImport';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

function StockIndicator({ status }) {
  const map = {
    in_stock: 'bg-emerald-500',
    low_stock: 'bg-amber-500',
    out_of_stock: 'bg-red-500',
    inactive: 'bg-navy-500',
  };
  return <span className={cn('w-2 h-2 rounded-full shrink-0', map[status] || 'bg-navy-500')} title={status?.replace('_', ' ')} />;
}

function PriceDisplay({ product }) {
  const active = product.variants?.filter((v) => v.isActive) || [];
  if (!active.length) return <span className="text-slate-500 text-xs">No variants</span>;
  const prices = active.map((v) => v.offerPrice ?? v.retailPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return <span className="text-sm font-semibold text-slate-200">{formatCurrency(min)}</span>;
  return (
    <span className="text-sm font-semibold text-slate-200">
      {formatCurrency(min)} – {formatCurrency(max)}
    </span>
  );
}

function CatalogCard({ product, canEdit, canDelete, onToggle, onDelete }) {
  const image = product.images?.find((entry) => entry.isMain)?.url || product.images?.[0]?.url;
  const variants = product.variants?.filter((variant) => variant.isActive) || [];
  const stock = variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
  return <article className="catalog-card">
    <div className="catalog-card-image relative">
      {image ? <img src={image.startsWith('/') ? API_BASE + image : image} alt={product.name} loading="lazy" /> : <Package size={42} className="text-navy-500" aria-hidden="true" />}
      <span className={cn('absolute top-3 left-3 rounded-lg border px-2 py-1 text-xs font-semibold', product.isActive ? 'bg-white border-navy-700 text-emerald-400' : 'bg-white border-navy-700 text-slate-500')}>{product.isActive ? 'Active' : 'Inactive'}</span>
      {product.isFeatured && <span className="absolute top-3 right-3 rounded-lg bg-amber-100 p-1.5 text-amber-800" aria-label="Featured"><Star size={15} fill="currentColor" /></span>}
    </div>
    <div className="p-4 flex-1 flex flex-col gap-3">
      <div><p className="text-xs text-slate-500 break-words">{product.categoryId?.name || 'Uncategorised'}{product.brand && ` · ${product.brand}`}</p><h2 className="font-semibold text-base leading-snug break-words mt-1">{product.name}</h2></div>
      <div className="flex flex-wrap items-end justify-between gap-2 mt-auto"><div><p className="text-xs text-slate-500 mb-1">Selling price</p><PriceDisplay product={product} /></div><p className="text-xs text-slate-500">{variants.length} variant{variants.length === 1 ? '' : 's'}</p></div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-750 border border-navy-700 p-3 text-sm"><span className="flex items-center gap-2"><StockIndicator status={product.stockStatus} /><span className={stock ? 'text-slate-400' : 'text-red-400'}>{stock ? `${stock} in stock` : 'Out of stock'}</span></span><span className="text-xs text-slate-500">{product.isOnline ? 'Online' : 'Counter only'}</span></div>
    </div>
    {(canEdit || canDelete) && <footer className="flex flex-wrap gap-1 items-center justify-between border-t border-navy-700 px-3 py-2">
      {canEdit && <Link to={`/store/products/${product._id}/edit`} className="workspace-link px-1"><Edit2 size={15} aria-hidden="true" /> Edit product</Link>}
      <div className="flex gap-1">
        {canEdit && <><button type="button" className="workspace-row-action text-slate-400" aria-label={`Storefront visibility for ${product.name}`} aria-pressed={product.isOnline} title={product.isOnline ? 'Hide from storefront' : 'Show on storefront'} onClick={() => onToggle(product._id, 'isOnline')}>{product.isOnline ? <Eye size={17} /> : <EyeOff size={17} />}</button><button type="button" className="workspace-row-action text-slate-400" aria-label={`Active status for ${product.name}`} aria-pressed={product.isActive} title={product.isActive ? 'Deactivate product' : 'Activate product'} onClick={() => onToggle(product._id, 'isActive')}>{product.isActive ? <ToggleRight size={19} /> : <ToggleLeft size={19} />}</button></>}
        {canDelete && <button type="button" className="workspace-row-action text-red-400" aria-label={`Delete ${product.name}`} onClick={() => onDelete(product)}><Trash2 size={16} /></button>}
      </div>
    </footer>}
  </article>;
}

export default function ProductList() {
  const { user } = useAuth();
  const canEdit = hasPermission(user, PERMISSIONS.PRODUCTS_EDIT);
  const canCreate = hasPermission(user, PERMISSIONS.PRODUCTS_CREATE);
  const canDelete = hasPermission(user, PERMISSIONS.PRODUCTS_DELETE);
  const canViewCategories = hasPermission(user, PERMISSIONS.CATEGORIES_VIEW);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isActive, setIsActive] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [view, setView] = useState('cards');
  const { limit, contentRef } = usePageSize(view === 'cards' ? 'products' : 'compact');
  const [page, setPage] = usePageState(limit);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data, isLoading, isFetching, isError, error, refetch } = useGetProductsQuery({
    page,
    limit,
    ...(search && { search }),
    ...(categoryId && { categoryId }),
    ...(isActive !== '' && { isActive }),
    ...(lowStock && { lowStock: 'true' }),
  });

  const { data: catData } = useGetCategoriesQuery(undefined, { skip: !canViewCategories });
  const [deleteProduct, { isLoading: isDeleting }] = useDeleteProductMutation();
  const [toggleField] = useToggleProductFieldMutation();

  const products = data?.data || [];
  const meta = data?.meta || {};
  const categories = catData?.data?.categories || [];

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleToggle = async (id, field) => {
    try {
      await toggleField({ id, field }).unwrap();
      toast.success('Product updated');
    } catch {
      toast.error('Update failed');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProduct(deleteTarget._id).unwrap();
      toast.success('Product deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {meta.total ?? '—'} products in your store
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-w-full">
          <div className="flex border border-navy-700 rounded-xl bg-navy-800 p-1" aria-label="Product view">
            <button type="button" aria-label="Card view" aria-pressed={view === 'cards'} className={cn('workspace-row-action', view === 'cards' && 'bg-gold-500/10 text-gold-400')} onClick={() => setView('cards')}><LayoutGrid size={17} /></button>
            <button type="button" aria-label="List view" aria-pressed={view === 'list'} className={cn('workspace-row-action', view === 'list' && 'bg-gold-500/10 text-gold-400')} onClick={() => setView('list')}><List size={17} /></button>
          </div>
          {canViewCategories && <Link to="/store/categories" className="btn-secondary btn-sm"><Filter size={14} /> Categories</Link>}
          {canCreate && <Link to="/store/products/new" className="btn-primary btn-sm"><Plus size={14} /> Add Product</Link>}
          {canCreate && <ProductImport onImported={() => setPage(1)} />}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-48 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={searchInput}
              aria-label="Search products"
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name, brand, SKU, barcode..."
              className="input pl-9 h-9 text-sm"
            />
          </div>

          <select
            value={categoryId}
            aria-label="Filter by category"
            onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}
            className="input h-9 text-sm w-44"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>{c.emoji} {c.name}</option>
            ))}
          </select>

          <select
            value={isActive}
            aria-label="Filter by product status"
            onChange={(e) => { setIsActive(e.target.value); setPage(1); }}
            className="input h-9 text-sm w-36"
          >
            <option value="">All Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-400 hover:text-amber-400 transition-colors">
            <input
              type="checkbox"
              checked={lowStock}
              onChange={(e) => { setLowStock(e.target.checked); setPage(1); }}
              className="accent-amber-500"
            />
            <AlertTriangle size={14} className="text-amber-400" />
            Low Stock
          </label>

          <Button type="submit" size="sm" variant="secondary">Search</Button>
        </form>
      </div>

      {/* Table */}
      {isError ? <LoadError title="Could not load products" error={error} retry={refetch} /> : isLoading ? (
        <div role="status" aria-label="Loading products"><SkeletonTable /></div>
      ) : products.length === 0 ? (
        <div className="card p-8 text-center">
          <Package size={48} strokeWidth={1} className="text-navy-600 mx-auto mb-4" />
          <p className="text-slate-400 font-medium">No products found</p>
          <p className="text-slate-500 text-sm mt-1">
            {search ? 'Try a different search term' : 'Add your first product to get started'}
          </p>
          {!search && canCreate && (
            <Link to="/store/products/new" className="btn-primary btn-sm mt-4"><Plus size={14} /> Add First Product</Link>
          )}
        </div>
      ) : view === 'cards' ? (
        <div ref={contentRef} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-busy={isFetching}>
          {products.map((product) => <CatalogCard key={product._id} product={product} canEdit={canEdit} canDelete={canDelete} onToggle={handleToggle} onDelete={setDeleteTarget} />)}
        </div>
      ) : (
        <div ref={contentRef} className="table-container relative" aria-busy={isFetching}>
          {isFetching && (
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-gold animate-pulse" />
          )}
          <div className="workspace-table-scroll" role="region" aria-label="Product list" tabIndex={0}>
          <table className="table workspace-list md:min-w-[820px]" role="table">
            <thead>
              <tr>
                {['Product', 'Category', 'Variants', 'Price', 'Stock', 'Online', 'Status'].map((heading) => <th key={heading} scope="col">{heading}</th>)}
                {(canEdit || canDelete) && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const mainImg = product.images?.find((i) => i.isMain)?.url ?? product.images?.[0]?.url;
                const imgSrc = mainImg?.startsWith('/') ? `${API_BASE}${mainImg}` : mainImg;
                const activeVariants = product.variants?.filter((v) => v.isActive) || [];
                const totalStock = activeVariants.reduce((s, v) => s + (v.stock || 0), 0);

                return (
                  <tr key={product._id}>
                    <td className="workspace-list-wide">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-navy-700 overflow-hidden shrink-0">
                          {imgSrc ? (
                            <img src={imgSrc} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package size={16} className="text-navy-500" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-200 break-words">{product.name}</p>
                            {product.isFeatured && <Star size={12} className="text-gold-400 shrink-0" fill="currentColor" />}
                          </div>
                          {product.brand && <p className="text-xs text-slate-500 truncate">{product.brand}</p>}
                        </div>
                      </div>
                    </td>
                    <td data-label="Category">
                      {product.categoryId ? (
                        <span className="text-sm text-slate-300">
                          {product.categoryId.emoji} {product.categoryId.name}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-sm">—</span>
                      )}
                    </td>
                    <td data-label="Variants">
                      <span className="text-sm text-slate-300">{activeVariants.length}</span>
                      {product.variants?.length > activeVariants.length && (
                        <span className="text-xs text-slate-500 ml-1">/{product.variants.length}</span>
                      )}
                    </td>
                    <td data-label="Price">
                      <PriceDisplay product={product} />
                    </td>
                    <td data-label="Stock">
                      <div className="flex items-center gap-2">
                        <StockIndicator status={product.stockStatus} />
                        <span className="text-sm text-slate-300">{totalStock}</span>
                        {product.stockStatus === 'low_stock' && (
                          <AlertTriangle size={12} className="text-amber-400" />
                        )}
                      </div>
                    </td>
                    <td data-label="Online">
                      {canEdit ? <button
                        onClick={() => handleToggle(product._id, 'isOnline')}
                        aria-label={`Storefront visibility for ${product.name}`} aria-pressed={product.isOnline}
                        className={cn('workspace-row-action gap-2 px-2 text-sm', product.isOnline ? 'text-blue-400' : 'text-slate-600')}
                      >
                        {product.isOnline ? <Eye size={16} /> : <EyeOff size={16} />}
                        <span>{product.isOnline ? 'Visible' : 'Hidden'}</span>
                      </button> : <span>{product.isOnline ? 'Visible' : 'Hidden'}</span>}
                    </td>
                    <td data-label="Status">
                      {canEdit ? <button
                        onClick={() => handleToggle(product._id, 'isActive')}
                        aria-label={`Active status for ${product.name}`} aria-pressed={product.isActive}
                        className={cn('workspace-row-action gap-2 px-2 text-sm', product.isActive ? 'text-emerald-400' : 'text-slate-600')}
                      >
                        {product.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        <span>{product.isActive ? 'Active' : 'Inactive'}</span>
                      </button> : <span>{product.isActive ? 'Active' : 'Inactive'}</span>}
                    </td>
                    {(canEdit || canDelete) && <td className="workspace-list-wide">
                      <div className="flex items-center gap-1">
                        {canEdit && <Link to={`/store/products/${product._id}/edit`} aria-label={`Edit ${product.name}`} className="workspace-row-action text-gold-400">
                          <Edit2 size={17} />
                        </Link>}
                        {canDelete && <button
                          onClick={() => setDeleteTarget(product)}
                          aria-label={`Delete ${product.name}`} className="workspace-row-action text-red-400"
                        >
                          <Trash2 size={17} />
                        </button>}
                      </div>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="products" />

      {/* Delete confirm modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Product" size="sm">
        <p className="text-slate-300 text-sm">
          Are you sure you want to delete <strong className="text-slate-100">&quot;{deleteTarget?.name}&quot;</strong>?
          This action cannot be undone.
        </p>
        <div className="flex gap-3 mt-5">
          <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" fullWidth isLoading={isDeleting} onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
