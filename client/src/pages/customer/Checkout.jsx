import { useSavedViewState } from '../../offline/useSavedViewState';
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import {
  MapPin, User, FileText, Truck, Store,
  Tag, ChevronRight, ArrowLeft, Check, CreditCard, Banknote,
  ShoppingBag, QrCode, Smartphone, Wallet,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useCart } from '../../hooks/useCart';
import { useIdempotentSubmission } from '../../hooks/useIdempotentSubmission';
import { useCreateOrderMutation } from '../../features/orders/orderApi';
import { useGetCustomerProfileQuery } from '../../features/customer/customerApi';
import { useGetStorefrontInfoQuery } from '../../features/storefront/storefrontApi';
import { selectCurrentUser } from '../../features/auth/authSlice';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import UpiPaymentDetails from '../../components/orders/UpiPaymentDetails';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) { return url?.startsWith('/') ? `${API_BASE}${url}` : url; }

const ORDER_TYPES = [
  { value: 'home_delivery', label: 'Home Delivery', icon: Truck, desc: 'Delivered to your door' },
  { value: 'self_pickup', label: 'Store Pickup', icon: Store, desc: 'Pick up from store' },
];

const ALL_PAYMENT_METHODS = [
  { value: 'upi_qr', label: 'UPI QR Code', icon: QrCode, desc: 'Scan & pay instantly', forTypes: ['home_delivery', 'self_pickup'] },
  { value: 'upi_id', label: 'UPI ID Transfer', icon: Smartphone, desc: 'Pay via UPI ID', forTypes: ['home_delivery', 'self_pickup'] },
  { value: 'cod', label: 'Cash on Delivery', icon: Banknote, desc: 'Pay when delivered', forTypes: ['home_delivery'] },
  { value: 'cash_on_pickup', label: 'Cash on Pickup', icon: Wallet, desc: 'Pay at store', forTypes: ['self_pickup'] },
  { value: 'gateway', label: 'Online Payment', icon: CreditCard, desc: 'Coming soon', forTypes: [], disabled: true },
];

export default function Checkout() {
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const cart = useCart();
  const { state } = useLocation();
  const buyNow = state?.buyNow;
  const items = useMemo(() => buyNow ? [{ ...buyNow, quantity: 1 }] : cart.items, [buyNow, cart.items]);
  const subtotal = buyNow ? Number(buyNow.price) : cart.subtotal;
  const { deliveryType, clearCart } = cart;
  const coupon = buyNow ? null : cart.coupon;
  const couponDiscount = buyNow ? 0 : cart.couponDiscount;

  const { data: profileData } = useGetCustomerProfileQuery(storeSlug, { skip: user?.role !== 'customer' });
  const { data: storeData } = useGetStorefrontInfoQuery(storeSlug);
  const profile = profileData?.data?.user;
  const savedAddresses = useMemo(() => profile?.savedAddresses || [], [profile?.savedAddresses]);
  const store = storeData?.data?.store;

  const [createOrder, { isLoading }] = useCreateOrderMutation();
  const { submit, retryPending } = useIdempotentSubmission(createOrder, `${storeSlug}:${user?._id}:checkout`, { persist: true });

  const [orderType, setOrderType] = useSavedViewState('Checkout:Checkout:orderType', ORDER_TYPES.some((type) => type.value === deliveryType) ? deliveryType : 'home_delivery');
  const [paymentMethod, setPaymentMethod] = useSavedViewState('Checkout:Checkout:paymentMethod', 'cod');
  const [selectedAddressId, setSelectedAddressId] = useSavedViewState('Checkout:Checkout:selectedAddressId', null);

  const [form, setForm] = useSavedViewState('Checkout:Checkout:form', {
    name: profile?.name || user?.name || '',
    phone: profile?.phone || user?.phone || '',
    email: profile?.email || '',
    gstNumber: '',
    note: '',
    address: { line1: '', landmark: '', city: '', state: '', pincode: '' },
  });

  // Prefill profile
  useEffect(() => {
    if (profile) {
      setForm((f) => ({
        ...f,
        name: f.name || profile.name || '',
        phone: f.phone || profile.phone || '',
        email: f.email || profile.email || '',
      }));
      const def = profile.savedAddresses?.find((a) => a.isDefault);
      if (def) setSelectedAddressId(def._id);
    }
  }, [profile, setForm, setSelectedAddressId]);

  // Prefill from saved address
  useEffect(() => {
    if (selectedAddressId && savedAddresses.length) {
      const addr = savedAddresses.find((a) => a._id === selectedAddressId);
      if (addr) setForm((f) => ({
        ...f,
        address: {
          line1: addr.line1 || '',
          landmark: addr.landmark || '',
          city: addr.city || '',
          state: addr.state || '',
          pincode: addr.pincode || '',
        },
      }));
    }
  }, [selectedAddressId, savedAddresses, setForm]);

  // Reset payment method when order type changes
  useEffect(() => {
    const available = ALL_PAYMENT_METHODS.filter((m) => !m.disabled && m.forTypes.includes(orderType));
    if (!available.find((m) => m.value === paymentMethod)) {
      setPaymentMethod(available[0]?.value || 'cod');
    }
  }, [orderType, paymentMethod, setPaymentMethod]);

  const availablePaymentMethods = ALL_PAYMENT_METHODS.filter((m) => m.forTypes.includes(orderType) || m.disabled);
  const needsAddress = orderType === 'home_delivery';
  const isUpiMethod = ['upi_qr', 'upi_id'].includes(paymentMethod);
  const requiresProof = isUpiMethod;

  const ps = store?.paymentSettings || {};
  const discountedSubtotal = Math.max(0, subtotal - couponDiscount);
  const deliverySettings = store?.deliverySettings || {};
  const deliveryCharge = orderType === 'home_delivery'
    ? ((Number(deliverySettings.freeDeliveryAbove) > 0 &&
        discountedSubtotal >= Number(deliverySettings.freeDeliveryAbove))
      ? 0
      : (Number(deliverySettings.defaultCharge) || 0))
    : 0;
  const taxPercent = store?.taxSettings?.enableGST
    ? Number(store.taxSettings.cgstPercent || 0) + Number(store.taxSettings.sgstPercent || 0)
    : 0;
  const taxEstimate = Math.round(discountedSubtotal * taxPercent) / 100;
  const total = Math.round((discountedSubtotal + deliveryCharge + taxEstimate) * 100) / 100;

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setAddress = (key, val) => setForm((f) => ({ ...f, address: { ...f.address, [key]: val } }));

  const validate = () => {
    if (!form.name.trim()) return 'Name is required';
    if (!form.phone.trim() || !/^[6-9]\d{9}$/.test(form.phone)) return 'Valid 10-digit phone is required';
    if (needsAddress && !form.address.line1.trim()) return 'Delivery address is required';
    if (needsAddress && !form.address.city.trim()) return 'City is required';
    return null;
  };

  const handleSubmit = async () => {
    let payload;
    if (!retryPending) {
      const err = validate();
      if (err) return toast.error(err);
      if (!items.length) return toast.error('Cart is empty');

      payload = {
        slug: storeSlug,
        orderType,
        paymentMethod,
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
        })),
        customerInfo: {
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          gstNumber: form.gstNumber || undefined,
          address: needsAddress ? form.address : undefined,
        },
        couponCode: coupon?.code,
        note: form.note || undefined,
      };
    }

    try {
      const res = await submit(payload);
      if (!res) return;

      const orderId = res.data.order._id;
      if (!buyNow) clearCart();

      if (res.data.paymentInfo) {
        toast.success('Order placed! Please complete your payment.');
      } else {
        toast.success('Order placed successfully!');
      }
      navigate(`/s/${storeSlug}/orders/${orderId}`);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to place order. Please try again.');
    }
  };

  if (!items.length && !retryPending) {
    return (
      <div className="text-center py-16 text-slate-500">
        <ShoppingBag size={48} strokeWidth={1} className="mx-auto mb-3" />
        <p>Your cart is empty</p>
        <Link to={`/s/${storeSlug}`} className="btn btn-primary btn-sm mt-4 inline-block">Shop Now</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <div className="flex items-center gap-3 mb-5">
        <Link to={`/s/${storeSlug}/cart`} aria-label="Back to cart" className="workspace-row-action rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-xl font-bold text-slate-100">Checkout</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2 space-y-4">

          {/* Order type */}
          <div className="card space-y-3">
            <p className="text-sm font-bold text-slate-200">Order Type</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ORDER_TYPES.map(({ value, label, icon: Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={orderType === value}
                  onClick={() => setOrderType(value)}
                  className={cn(
                    'flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all',
                    orderType === value
                      ? 'bg-gold-500/10 border-gold-500/40 text-gold-400'
                      : 'bg-navy-800 border-navy-700 text-slate-400 hover:border-navy-600'
                  )}
                >
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold leading-tight">{label}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-snug">{desc}</p>
                  </div>
                  {orderType === value && <Check size={13} className="ml-auto mt-0.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="card space-y-4">
            <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <User size={14} className="text-gold-400" /> Contact Details
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Full Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Your name" />
              <Input label="Phone Number *" type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="10-digit mobile" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Email (optional)" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="your@email.com" />
              <Input label="GST Number (optional)" value={form.gstNumber} onChange={(e) => setField('gstNumber', e.target.value.toUpperCase())} placeholder="For businesses" />
            </div>
          </div>

          {/* Address */}
          {needsAddress && (
            <div className="card space-y-4">
              <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <MapPin size={14} className="text-gold-400" /> Delivery Address
              </p>
              {savedAddresses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">Saved addresses</p>
                  {savedAddresses.map((addr) => (
                    <button
                      key={addr._id}
                      type="button"
                      aria-pressed={selectedAddressId === addr._id}
                      onClick={() => setSelectedAddressId(addr._id)}
                      className={cn(
                        'w-full flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all',
                        selectedAddressId === addr._id
                          ? 'bg-gold-500/10 border-gold-500/40'
                          : 'bg-navy-800 border-navy-700 hover:border-navy-600'
                      )}
                    >
                      <MapPin size={14} className={cn('mt-0.5 shrink-0', selectedAddressId === addr._id ? 'text-gold-400' : 'text-slate-500')} />
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs font-semibold', selectedAddressId === addr._id ? 'text-gold-400' : 'text-slate-300')}>{addr.label}</p>
                        <p className="text-xs text-slate-400 truncate">{addr.line1}{addr.city ? `, ${addr.city}` : ''}</p>
                      </div>
                      {selectedAddressId === addr._id && <Check size={13} className="text-gold-400 shrink-0" />}
                    </button>
                  ))}
                  <button type="button" onClick={() => setSelectedAddressId(null)} className="text-xs text-gold-400 hover:text-gold-300">
                    + Use a different address
                  </button>
                </div>
              )}
              {(!selectedAddressId || !savedAddresses.length) && (
                <div className="space-y-3">
                  <Input label="Address Line 1 *" value={form.address.line1} onChange={(e) => setAddress('line1', e.target.value)} placeholder="House no., street, area" />
                  <Input label="Landmark" value={form.address.landmark} onChange={(e) => setAddress('landmark', e.target.value)} placeholder="Near landmark" />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input label="City *" value={form.address.city} onChange={(e) => setAddress('city', e.target.value)} />
                    <Input label="State" value={form.address.state} onChange={(e) => setAddress('state', e.target.value)} />
                    <Input label="Pincode" value={form.address.pincode} onChange={(e) => setAddress('pincode', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment method */}
          <div className="card space-y-3">
            <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <CreditCard size={14} className="text-gold-400" /> Payment Method
            </p>
            <div className="space-y-2">
              {availablePaymentMethods.map(({ value, label, icon: Icon, desc, disabled }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => !disabled && setPaymentMethod(value)}
                  disabled={disabled}
                  aria-pressed={paymentMethod === value}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl border text-sm font-medium transition-all',
                    disabled && 'opacity-40 cursor-not-allowed',
                    !disabled && paymentMethod === value
                      ? 'bg-gold-500/10 border-gold-500/40 text-gold-400'
                      : !disabled
                      ? 'bg-navy-800 border-navy-700 text-slate-400 hover:border-navy-600'
                      : 'bg-navy-800 border-navy-700 text-slate-500'
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <div className="text-left flex-1">
                    <span>{label}</span>
                    {desc && <span className="ml-2 text-[11px] opacity-60">{desc}</span>}
                  </div>
                  {!disabled && paymentMethod === value && <Check size={14} className="shrink-0" />}
                  {disabled && <span className="text-[10px] bg-navy-700 px-2 py-0.5 rounded-full">Soon</span>}
                </button>
              ))}
            </div>

            {/* UPI instructions preview */}
            {isUpiMethod && (ps.upiId || ps.upiQrUrl) && (
              <div className="bg-navy-800 rounded-xl p-3 border border-navy-700 space-y-2">
                <p className="text-xs font-semibold text-gold-400">UPI payment details</p>
                <UpiPaymentDetails settings={ps} showQr={paymentMethod === 'upi_qr'} />
                <p className="text-xs text-slate-400">Place your order before making payment.</p>
                <p className="text-[11px] text-slate-500">Upload payment screenshot on the next screen to confirm.</p>
              </div>
            )}

          </div>

          {/* Note */}
          <div className="card space-y-3">
            <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <FileText size={14} className="text-gold-400" /> Order Note (optional)
            </p>
            <textarea
              aria-label="Order note (optional)"
              value={form.note}
              onChange={(e) => setField('note', e.target.value)}
              placeholder="Any special instructions, delivery timing..."
              rows={2}
              className="input resize-none w-full"
            />
          </div>
        </div>

        {/* Summary */}
        <div>
          <div className="card space-y-4 sticky top-20">
            <p className="text-sm font-bold text-slate-200">Order Summary</p>

            <div className="space-y-2 max-h-40 overflow-y-auto">
              {items.map((item) => (
                <div key={item._id} className="flex items-center gap-2 text-sm">
                  {item.image ? (
                    <img src={imgSrc(item.image)} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-navy-700 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 text-xs line-clamp-1">{item.name}</p>
                    <p className="text-slate-500 text-[11px]">{item.variantName} × {item.quantity}</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-200 shrink-0">{formatCurrency(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 text-sm border-t border-navy-700/60 pt-3">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span><span>{formatCurrency(subtotal)}</span>
              </div>
              {couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span className="flex items-center gap-1"><Tag size={11} /> {coupon?.code}</span>
                  <span>-{formatCurrency(couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-400">
                <span>Delivery</span>
                <span className={deliveryCharge === 0 ? 'text-emerald-400' : ''}>{deliveryCharge === 0 ? 'FREE' : formatCurrency(deliveryCharge)}</span>
              </div>
              {taxEstimate > 0 && (
                <div className="flex justify-between text-slate-400">
                  <span>Estimated tax</span><span>{formatCurrency(taxEstimate)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-100 pt-2 border-t border-navy-700/60">
                <span>Total</span>
                <span className="text-gold-400 text-base">{formatCurrency(total)}</span>
              </div>
            </div>

            {requiresProof && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
                <p className="text-xs text-amber-300 font-medium">Payment required after placing order</p>
                <p className="text-[11px] text-amber-400/70 mt-0.5">Upload screenshot to confirm your payment</p>
              </div>
            )}

            {retryPending && (
              <p role="status" className="mb-2 text-xs text-amber-300">Could not confirm your order. Retry to retrieve or complete the original order.</p>
            )}
            <Button fullWidth size="lg" isLoading={isLoading} onClick={handleSubmit} className="gap-2" rightIcon={<ChevronRight size={16} aria-hidden="true" />}>
              {retryPending ? 'Retry original order' : requiresProof ? 'Place & Pay' : 'Place Order'}
            </Button>

            <p className="text-xs text-slate-500 text-center">
              By placing this order, you agree to our terms of service.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
