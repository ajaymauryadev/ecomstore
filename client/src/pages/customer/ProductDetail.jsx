import { useState } from 'react';
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom';
import {
  ShoppingCart, Plus, Minus, Heart, Tag, Trash2,
  ChevronRight, AlertTriangle, Flame, Zap,
} from 'lucide-react';
import { useGetPublicProductQuery } from '../../features/products/productApi';
import { useToggleFavoriteMutation, useGetCustomerProfileQuery } from '../../features/customer/customerApi';
import { useSelector } from 'react-redux';
import { selectCurrentUser } from '../../features/auth/authSlice';
import { useCart } from '../../hooks/useCart';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import Skeleton from '../../components/ui/Skeleton';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) {
  if (!url) return null;
  return url?.startsWith('/') ? `${API_BASE}${url}` : url;
}

function ProductImage({ images, name }) {
  const [active, setActive] = useState(0);
  const validImgs = images?.filter((i) => i.url) || [];

  return (
    <div className="space-y-2">
      <div className="aspect-square bg-navy-800 rounded-2xl overflow-hidden border border-navy-700/60">
        {validImgs[active] ? (
          <img src={imgSrc(validImgs[active].url)} alt={name} className="w-full h-full object-contain p-4" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ShoppingCart size={48} strokeWidth={1} className="text-navy-600" />
          </div>
        )}
      </div>
      {validImgs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {validImgs.map((img, i) => (
            <button
              key={i}
              type="button"
              aria-label={`View image ${i + 1} of ${name}`}
              aria-pressed={active === i}
              onClick={() => setActive(i)}
              className={cn(
                'w-14 h-14 rounded-xl overflow-hidden border-2 shrink-0 transition-all',
                active === i ? 'border-gold-500' : 'border-navy-700/60 hover:border-navy-500'
              )}
            >
              <img src={imgSrc(img.url)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RelatedCard({ product }) {
  const { cartReady = true } = useOutletContext() || {};
  const activeVariants = product.variants?.filter((v) => v.isActive) || [];
  const variant = activeVariants.find((v) => v.stock > 0) ?? activeVariants[0];
  const { getItemQuantity, addItem, updateQuantity } = useCart();
  const { storeSlug } = useParams();

  if (!variant) return null;
  const cartKey = `${product._id}_${variant._id}`;
  const qty = getItemQuantity(cartKey);
  const price = variant.offerPrice ?? variant.retailPrice;
  const discount = variant.offerPrice && variant.retailPrice > variant.offerPrice
    ? Math.round(((variant.retailPrice - variant.offerPrice) / variant.retailPrice) * 100)
    : null;

  const cartItem = {
    _id: cartKey, productId: product._id, variantId: variant._id,
    name: product.name, variantName: variant.name, unit: variant.unit,
    image: imgSrc(product.mainImage), price, mrp: variant.retailPrice, stock: variant.stock,
  };

  return (
    <article className="bg-navy-800 rounded-xl border border-navy-700/60 hover:border-navy-600 overflow-hidden transition-all block min-w-0">
      <Link to={`/s/${storeSlug}/p/${product._id}`} aria-label={`View ${product.name}`} className="aspect-square bg-navy-750 relative overflow-hidden block">
        {product.mainImage ? (
          <img src={imgSrc(product.mainImage)} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-navy-700/50">
            <ShoppingCart size={20} strokeWidth={1} className="text-navy-500" />
          </div>
        )}
        {discount && (
          <span className="absolute top-1.5 left-1.5 bg-gold-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded">
            {discount}% OFF
          </span>
        )}
      </Link>
      <div className="p-2.5">
        <Link to={`/s/${storeSlug}/p/${product._id}`} className="text-xs text-slate-200 leading-tight line-clamp-2">{product.name}</Link>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
          <p className="text-xs font-bold text-slate-100">{formatCurrency(price)}</p>
          <button
            type="button"
            aria-label={`Add ${product.name} to cart`}
            disabled={!cartReady || variant.stock <= 0 || qty >= variant.stock}
            onClick={(e) => {
              e.preventDefault();
              if (qty === 0) addItem(cartItem);
              else updateQuantity(cartKey, qty + 1);
            }}
            className="w-11 h-11 bg-gold-500 text-white rounded-lg flex items-center justify-center disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={3} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ProductDetail() {
  const { cartReady = true } = useOutletContext() || {};
  const { storeSlug, productId } = useParams();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const { getItemQuantity, addItem, updateQuantity, openCart } = useCart();

  const { data, isLoading, isError } = useGetPublicProductQuery({ slug: storeSlug, productId });
  const { data: profileData } = useGetCustomerProfileQuery(storeSlug, { skip: user?.role !== 'customer' });
  const [toggleFavorite] = useToggleFavoriteMutation();

  const product = data?.data?.product;
  const related = data?.data?.related || [];
  const isFavorited = profileData?.data?.user?.favoriteProductIds?.includes(productId);

  const activeVariants = product?.variants?.filter((v) => v.isActive) || [];
  const [selectedVariant, setSelectedVariant] = useState(null);
  const variant = activeVariants.find((v) => v._id === selectedVariant?._id) ?? activeVariants.find((v) => v.stock > 0) ?? activeVariants[0];

  if (isLoading) return (
    <div className="space-y-5" role="status" aria-label="Loading saved product">
      <Link to={`/s/${storeSlug}`} className="text-xs text-slate-500">Home</Link>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" aria-hidden="true">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-5"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-16 w-full" /><Skeleton className="h-12 w-full" /></div>
      </div>
    </div>
  );

  if (isError || !product) return (
    <div className="text-center py-16 text-slate-500">
      <ShoppingCart size={48} strokeWidth={1} className="mx-auto mb-3" />
      <p>Product not found or no longer available</p>
    </div>
  );

  if (!variant) return null;

  const cartKey = `${product._id}_${variant._id}`;
  const qty = getItemQuantity(cartKey);
  const price = variant.offerPrice ?? variant.retailPrice;
  const retail = variant.retailPrice;
  const discount = variant.offerPrice && retail > variant.offerPrice
    ? Math.round(((retail - variant.offerPrice) / retail) * 100) : null;
  const isLowStock = variant.stock > 0 && variant.stock <= variant.lowStockLimit;

  const cartItem = {
    _id: cartKey, productId: product._id, variantId: variant._id,
    name: product.name, variantName: variant.name, unit: variant.unit,
    image: imgSrc(product.mainImage), price, mrp: retail, stock: variant.stock,
  };

  const handleAdd = () => {
    addItem(cartItem);
    openCart();
  };

  const handleFavorite = () => {
    if (user?.role !== 'customer') return navigate(`/s/${storeSlug}/auth`);
    toggleFavorite({ slug: storeSlug, productId: product._id });
  };

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Link to={`/s/${storeSlug}`} className="hover:text-slate-300 transition-colors">Home</Link>
        <ChevronRight size={12} />
        {product.categoryId && (
          <>
            <Link to={`/s/${storeSlug}?cat=${product.categoryId._id}`} className="hover:text-slate-300 transition-colors">
              {product.categoryId.emoji} {product.categoryId.name}
            </Link>
            <ChevronRight size={12} />
          </>
        )}
        <span className="text-slate-400 truncate max-w-[150px]">{product.name}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Images */}
        <div>
          <ProductImage images={product.images} name={product.name} />
        </div>

        {/* Right: Info */}
        <div className="space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {product.isFeatured && (
              <span className="flex items-center gap-1 bg-gold-500/10 border border-gold-500/20 text-gold-400 text-xs font-bold px-2 py-0.5 rounded-lg">
                <Flame size={10} /> Bestseller
              </span>
            )}
            {discount && (
              <span className="bg-gold-500 text-white text-xs font-black px-2 py-0.5 rounded-lg">
                {discount}% OFF
              </span>
            )}
          </div>

          {/* Name & brand */}
          <div>
            {product.brand && <p className="text-xs text-slate-500 mb-1">{product.brand}</p>}
            <h1 className="text-xl font-bold text-slate-100 leading-tight">{product.name}</h1>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-black text-gold-400">{formatCurrency(price)}</span>
            {discount && <span className="text-base text-slate-500 line-through">{formatCurrency(retail)}</span>}
          </div>

          {/* Variant selector */}
          {activeVariants.length > 1 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Choose size / pack</p>
              <div className="flex flex-wrap gap-2">
                {activeVariants.map((v) => {
                  const vPrice = v.offerPrice ?? v.retailPrice;
                  const vDisc = v.offerPrice ? Math.round(((v.retailPrice - v.offerPrice) / v.retailPrice) * 100) : null;
                  return (
                    <button
                      key={v._id}
                      type="button"
                      disabled={v.stock <= 0}
                      onClick={() => setSelectedVariant(v)}
                      className={cn(
                        'flex flex-col items-start px-3 py-2 rounded-xl border text-sm transition-all',
                        variant._id === v._id
                          ? 'bg-gold-500/10 border-gold-500/50 text-gold-400'
                          : v.stock <= 0
                          ? 'bg-navy-800 border-navy-700/40 text-slate-600 cursor-not-allowed opacity-60'
                          : 'bg-navy-800 border-navy-700 text-slate-300 hover:border-navy-500'
                      )}
                    >
                      <span className="font-semibold">{v.name}</span>
                      <span className={cn('text-xs', variant._id === v._id ? 'text-gold-400' : 'text-slate-400')}>
                        {formatCurrency(vPrice)}
                        {vDisc ? <span className="ml-1 text-gold-500">{vDisc}% off</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stock indicator */}
          {isLowStock && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="text-xs text-amber-300 font-medium">Only {variant.stock} left — order soon!</span>
            </div>
          )}

          {/* Add to cart */}
          <div className={variant.stock > 0 && qty === 0 ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
          {variant.stock <= 0 ? (
            <button disabled className="btn btn-secondary btn-lg w-full opacity-60 cursor-not-allowed">
              Out of Stock
            </button>
          ) : qty === 0 ? (
            <button onClick={handleAdd} disabled={!cartReady} className="btn btn-secondary btn-lg w-full min-w-0 gap-1.5 px-2 text-sm sm:px-6 sm:text-base whitespace-nowrap">
              <ShoppingCart size={18} className="shrink-0" />
              Add to Cart
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[10rem] items-center gap-3 bg-navy-800 border border-navy-700 rounded-xl px-3 py-2 flex-1 justify-between">
                <button aria-label={qty === 1 ? 'Remove from cart' : 'Decrease quantity'} disabled={!cartReady} onClick={() => updateQuantity(cartKey, qty - 1)} className="w-11 h-11 shrink-0 rounded-lg bg-navy-700 hover:bg-navy-600 flex items-center justify-center text-slate-300 transition-colors">
                  {qty === 1 ? <Trash2 size={14} className="text-red-400" /> : <Minus size={14} />}
                </button>
                <span className="text-lg font-black text-gold-400">{qty}</span>
                <button aria-label="Increase quantity" onClick={() => qty < variant.stock && updateQuantity(cartKey, qty + 1)} disabled={!cartReady || qty >= variant.stock} className="w-11 h-11 shrink-0 rounded-lg bg-gold-500/10 hover:bg-gold-500/20 disabled:opacity-40 flex items-center justify-center text-gold-400 transition-colors">
                  <Plus size={14} />
                </button>
              </div>
              <button onClick={openCart} disabled={!cartReady} className="btn btn-secondary btn-lg px-5">
                View Cart
              </button>
            </div>
          )}

          {variant.stock > 0 && <button type="button" disabled={!cartReady} onClick={() => navigate(`/s/${storeSlug}/checkout`, { state: { buyNow: cartItem } })} className="btn btn-primary btn-lg w-full min-w-0 gap-1.5 px-2 text-sm sm:px-6 sm:text-base whitespace-nowrap">
            <Zap size={18} className="shrink-0" aria-hidden="true" /> Buy Now
          </button>}
          </div>

          {/* Favorite */}
          <button
            onClick={handleFavorite}
            className={cn(
              'flex min-h-11 items-center gap-2 text-sm font-medium transition-colors',
              isFavorited ? 'text-red-400' : 'text-slate-400 hover:text-red-400'
            )}
          >
            <Heart size={15} fill={isFavorited ? 'currentColor' : 'none'} />
            {isFavorited ? 'Saved to favourites' : 'Save to favourites'}
          </button>

          {/* Description */}
          {product.description && (
            <div className="bg-navy-800/60 border border-navy-700/60 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">About</p>
              <p className="text-sm text-slate-300 leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Tags */}
          {product.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {product.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 bg-navy-800 border border-navy-700/60 text-slate-400 text-xs px-2 py-0.5 rounded-lg">
                  <Tag size={10} /> {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Related Products */}
      {related.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-navy-700/40">
          <h2 className="text-sm font-bold text-slate-200">You might also like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {related.map((p) => <RelatedCard key={p._id} product={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}
