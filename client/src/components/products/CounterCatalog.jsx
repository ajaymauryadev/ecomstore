import { memo } from 'react';
import { Package, Plus } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

const PackButton = memo(function PackButton({ product, variant, onAdd, quantity }) {
  const full = quantity >= Math.min(variant.stock, 1000);
  return <button type="button"
    aria-label={`${product.name} ${variant.name} ₹${variant.offerPrice || variant.retailPrice} add${quantity ? `, in bill ${quantity}` : ''}`}
    disabled={variant.stock < 1 || full} data-added={quantity > 0 || undefined}
    onClick={() => onAdd(product, variant)} className="pos-pack-button">
    <span className="min-w-0 text-left break-words">{variant.name}<small className="block text-slate-500">{variant.stock < 1 ? 'Out of stock'
      : quantity ? `In bill ${quantity} · ${Math.max(0, variant.stock - quantity)} left` : `${variant.stock} left`}</small></span>
    <span className="flex shrink-0 items-center gap-2 font-bold">₹{variant.offerPrice || variant.retailPrice}<Plus size={16} aria-hidden="true" /></span>
  </button>;
});

// Memoized separately: typing customer details or changing bill quantities needn't
// rerender every product image and pack button.
export default memo(function CounterCatalog({ products, onAdd, quantities }) {
  return <div className="pos-catalog-grid">
    {products.map((product) => {
      const image = product.images?.find((entry) => entry.isMain) ?? product.images?.[0];
      const url = typeof image === 'string' ? image : image?.url;
      const variants = product.variants?.filter((v) => v.isActive) ?? [];
      return <article key={product._id} className="pos-product-card">
        <div className="flex items-center gap-3 min-w-0">
          {url ? <img src={url.startsWith('/') ? API_BASE + url : url} alt="" loading="lazy" decoding="async" width="44" height="44" className="h-11 w-11 shrink-0 object-contain rounded-lg" />
            : <Package size={24} aria-hidden="true" className="shrink-0 text-slate-500" />}
          <h3 className="font-semibold text-sm break-words min-w-0">{product.name}</h3>
        </div>
        <div className="grid gap-2">
          {variants.map((variant) => <PackButton key={variant._id} product={product} variant={variant} onAdd={onAdd} quantity={quantities[variant._id] || 0} />)}
          {!variants.length && <p className="text-sm text-slate-500">Item unavailable</p>}
        </div>
      </article>;
    })}
  </div>;
});
