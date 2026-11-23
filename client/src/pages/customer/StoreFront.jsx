import { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { ShoppingCart, Plus, Minus, Flame, Star, AlertTriangle, Tag, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { useGetPublicProductsQuery } from '../../features/products/productApi';
import { useGetPublicCategoriesQuery } from '../../features/categories/categoryApi';
import { useCart } from '../../hooks/useCart';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import Spinner from '../../components/ui/Spinner';
import CategoryBrowser from '../../components/products/CategoryBrowser';
import CatalogFilters from '../../components/products/CatalogFilters';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

function imgSrc(url) {
  if (!url) return null;
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

/* ─── Variant Selector ─────────────────────────────────── */
function VariantSelector({ variants, selected, onSelect }) {
  const active = variants.filter((v) => v.isActive);
  if (active.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {active.map((v) => (
        <button
          key={v._id}
          type="button"
          aria-pressed={selected?._id === v._id}
          onClick={(e) => { e.stopPropagation(); onSelect(v); }}
          className={cn(
            'min-h-9 px-2 py-1 text-xs font-semibold rounded-lg border transition-all duration-150',
            selected?._id === v._id
              ? 'bg-gold-500/15 border-gold-500/50 text-gold-400'
              : v.stock <= 0
              ? 'bg-navy-800 border-navy-700 text-slate-600 cursor-not-allowed'
              : 'bg-navy-800 border-navy-700 text-slate-400 hover:border-navy-500 hover:text-slate-300'
          )}
          disabled={v.stock <= 0}
        >
          {v.name}
          {v.stock <= 0 && <span className="ml-0.5 text-[9px]"> OOS</span>}
        </button>
      ))}
    </div>
  );
}

/* ─── Add / Qty control ────────────────────────────────── */
function CartControl({ product, variant }) {
  const { getItemQuantity, addItem, updateQuantity } = useCart();
  const cartKey = `${product._id}_${variant._id}`;
  const qty = getItemQuantity(cartKey);
  const outOfStock = variant.stock <= 0;

  const cartItem = {
    _id: cartKey,
    productId: product._id,
    variantId: variant._id,
    name: product.name,
    variantName: variant.name,
    image: imgSrc(product.mainImage),
    price: variant.offerPrice ?? variant.retailPrice,
    mrp: variant.retailPrice,
    stock: variant.stock,
    unit: variant.unit,
  };

  if (outOfStock) {
    return (
      <span className="text-[11px] font-semibold text-slate-600 bg-navy-700 px-2 py-1.5 rounded-xl">
        Out of Stock
      </span>
    );
  }

  if (qty === 0) {
    return (
      <button
        type="button"
        aria-label={`Add ${product.name} to cart`}
        onClick={(e) => { e.stopPropagation(); addItem(cartItem); }}
        className="w-11 h-11 rounded-xl bg-gold-500 text-white flex items-center justify-center hover:brightness-110 active:scale-90 transition-all duration-150 shadow-sm"
      >
        <Plus size={16} />
      </button>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-0 w-full max-w-36"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Decrease quantity of ${product.name}`}
        onClick={() => updateQuantity(cartKey, qty - 1)}
        className="w-11 h-11 rounded-xl bg-navy-700 hover:bg-navy-600 flex items-center justify-center text-slate-300 transition-colors"
      >
        <Minus size={12} />
      </button>
      <span className="text-sm font-bold text-gold-400 w-5 text-center select-none">{qty}</span>
      <button
        type="button"
        aria-label={`Increase quantity of ${product.name}`}
        onClick={() => qty < variant.stock && updateQuantity(cartKey, qty + 1)}
        disabled={qty >= variant.stock}
        className="w-11 h-11 rounded-xl bg-gold-500/10 hover:bg-gold-500/20 disabled:opacity-40 flex items-center justify-center text-gold-400 transition-colors"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

/* ─── Product Card ──────────────────────────────────────── */
function ProductCard({ product }) {
  const { storeSlug } = useParams();
  const activeVariants = useMemo(() => product.variants?.filter((v) => v.isActive) || [], [product.variants]);
  const defaultVariant = activeVariants.find((v) => v.stock > 0) ?? activeVariants[0];
  const [selectedVariant, setSelectedVariant] = useState(defaultVariant);

  useEffect(() => {
    const inStock = activeVariants.find((v) => v.stock > 0) ?? activeVariants[0];
    setSelectedVariant(inStock);
  }, [product._id, activeVariants]);

  if (!selectedVariant || !activeVariants.length) return null;

  const mainImg = imgSrc(product.mainImage);
  const retail = selectedVariant.retailPrice;
  const offer = selectedVariant.offerPrice;
  const price = offer ?? retail;
  const discount = offer && retail > offer ? Math.round(((retail - offer) / retail) * 100) : null;
  const isLowStock = selectedVariant.stock > 0 && selectedVariant.stock <= selectedVariant.lowStockLimit;

  return (
    <article className="storefront-product bg-navy-800 rounded-2xl border border-navy-700/60 hover:border-navy-600 hover:shadow-card overflow-hidden transition-all duration-200 flex flex-col min-w-0">
      {/* Image — clicking goes to product detail */}
      <Link to={`/s/${storeSlug}/p/${product._id}`} aria-label={`View ${product.name}`} className="relative aspect-square bg-navy-750 overflow-hidden block">
        {mainImg ? (
          <img src={mainImg} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-navy-700/50">
            <ShoppingCart size={28} strokeWidth={1} className="text-navy-500" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {discount && (
            <span className="bg-gold-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md leading-none">
              {discount}% OFF
            </span>
          )}
          {isLowStock && (
            <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 leading-none">
              <AlertTriangle size={8} /> {selectedVariant.stock} left
            </span>
          )}
        </div>

        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {product.isFeatured && (
            <span className="bg-navy-900/80 backdrop-blur-sm text-gold-400 text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 border border-gold-500/20 leading-none">
              <Star size={8} fill="currentColor" /> Top
            </span>
          )}
        </div>

        {selectedVariant.stock <= 0 && (
          <div className="absolute inset-0 bg-navy-900/70 flex items-center justify-center">
            <span className="bg-navy-800 text-slate-400 text-xs font-bold px-3 py-1.5 rounded-xl border border-navy-600">
              Out of Stock
            </span>
          </div>
        )}
      </Link>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex-1 min-h-0">
          <p className="text-[11px] text-slate-500 leading-tight">
            {product.categoryId?.emoji} {product.brand || product.categoryId?.name || ''}
          </p>
          <Link to={`/s/${storeSlug}/p/${product._id}`} className="text-base font-semibold text-slate-200 leading-snug mt-1 line-clamp-2 break-words hover:text-gold-400 transition-colors block">
            {product.name}
          </Link>

          {/* Variant selector */}
          <VariantSelector
            variants={activeVariants}
            selected={selectedVariant}
            onSelect={setSelectedVariant}
          />
        </div>

        {/* Price + Add */}
        <div className="flex flex-wrap items-end justify-between gap-2 mt-auto pt-1">
          <div>
            <p className="font-bold text-slate-100 leading-tight">{formatCurrency(price)}</p>
            {discount && (
              <p className="text-[11px] text-slate-500 line-through leading-tight">{formatCurrency(retail)}</p>
            )}
          </div>
          <CartControl product={product} variant={selectedVariant} />
        </div>
      </div>
    </article>
  );
}

/* ─── Skeleton card ─────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="bg-navy-800 rounded-2xl border border-navy-700/40 overflow-hidden animate-pulse">
      <div className="aspect-square bg-navy-700" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-navy-700 rounded w-1/3" />
        <div className="h-4 bg-navy-700 rounded w-4/5" />
        <div className="h-3 bg-navy-700 rounded w-2/3" />
        <div className="flex justify-between mt-2">
          <div className="h-5 bg-navy-700 rounded w-1/4" />
          <div className="w-8 h-8 bg-navy-700 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/* ─── Main StoreFront ───────────────────────────────────── */
function ProductResults({ storeSlug, filters, title, onReset, hasFilters }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState({});
  const { currentData, isFetching, isError, refetch } = useGetPublicProductsQuery({ slug: storeSlug, page, limit: 24, ...filters });
  useEffect(() => {
    if (currentData) setPages((previous) => ({ ...previous, [page]: currentData }));
  }, [currentData, page]);
  const latest = currentData || pages[page - 1];
  const meta = latest?.meta || {};
  const products = useMemo(() => [...new Map(Object.entries({ ...pages, ...(currentData && { [page]: currentData }) })
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([, result]) => result.data || []).map((product) => [product._id, product])).values()], [pages, currentData, page]);

  return (
    <section aria-label="Product results" aria-busy={isFetching} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-slate-100 break-words min-w-0">{title}</h2>
        <p role="status" className="text-xs text-slate-500 shrink-0">{isFetching ? 'Loading…' : `${meta.total ?? 0} product${meta.total === 1 ? '' : 's'}`}</p>
      </div>
      {isError ? <div role="alert" className="card p-6 text-center">
        <AlertTriangle size={32} className="mx-auto text-amber-400" aria-hidden="true" />
        <h3 className="font-semibold text-slate-100 mt-3">Products could not be loaded</h3>
        <button type="button" onClick={refetch} className="btn btn-secondary btn-sm min-h-11 mt-4">Try again</button>
      </div> : isFetching && !products.length ? <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, index) => <SkeletonCard key={index} />)}
      </div> : !products.length ? <div className="flex flex-col items-center text-center py-12 text-slate-500">
        <ShoppingCart size={40} strokeWidth={1} className="mb-3" aria-hidden="true" />
        <p className="font-medium">{hasFilters ? 'No products match your search and filters' : 'No products here yet'}</p>
        {hasFilters && <><p className="text-sm mt-1">Try another category or clear your filters.</p>
          <button type="button" onClick={onReset} className="btn btn-secondary min-h-11 mt-4">Clear all filters</button></>}
      </div> : <>
        <div className={cn('grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3', isFetching && 'opacity-80')}>
          {products.map((product) => <ProductCard key={product._id} product={product} />)}
        </div>
        {meta.hasNextPage && <button type="button" disabled={isFetching} onClick={() => setPage((value) => value + 1)}
          className="w-full btn btn-secondary btn-md gap-2 border-dashed min-h-11">
          {isFetching ? <Spinner size="sm" /> : <ChevronDown size={16} />} Load more products
        </button>}
      </>}
    </section>
  );
}

export default function StoreFront({ showCategories = false }) {
  const navigate = useNavigate();
  const { storeSlug } = useParams();
  const { store } = useOutletContext() || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const search = (searchParams.get('q') || '').trim();
  const activeCategoryId = searchParams.get('cat') || 'all';
  const sort = ['price_asc', 'price_desc', 'newest', 'name'].includes(searchParams.get('sort')) ? searchParams.get('sort') : 'recommended';
  const flags = ['inStock', 'offer', 'featured'];
  const filters = {
    ...(search && { search }),
    ...(activeCategoryId !== 'all' && { categoryId: activeCategoryId }),
    ...(sort !== 'recommended' && { sort }),
    ...Object.fromEntries(flags.filter((flag) => searchParams.get(flag) === 'true').map((flag) => [flag, 'true'])),
  };
  const { data: catData, isLoading: catLoading, isError: catError, refetch: refetchCategories } = useGetPublicCategoriesQuery(storeSlug);
  const categories = catData?.data?.categories || [];
  const activeCategory = categories.find((category) => category._id === activeCategoryId);
  const hasFilters = Object.keys(filters).length > 0;
  const updateFilter = (name, value) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value && value !== 'all' && value !== 'recommended') next.set(name, value);
    else next.delete(name);
    return next;
  });
  const clearFilters = () => setSearchParams({});

  return (
    <div className="space-y-5">

      {!showCategories && !hasFilters && <div className="storefront-hero bg-[var(--brand-tint)] rounded-2xl p-6 sm:p-8 border border-[var(--brand-line)]">
        <div className="flex items-center gap-2 mb-1"><Flame size={15} className="text-gold-500" aria-hidden="true" /><span className="text-xs font-bold text-gold-400 uppercase tracking-wider">Local shopping</span></div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Welcome to {store?.name || 'the store'}</h1>
        <p className="text-sm text-slate-400 mt-2 max-w-md leading-relaxed">Your everyday essentials, close to home. Browse current products, prices, and stock.</p>
        {store?.deliverySettings?.freeDeliveryAbove > 0 && <div className="flex items-center gap-2 mt-3"><Tag size={11} className="text-gold-400" /><span className="text-xs text-slate-500">Free delivery above {formatCurrency(store.deliverySettings.freeDeliveryAbove)}</span></div>}
      </div>}
      {showCategories ? <CategoryBrowser categories={categories} activeId={activeCategoryId} onSelect={(id) => updateFilter('cat', id)}
        loading={catLoading} error={catError} onRetry={refetchCategories} storeSlug={storeSlug} storeName={store?.name} /> : <nav aria-label="Product categories" className="category-quick-links">
        <button type="button" onClick={() => navigate(`/s/${storeSlug}/categories${searchParams.size ? `?${searchParams}` : ''}`)}
          className="category-all is-selected"><SlidersHorizontal size={15} aria-hidden="true" /> Browse categories</button>
        {categories.slice(0, 8).map((category) => <button key={category._id} type="button" aria-pressed={activeCategoryId === category._id}
          onClick={() => updateFilter('cat', category._id)} className={cn('category-all', activeCategoryId === category._id && 'is-selected')}>
          <span aria-hidden="true">{category.emoji}</span> {category.name}
        </button>)}
      </nav>}
      <CatalogFilters params={searchParams} onChange={setSearchParams} categories={categories} storeSlug={storeSlug} />
      {hasFilters && <div className="catalog-applied" role="group" aria-label="Applied filters">
        <div className="catalog-applied-chips">
          {activeCategoryId !== 'all' && <button type="button" aria-label={`Remove category filter: ${activeCategory?.name || 'Selected category'}`}
            onClick={() => updateFilter('cat', null)} className="catalog-applied-chip">
            {activeCategory?.name || 'Selected category'} <X size={12} aria-hidden="true" /></button>}
          {search && <button type="button" aria-label="Remove search filter" onClick={() => updateFilter('q', null)} className="catalog-applied-chip">
            “{search}” <X size={12} aria-hidden="true" /></button>}
          {[['inStock', 'In stock'], ['offer', 'Offers'], ['featured', 'Featured']].filter(([key]) => searchParams.get(key) === 'true')
            .map(([key, label]) => <button key={key} type="button" aria-label={`Remove ${label} filter`} onClick={() => updateFilter(key, null)}
              className="catalog-applied-chip">{label}<X size={12} aria-hidden="true" /></button>)}
        </div>
        <button type="button" onClick={clearFilters} className="catalog-clear">Clear all filters</button>
      </div>}
      <ProductResults key={`${storeSlug}:${JSON.stringify(filters)}`} storeSlug={storeSlug} filters={filters}
        title={activeCategory?.name || (search ? 'Search results' : 'All products')} onReset={clearFilters} hasFilters={hasFilters} />
    </div>
  );
}
