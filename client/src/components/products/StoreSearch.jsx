import { useRef, useState } from 'react';
import { ArrowRight, Search, ShoppingBag, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useGetPublicProductsQuery } from '../../features/products/productApi';
import { useGetPublicCategoriesQuery } from '../../features/categories/categoryApi';
import { formatCurrency } from '../../utils/formatters';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

export default function StoreSearch({ value, onChange, onClear, onSubmit, storeSlug }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const settled = useDebouncedValue(value.trim(), 250);
  const { currentData, isFetching, isError } = useGetPublicProductsQuery({ slug: storeSlug, search: settled, limit: 5 }, { skip: !open || !settled });
  const { data: categoryData } = useGetPublicCategoriesQuery(storeSlug, { skip: !open });
  const products = currentData?.data || [];
  const categories = (categoryData?.data?.categories || []).filter((category) => category.name.toLocaleLowerCase().includes(settled.toLocaleLowerCase())).slice(0, 4);
  const visible = open && Boolean(value.trim());
  const pending = isFetching || settled !== value.trim();
  const handleKeys = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); inputRef.current?.focus(); setOpen(false); }
    if (!visible || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const targets = [...(resultsRef.current?.querySelectorAll('a, button') || [])];
    if (!targets.length) return;
    event.preventDefault();
    const index = targets.indexOf(document.activeElement);
    const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : targets.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + targets.length) % targets.length;
    targets[next]?.focus();
  };

  return <form onSubmit={(event) => { setOpen(false); onSubmit(event); }} className="store-search flex-1 min-w-0" onKeyDown={handleKeys}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} role="search" aria-label="Store search">
    <div className="store-search-field">
      <button type="submit" aria-label="Search products"><Search size={18} /></button>
      <input ref={inputRef} type="text" aria-label="Search store products" placeholder="Search products, brands & more" value={value}
        autoComplete="off" onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        aria-controls={visible ? 'store-search-suggestions' : undefined} />
      {value && <button type="button" aria-label="Clear search" onClick={() => { onClear(); inputRef.current?.focus(); }}><X size={16} /></button>}
    </div>
    {visible && <div ref={resultsRef} id="store-search-suggestions" role="region" aria-label="Search suggestions" className="store-search-results">
      <div className="search-results-heading"><span>Quick search</span><span>↵ to see all</span></div>
      {pending ? <div role="status" className="search-feedback">Searching your store…</div> : isError ? <p role="status" className="search-feedback">Suggestions unavailable. Press Enter to search.</p> : <>
        {categories.length > 0 && <div className="search-category-matches">{categories.map((category) => <Link key={category._id}
          to={`/s/${storeSlug}/categories?cat=${encodeURIComponent(category._id)}`} onClick={() => setOpen(false)} aria-label={`Browse category ${category.name}`}>
          <span aria-hidden="true">{category.emoji || '📦'}</span>{category.name}<ArrowRight size={13} aria-hidden="true" />
        </Link>)}</div>}
        {products.map((product) => {
          const active = product.variants?.filter((variant) => variant.isActive) || [];
          const variant = active.find((item) => item.stock > 0) || active[0];
          const image = product.mainImage?.startsWith('/') ? `${API_BASE}${product.mainImage}` : product.mainImage;
          return <Link key={product._id} to={`/s/${storeSlug}/p/${product._id}`} onClick={() => setOpen(false)}
            aria-label={`Open product ${product.name}`} className="search-product-match">
            <span className="search-product-image">{image ? <img src={image} alt="" /> : <ShoppingBag size={20} aria-hidden="true" />}</span>
            <span><strong>{product.name}</strong><small>{product.brand || product.categoryId?.name || variant?.name}</small></span>
            {variant && <b>{formatCurrency(variant.offerPrice ?? variant.retailPrice)}</b>}
          </Link>;
        })}
        {!products.length && !categories.length && <p role="status" className="search-feedback">No matches yet. Try a product, brand or category.</p>}
      </>}
      <button type="submit" className="search-view-results"><span>See all results for “{value.trim()}”</span><ArrowRight size={17} aria-hidden="true" /></button>
    </div>}
  </form>;
}
