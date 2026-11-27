import { useSavedViewState } from '../../offline/useSavedViewState';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ShoppingCart, Plus, Minus, Trash2, Tag, Truck, MapPin,
  ArrowLeft, X, Check, ChevronRight,
} from 'lucide-react';
import { useCart } from '../../hooks/useCart';
import { useValidateCouponMutation } from '../../features/orders/orderApi';
import { useGetStorefrontInfoQuery } from '../../features/storefront/storefrontApi';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) { return url?.startsWith('/') ? `${API_BASE}${url}` : url; }

export default function CartPage() {
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const {
    items, count, subtotal, total, isEmpty, provisional,
    deliveryType, deliveryCharge, coupon, couponDiscount,
    updateQuantity, setDeliveryType, setDeliveryCharge, applyCoupon, removeCoupon,
  } = useCart();

  const [couponInput, setCouponInput] = useSavedViewState('CartPage:CartPage:couponInput', '');
  const [validateCoupon, { isLoading: validatingCoupon }] = useValidateCouponMutation();
  const { data: storeData } = useGetStorefrontInfoQuery(storeSlug);
  const deliverySettings = storeData?.data?.store?.deliverySettings;

  useEffect(() => {
    if (deliveryType !== 'home_delivery') {
      setDeliveryCharge(0);
      return;
    }
    const freeAbove = Number(deliverySettings?.freeDeliveryAbove) || 0;
    const charge = freeAbove > 0 && subtotal >= freeAbove
      ? 0
      : (Number(deliverySettings?.defaultCharge) || 0);
    setDeliveryCharge(charge);
  }, [deliveryType, deliverySettings, subtotal, setDeliveryCharge]);

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) return;
    try {
      const res = await validateCoupon({
        slug: storeSlug,
        code: couponInput.trim(),
        orderType: deliveryType,
        paymentMethod: deliveryType === 'self_pickup' ? 'cash_on_pickup' : 'cod',
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      }).unwrap();
      applyCoupon(res.data.coupon, res.data.discount);
      toast.success(`Coupon applied! You saved ${formatCurrency(res.data.discount)}`);
      setCouponInput('');
    } catch (err) {
      toast.error(err?.data?.message || 'Invalid coupon');
    }
  };

  const handleDeliveryChange = (type) => {
    setDeliveryType(type);
    if (type !== 'home_delivery') setDeliveryCharge(0);
  };

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-slate-500">
        <ShoppingCart size={56} strokeWidth={1} />
        <p className="font-medium text-slate-400 text-lg">Your cart is empty</p>
        <Link to={`/s/${storeSlug}`} className="btn btn-primary btn-md gap-2">
          <ArrowLeft size={16} /> Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {provisional && <p role="status" className="workspace-feedback mb-4">Saved cart — prices, stock and coupons need online confirmation. These items are not reserved.</p>}
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link to={`/s/${storeSlug}`} aria-label="Back to store" className="workspace-row-action rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-100">My Cart</h1>
          <p className="text-xs text-slate-400">{count} item{count !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cart items */}
        <div className="md:col-span-2 space-y-3">
          {items.map((item) => (
            <div key={item._id} className="cart-page-item bg-navy-800 rounded-2xl border border-navy-700/60 p-4 grid items-center gap-3">
              {item.image ? (
                <img src={imgSrc(item.image)} alt={item.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-navy-700 shrink-0 flex items-center justify-center">
                  <ShoppingCart size={20} className="text-navy-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 line-clamp-1">{item.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.variantName}</p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-sm font-bold text-gold-400">{formatCurrency(item.price * item.quantity)}</p>
                  {item.price < item.mrp && (
                    <p className="text-xs text-slate-500 line-through">{formatCurrency(item.mrp * item.quantity)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  aria-label={`Decrease quantity of ${item.name}`}
                  onClick={() => updateQuantity(item._id, item.quantity - 1)}
                  className="w-11 h-11 rounded-lg bg-navy-700 hover:bg-navy-600 flex items-center justify-center text-slate-300 transition-colors"
                >
                  {item.quantity === 1 ? <Trash2 size={12} className="text-red-400" /> : <Minus size={12} />}
                </button>
                <span className="text-sm font-bold text-slate-100 w-5 text-center">{item.quantity}</span>
                <button
                  type="button"
                  aria-label={`Increase quantity of ${item.name}`}
                  onClick={() => item.quantity < item.stock && updateQuantity(item._id, item.quantity + 1)}
                  disabled={item.quantity >= item.stock}
                  className="w-11 h-11 rounded-lg bg-gold-500/10 hover:bg-gold-500/20 disabled:opacity-40 flex items-center justify-center text-gold-400 transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ))}

          {/* Delivery type */}
          <div className="bg-navy-800 rounded-2xl border border-navy-700/60 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">Delivery Option</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'home_delivery', label: 'Home Delivery', icon: Truck },
                { value: 'self_pickup', label: 'Store Pickup', icon: MapPin },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={deliveryType === value}
                  onClick={() => handleDeliveryChange(value)}
                  className={cn(
                    'flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all',
                    deliveryType === value
                      ? 'bg-gold-500/10 border-gold-500/40 text-gold-400'
                      : 'bg-navy-700/40 border-navy-600 text-slate-400 hover:border-navy-500'
                  )}
                >
                  <Icon size={15} />
                  {label}
                  {deliveryType === value && <Check size={13} className="ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Coupon */}
          <div className="bg-navy-800 rounded-2xl border border-navy-700/60 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Tag size={14} className="text-gold-400" /> Coupon / Promo Code
            </p>
            {coupon ? (
              <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2.5">
                <div>
                  <p className="text-sm font-bold text-emerald-400">{coupon.code}</p>
                  <p className="text-xs text-emerald-300">{coupon.description || `Saved ${formatCurrency(couponDiscount)}`}</p>
                </div>
                <button type="button" aria-label="Remove coupon" onClick={removeCoupon} className="workspace-row-action text-slate-400 hover:text-red-400 transition-colors ml-2">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  aria-label="Coupon code"
                  type="text"
                  placeholder="Enter coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                  className="input flex-1 uppercase"
                />
                <button
                  onClick={handleApplyCoupon}
                  disabled={validatingCoupon || !couponInput.trim()}
                  className="btn btn-secondary btn-md px-4 disabled:opacity-50"
                >
                  {validatingCoupon ? <Spinner size="sm" /> : 'Apply'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Order summary */}
        <div className="space-y-3">
          <div className="bg-navy-800 rounded-2xl border border-navy-700/60 p-4 space-y-3 sticky top-20">
            <p className="text-sm font-bold text-slate-200">Order Summary</p>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal ({count} items)</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Coupon discount</span>
                  <span>-{formatCurrency(couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-400">
                <span>Delivery charge</span>
                <span className={deliveryCharge === 0 ? 'text-emerald-400 font-medium' : ''}>
                  {deliveryCharge === 0 ? 'FREE' : formatCurrency(deliveryCharge)}
                </span>
              </div>
              {deliverySettings?.freeDeliveryAbove > subtotal && deliveryType === 'home_delivery' && (
                <p className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-2 py-1.5">
                  Add {formatCurrency(deliverySettings.freeDeliveryAbove - subtotal)} more for free delivery
                </p>
              )}
              <div className="flex justify-between font-bold text-slate-100 pt-2 border-t border-navy-700/60">
                <span>Grand Total</span>
                <span className="text-gold-400 text-base">{formatCurrency(total)}</span>
              </div>
            </div>

            <button
              onClick={() => navigate(`/s/${storeSlug}/checkout`)}
              className="btn btn-primary btn-lg w-full gap-2"
            >
              Proceed to Checkout <ChevronRight size={16} />
            </button>

            <Link to={`/s/${storeSlug}`} className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors">
              <ArrowLeft size={12} /> Continue shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
