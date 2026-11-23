import { memo, useState, useRef, useMemo, useCallback, useDeferredValue, useEffect } from 'react';
import {
  Search, Plus, Minus, Trash2,
  User, ShoppingCart, CheckCircle2,
} from 'lucide-react';
import { useGetProductsQuery } from '../../../features/products/productApi';
import { useCreatePOSOrderMutation, useGetPOSUdharCustomersQuery } from '../../../features/pos/posApi';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';
import { useAuth } from '../../../hooks/useAuth';
import { useIdempotentSubmission } from '../../../hooks/useIdempotentSubmission';
import { useRetryCountdown } from '../../../hooks/useRetryCountdown';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';
import BillReceipt from '../../../components/pos/BillReceipt';
import Input from '../../../components/ui/Input';
import CounterCatalog from '../../../components/products/CounterCatalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { POS_CATALOG_PARAMS, EMPTY_PRODUCTS, mergeCatalog } from '../../../features/pos/catalog';
import WorkAssigneePicker from '../../../components/orders/WorkAssigneePicker';

function displayedLineTotal(item) {
  const lineTotal = +(item.price * item.qty).toFixed(2);
  const discountAmt = +((item.price * item.qty * (item.discount || 0)) / 100).toFixed(2);
  return +(lineTotal - discountAmt).toFixed(2);
}

const CartRow = memo(function CartRow({ item, onQty, onRemove, onDiscount, onSetQty }) {

  return (
    <div className="card pos-cart-item p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 basis-[calc(100%_-_7rem)] sm:basis-auto sm:flex-1">
          <p className="text-sm font-semibold text-slate-200 break-words">{item.name}</p>
          <p className="text-xs text-slate-500">
            {item.variantName} · ₹{item.price} each
          </p>
        </div>
        <div className="order-2 flex shrink-0 items-center gap-1 sm:order-none">
          <button type="button" disabled={item.qty <= 1} aria-label={`Decrease quantity of ${item.name} ${item.variantName}`} onClick={() => onQty(item.id, -1)} className="workspace-row-action bg-navy-700 text-slate-300">
            <Minus size={12} />
          </button>
          <input key={item.qty} type="number" inputMode="numeric" min="1" max={Math.min(item.maxStock, 1000)} step="1" defaultValue={item.qty}
            aria-label={`Quantity of ${item.name} ${item.variantName}`} className="input pos-quantity text-center font-semibold"
            onBlur={(e) => { onSetQty(item.id, e.target.value); e.target.value = String(Math.max(1, Math.min(Math.trunc(Number(e.target.value)) || 1, item.maxStock, 1000))); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <button type="button" disabled={item.qty >= Math.min(item.maxStock, 1000)} aria-label={`Increase quantity of ${item.name} ${item.variantName}`} onClick={() => onQty(item.id, 1)} className="workspace-row-action bg-navy-700 text-slate-300">
            <Plus size={12} />
          </button>
        </div>
        <div className="text-right shrink-0 min-w-[64px]">
          <p className="text-sm font-semibold text-slate-100 tabular-nums">₹{displayedLineTotal(item).toFixed(2)}</p>
          {item.discount > 0 && <p className="text-[10px] text-emerald-400">-{item.discount}%</p>}
        </div>
        <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)} className="workspace-row-action order-2 ml-auto text-red-400 sm:order-none sm:ml-0">
          <Trash2 size={14} />
        </button>
      </div>
      {item.qty >= Math.min(item.maxStock, 1000) && <p className="mt-2 text-xs text-amber-600">{item.maxStock <= 1000 ? 'Available stock reached.' : 'You can add up to 1,000 of this pack per bill.'}</p>}
      <label className="pos-item-discount mt-1.5 flex items-center gap-2 text-xs text-slate-500">
        Discount %
        <input type="number" inputMode="decimal" aria-label={`Discount percentage for ${item.name}`} min="0" max="100"
          value={item.discount || ''} onChange={(e) => onDiscount(item.id, Math.min(100, Math.max(0, Number(e.target.value))))}
          placeholder="0" className="input w-16 px-2 py-1" />
      </label>
    </div>
  );
});

/* ── Main POS page ───────────────────────────── */
export default function POSPage() {
  const { store, user } = useAuth();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const deferredSearch = useDeferredValue(search.trim());
  const searchInput = useRef(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [announcement, setAnnouncement] = useState('');
  const [pendingScan, setPendingScan] = useState('');
  const [cart, setCart] = useState([]);
  const quantities = useMemo(() => Object.fromEntries(cart.map((item) => [item.variantId, item.qty])), [cart]);
  const [paymentMethod, setPaymentMethod] = useState('counter');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountPage, setAccountPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const debouncedAccountSearch = useDebouncedValue(accountSearch.trim());
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerErrors, setCustomerErrors] = useState({});
  const [overallDiscount, setOverallDiscount] = useState('');
  const [saleType, setSaleType] = useState('instant');
  const [packingAssigneeId, setPackingAssigneeId] = useState(user?._id || null);
  const [billOrder, setBillOrder] = useState(null);
  const [billError, setBillError] = useState(null);

  const [createOrder, { isLoading: submitting }] = useCreatePOSOrderMutation();
  const { submit, retryPending, retryAt } = useIdempotentSubmission(createOrder, `${store?._id}:${user?._id}`);
  const retrySeconds = useRetryCountdown(retryAt);
  const draftLocked = submitting || Boolean(retryAt);

  const catalogQuery = useGetProductsQuery({ ...POS_CATALOG_PARAMS, ...(catalogPage > 1 && { page: catalogPage }) });
  const searchQuery = useGetProductsQuery(
    { search: debouncedSearch, isActive: true, limit: 24, sortBy: 'name' },
    { skip: !debouncedSearch }
  );
  const remote = debouncedSearch && debouncedSearch === deferredSearch ? searchQuery.currentData?.data ?? EMPTY_PRODUCTS : EMPTY_PRODUCTS;
  const products = useMemo(() => mergeCatalog(catalogQuery.currentData?.data ?? EMPTY_PRODUCTS, remote, deferredSearch),
    [catalogQuery.currentData, remote, deferredSearch]);
  const activeQuery = search.trim() ? searchQuery : catalogQuery;
  const { error: searchError, refetch: retrySearch, isFetching: searching } = activeQuery;
  const searchRetrySeconds = useRetryCountdown(searchError?.data?.retryAt);
  const searchPending = search.trim() !== debouncedSearch || searching;

  const addToCart = useCallback((product, variant) => {
    if (variant.stock < 1) return;
    setPendingScan('');
    setCart((c) => {
      const existing = c.find((i) => i.variantId === String(variant._id));
      if (existing) return c.map((i) => i === existing ? { ...i, qty: Math.min(i.qty + 1, variant.stock, 1000), maxStock: variant.stock } : i);
      if (c.length >= 100) return c;
      return [
        ...c,
        {
          id: `${product._id}-${variant._id}-${Date.now()}`,
          productId: String(product._id),
          variantId: String(variant._id),
          name: product.name,
          variantName: variant.name,
          unit: variant.unit,
          image: product.images?.[0] ?? '',
          price: variant.offerPrice || variant.retailPrice,
          mrp: variant.retailPrice,
          qty: 1,
          discount: 0,
          maxStock: variant.stock,
        },
      ];
    });
    setAnnouncement(`${product.name} ${variant.name} selected. Check the quantity in your bill.`);
  }, []);

  useEffect(() => {
    if (!pendingScan || pendingScan !== debouncedSearch || searchPending || draftLocked) return;
    const exact = products.flatMap((product) => (product.variants || [])
      .filter((v) => v.isActive && v.stock >= 1 && [v.barcode, v.sku].some((code) => code && code === pendingScan))
      .map((variant) => ({ product, variant })));
    setPendingScan('');
    if (exact.length === 1) {
      addToCart(exact[0].product, exact[0].variant);
      setSearch('');
    } else {
      setAnnouncement('Select the correct pack to add it.');
    }
  }, [pendingScan, debouncedSearch, searchPending, products, addToCart, draftLocked]);

  const updateQty = useCallback((id, delta) => {
    setCart((c) =>
      c
        .map((i) => i.id === id ? { ...i, qty: Math.max(1, Math.min(i.qty + delta, i.maxStock, 1000)) } : i)
        .filter((i) => i.qty > 0)
    );
  }, []);
  const setQty = useCallback((id, value) => setCart((c) => c.map((i) => i.id === id
    ? { ...i, qty: Math.max(1, Math.min(Math.trunc(Number(value)) || 1, i.maxStock, 1000)) } : i)), []);

  const removeItem = useCallback((id) => setCart((c) => c.filter((i) => i.id !== id)), []);

  const setItemDiscount = useCallback((id, pct) => setCart((c) => c.map((i) => i.id === id ? { ...i, discount: pct } : i)), []);

  const subtotal = +cart.reduce((s, i) => {
    const lineTotal = i.price * i.qty;
    const discounted = lineTotal - (lineTotal * (i.discount || 0)) / 100;
    return s + discounted;
  }, 0).toFixed(2);

  const overallDiscountAmt = +Math.max(0, Math.min(Number(overallDiscount) || 0, subtotal)).toFixed(2);
  const grandTotal = +(subtotal - overallDiscountAmt).toFixed(2);

  const isSplit = ['credit', 'split'].includes(paymentMethod);
  const cashMinor = isSplit ? Math.round(Number(cashAmount || 0) * 100) : paymentMethod === 'counter' ? Math.round(grandTotal * 100) : 0;
  const upiMinor = isSplit ? Math.round(Number(upiAmount || 0) * 100) : paymentMethod === 'upi_id' ? Math.round(grandTotal * 100) : 0;
  const pendingAmount = Math.max(0, (Math.round(grandTotal * 100) - cashMinor - upiMinor) / 100);
  const paymentError = !Number.isSafeInteger(cashMinor) || !Number.isSafeInteger(upiMinor) || cashMinor < 0 || upiMinor < 0
    ? 'Enter valid cash and UPI amounts.' : cashMinor + upiMinor > Math.round(grandTotal * 100)
      ? 'Cash and UPI payments cannot exceed the bill total.' : null;
  const isUdhar = paymentMethod === 'credit' || (isSplit && pendingAmount > 0);
  const phone = customerPhone.trim();
  const isValidPhone = /^[6-9]\d{9}$/.test(phone);
  const { currentData: udharData, error: udharError, isFetching: findingUdhar, refetch: refetchAccounts } = useGetPOSUdharCustomersQuery({ search: debouncedAccountSearch, page: accountPage }, {
    skip: !isUdhar, refetchOnFocus: true,
  });
  const udharCustomer = selectedCustomer;
  const accountOptions = udharData?.data || [];

  const handleSubmit = async () => {
    if (submitting || billOrder || retryAt > Date.now()) return;
    setPendingScan('');
    setBillError(null);
    let payload;
    if (!retryPending) {
      if (!cart.length) return toast.error('Cart is empty');
      if (grandTotal <= 0 || cart.some((item) => +(item.price * (1 - item.discount / 100)).toFixed(2) <= 0)) {
        setBillError('Discount must be less than the price. The bill total must be greater than zero.');
        return;
      }

      const name = customerName.trim();
      const errors = {};
      if (paymentError) { setBillError(paymentError); return; }
      if (isUdhar && !udharCustomer) {
        errors.customerPhone = 'Select a customer account for Udhar.';
      } else if (phone && !isValidPhone) {
        errors.customerPhone = 'Enter a valid 10-digit Indian mobile number.';
      }
      setCustomerErrors(errors);
      if (Object.keys(errors).length) { return; }

      payload = {
        items: cart.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          qty: item.qty,
          price: +(item.price - (item.price * (item.discount || 0)) / 100).toFixed(2),
        })),
        paymentMethod: isUdhar ? 'credit' : paymentMethod === 'split' ? 'counter' : paymentMethod,
        ...(isSplit && { payments: { cash: cashMinor / 100, upi: upiMinor / 100 } }),
        ...(isUdhar && { udharCustomerId: udharCustomer._id }),
        ...(!isUdhar && name && { customerName: name }),
        ...(phone && { customerPhone: phone }),
        overallDiscount: overallDiscountAmt,
        saleType,
        ...(saleType === 'parcha' && { packingAssigneeId }),
      };
    }

    try {
      const res = await submit(payload);
      if (res) setBillOrder(res.data.order);
    } catch (err) {
      if (err?.status === 429) return;
      const fieldErrors = Object.fromEntries(
        (err?.data?.errors ?? [])
          .filter(({ field }) => field === 'customerName' || field === 'customerPhone')
          .map(({ field, message }) => [field, message])
      );
      if (Object.keys(fieldErrors).length) {
        setCustomerErrors(fieldErrors);
      } else {
        setBillError(err?.data?.message || 'Failed to create order');
      }
    }
  };

  const handleNewSale = () => {
    setBillOrder(null);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerErrors({});
    setOverallDiscount('');
    setPaymentMethod('counter');
    setCashAmount('');
    setUpiAmount('');
    setSelectedCustomer(null);
    setAccountSearch('');
    setAccountPage(1);
    setSaleType('instant');
    setPackingAssigneeId(user?._id || null);
    setBillError(null);
    setSearch('');
    setPendingScan('');
    setAnnouncement('Ready for a new bill');
    searchInput.current?.focus();
  };

  const PAYMENT_OPTIONS = [
    { value: 'counter', label: 'Cash' },
    { value: 'upi_id', label: 'UPI' },
    { value: 'split', label: 'Split' },
    { value: 'credit', label: 'Udhar' },
  ];

  return (
    <div className="pos-workspace">
<header className="page-header"><div><h1>Point of sale</h1><p className="text-sm text-slate-500 mt-1">Select items, choose payment and create the bill.</p></div></header>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)]">
      {/* Left: Search + results */}
      <fieldset className="pos-items flex flex-col gap-3 min-w-0" disabled={draftLocked} aria-label="Bill items">
        {/* Search bar */}
        <div>
          <label htmlFor="pos-product-search" className="mb-2 block text-sm font-semibold">Search or scan barcode</label>
          <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            id="pos-product-search"
            ref={searchInput}
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCatalogPage(1); setPendingScan(''); }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !search.trim()) return;
              e.preventDefault();
              setPendingScan(search.trim());
            }}
            placeholder="Search items by name or barcode..."
            className="input pl-10 pr-10 text-base"
          />
          {searchPending && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin" />
          )}
          </div>
        </div>
        <a href="#pos-payment" className="workspace-link pos-mobile-summary">View bill and payment · ₹{grandTotal.toFixed(2)}</a>

        <section className="pos-catalog-section space-y-3" aria-label="Choose items">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{search.trim() ? 'Search results' : 'Tap an item to add it'}</h2>
            {search && <button type="button" onClick={() => { setSearch(''); searchInput.current?.focus(); }} className="workspace-link">Show all items</button>}
          </div>
          {searchError && <div className="workspace-feedback text-sm">
            <p role="alert">{searchError.data?.message || 'Could not load items. Check your connection and try again.'}</p>
            <button type="button" disabled={searchRetrySeconds > 0 || searching} onClick={retrySearch} className="workspace-link">
              {searchRetrySeconds > 0 ? 'Retry shortly' : 'Try again'}
            </button>
            {products.length > 0 && <p>Previously loaded items are shown below. Stock and prices are checked when saving.</p>}
          </div>}
          <CounterCatalog products={products} onAdd={addToCart} quantities={quantities} />
          {cart.length >= 100 && <p role="status" className="text-sm text-amber-600">This bill has 100 different packs. Start another bill for additional items.</p>}
          {!products.length && <p className="card p-5 text-sm text-slate-500" role="status">
            {searchPending ? 'Searching for items…' : search.trim() ? 'No items found. Try a name or barcode.' : 'No items yet. Add your first item from Products.'}
          </p>}
          {!search.trim() && (catalogPage > 1 || (catalogQuery.currentData?.meta?.totalPages ?? 1) > catalogPage) && <div className="flex items-center justify-between gap-2">
            <button type="button" className="btn-secondary" disabled={catalogPage <= 1 || searching} onClick={() => setCatalogPage((page) => page - 1)}>Previous items</button>
            <span className="text-sm">Page {catalogPage}</span>
            <button type="button" className="btn-secondary" disabled={searching || catalogPage >= (catalogQuery.currentData?.meta?.totalPages ?? catalogPage)} onClick={() => setCatalogPage((page) => page + 1)}>More items</button>
          </div>}
          {search.trim() && (searchQuery.currentData?.meta?.total ?? 0) > 24 && <p className="text-sm text-slate-500">More items match. Enter a fuller name or barcode.</p>}
        </section>

        {/* Cart */}
        {cart.length > 0 && (
          <div className="pos-cart-section space-y-2">
            <h2 className="text-base font-bold">
              Bill Items ({cart.length})
            </h2>
            <div className="pos-cart-list space-y-2">
            {cart.map((item) => (
              <CartRow
                key={item.id}
                item={item}
                onQty={updateQty}
                onRemove={removeItem}
                onDiscount={setItemDiscount}
                onSetQty={setQty}
              />
            ))}
            </div>
          </div>
        )}

        {cart.length === 0 && !debouncedSearch && (
          <div className="pos-empty-bill flex items-center gap-3 p-3 text-sm">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-gold-500/10 text-gold-400"><ShoppingCart size={23} aria-hidden="true" /></span>
            <p className="font-semibold">Your bill is empty</p>
            <p className="text-sm text-slate-500">Tap an item above to start. Customer details are optional.</p>
          </div>
        )}
      </fieldset>

      {/* Right: only overflowing content scrolls; checkout stays outside it. */}
      <aside className="pos-summary" aria-label="Bill and payment">
        <div className="pos-summary-scroll">
        <fieldset className="pos-summary-details" disabled={draftLocked} aria-label="Bill details">
          <section className="card pos-summary-card" aria-labelledby="receipt-preview">
            <h2 id="receipt-preview" className="text-base font-bold">Receipt preview</h2>
            {cart.length > 0 ? <ul className="pos-receipt-lines text-sm" aria-label="Receipt items">
              {cart.map((item) => <li key={item.id} className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words text-slate-400">{item.qty} × {item.name} · {item.variantName}</span>
                <span className="shrink-0 tabular-nums">₹{displayedLineTotal(item).toFixed(2)}</span>
              </li>)}
            </ul> : <p className="text-sm text-slate-500">Items appear here as you add them.</p>}
            <div className="flex justify-between text-sm text-slate-400"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
            <label className="pos-bill-discount flex items-center justify-between gap-2 text-sm text-slate-400">
              Discount ₹
              <input type="number" inputMode="decimal" aria-label="Bill discount" min="0" value={overallDiscount}
                onChange={(e) => setOverallDiscount(e.target.value)} placeholder="0" className="input text-right" />
            </label>
            <div className="border-t border-navy-700/40 pt-2 flex justify-between font-bold text-base">
              <span>Total</span><span>₹{grandTotal.toFixed(2)}</span>
            </div>
          </section>
          <section id="pos-payment" tabIndex={-1} className="card pos-summary-card pos-payment" aria-label="Payment options">
            <div className="pos-payment-controls">
            <div className="space-y-2 min-w-0">
            <h2 className="text-sm font-bold">Payment</h2>
            <div className="flex gap-2">
              {PAYMENT_OPTIONS.map((opt) => <button key={opt.value} type="button" aria-pressed={paymentMethod === opt.value}
                onClick={() => { setPaymentMethod(opt.value); setCustomerErrors({}); }}
                className={cn('pos-option flex-1 rounded-lg border text-sm font-semibold', paymentMethod === opt.value
                  ? 'border-gold-500/50 bg-gold-500/15 text-gold-400' : 'border-navy-600 text-slate-400')}>
                {opt.label}
              </button>)}
            </div>
            </div>
            {isSplit && <div className="space-y-3">
              <p className="text-xs text-slate-500">Enter what you receive now. The rest goes to Udhar.</p>
              <div className="grid grid-cols-2 gap-3">
                <Input name="cashAmount" label="Cash received (₹)" type="number" min="0" step="0.01" value={cashAmount} placeholder="0.00" onChange={(e) => setCashAmount(e.target.value)} />
                <Input name="upiAmount" label="UPI received (₹)" type="number" min="0" step="0.01" value={upiAmount} placeholder="0.00" onChange={(e) => setUpiAmount(e.target.value)} />
              </div>
              <div className="pos-udhar-total"><span>Remaining Udhar</span><strong>₹{pendingAmount.toFixed(2)}</strong></div>
              {paymentError && <p role="alert" className="text-xs text-red-400">{paymentError}</p>}
            </div>}
            <div className="space-y-2 min-w-0">
            <h2 className="text-sm font-bold">Packing & handover</h2>
            <div className="flex gap-2">
              {[{ value: 'instant', label: 'Instant Sale' }, { value: 'parcha', label: 'Needs packing' }].map((opt) =>
                <button key={opt.value} type="button" aria-pressed={saleType === opt.value} onClick={() => setSaleType(opt.value)}
                  className={cn('pos-option flex-1 rounded-lg border text-xs font-semibold', saleType === opt.value
                    ? 'border-gold-500/50 bg-gold-500/10 text-gold-400' : 'border-navy-600 text-slate-400')}>
                  {opt.label}
                </button>)}
            </div>
            </div>
            </div>
            {isUdhar && <p className="text-xs text-slate-500">Select a customer account below for the remaining amount.</p>}
            {saleType === 'instant' ? <p className="text-xs text-slate-500">Items are ready and being handed over now. Your name and the handover time will be recorded.</p> : <div className="space-y-3">
              <p className="text-xs text-slate-500">Stock is reserved. This bill stays in Pack Orders until packing, verification and handover are complete.</p>
              {hasPermission(user, PERMISSIONS.ORDERS_ASSIGN) && hasPermission(user, PERMISSIONS.STAFF_VIEW)
                ? <WorkAssigneePicker kind="packing" current={packingAssigneeId === user?._id ? user : packingAssigneeId} onSave={setPackingAssigneeId} draft />
                : <label className="text-sm">Packing assignment<select className="input mt-2" value={packingAssigneeId || ''} onChange={(e) => setPackingAssigneeId(e.target.value || null)}><option value={user?._id}>I will pack</option><option value="">Assign later</option></select></label>}
            </div>}
          </section>
          <section className="card pos-summary-card pos-customer" aria-label="Customer details">
            <h2 className="text-sm font-bold flex items-center gap-1.5"><User size={14} />{isUdhar ? 'Customer' : 'Customer (optional)'}</h2>
            {isUdhar ? <div className="space-y-3">
              <Input name="accountSearch" label="Search customer by name or phone" maxLength={80} value={accountSearch}
                placeholder="Name or mobile number" onChange={(e) => { setAccountSearch(e.target.value); setAccountPage(1); setCustomerErrors({}); }} />
              <label className="block text-sm" htmlFor="pos-udhar-account">Select Udhar account *</label>
              <select id="pos-udhar-account" className="input w-full" value={udharCustomer?._id || ''} required
                aria-invalid={Boolean(customerErrors.customerPhone)} aria-describedby={customerErrors.customerPhone ? 'pos-account-error' : undefined}
                onChange={(e) => { const customer = accountOptions.find((option) => option._id === e.target.value) || null; setSelectedCustomer(customer); setCustomerPhone(customer?.phone || ''); setCustomerErrors({}); }}>
                <option value="">Choose a customer</option>
                {udharCustomer && !accountOptions.some((option) => option._id === udharCustomer._id) && <option value={udharCustomer._id}>{udharCustomer.name} · {udharCustomer.phone}</option>}
                {accountOptions.map((customer) => <option key={customer._id} value={customer._id}>{customer.name} · {customer.phone}</option>)}
              </select>
              {findingUdhar && <p role="status" className="text-xs text-slate-500">Finding accounts…</p>}
              {udharError && <div role="alert" className="text-xs text-red-400">Could not load accounts. <button type="button" onClick={refetchAccounts} className="workspace-link">Try again</button></div>}
              {!findingUdhar && !udharError && !accountOptions.length && <p className="text-xs text-slate-500">No matching accounts. Try a name or mobile number.</p>}
              {udharData?.meta?.totalPages > 1 && <div className="flex justify-between items-center text-xs gap-2"><button type="button" disabled={accountPage === 1 || findingUdhar} className="workspace-link" onClick={() => setAccountPage((page) => page - 1)}>Previous</button><span>Page {accountPage}</span><button type="button" disabled={!udharData.meta.hasNextPage || findingUdhar} className="workspace-link" onClick={() => setAccountPage((page) => page + 1)}>More accounts</button></div>}
              {customerErrors.customerPhone && <p id="pos-account-error" role="alert" className="text-xs text-red-400">{customerErrors.customerPhone}</p>}
              {udharCustomer && <div className="pos-account-selected text-sm"><strong>{udharCustomer.name}</strong><p className="text-xs text-slate-500">{udharCustomer.phone} · Existing due ₹{Number(udharCustomer.balance || 0).toFixed(2)}</p><p className="text-xs mt-1">Due after this bill: ₹{(Number(udharCustomer.balance || 0) + pendingAmount).toFixed(2)}</p></div>}
            </div> : <div className="grid gap-3 grid-cols-2">
              {!isUdhar && <Input name="customerName" label="Customer name" maxLength={80} value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); setCustomerErrors((previous) => ({ ...previous, customerName: undefined })); }}
                error={customerErrors.customerName} />}
              <Input name="customerPhone" label="Phone number" type="tel" value={customerPhone}
                onChange={(e) => { setCustomerPhone(e.target.value); setCustomerErrors((previous) => ({ ...previous, customerPhone: undefined })); }}
                error={customerErrors.customerPhone} />
            </div>}
            {isUdhar && hasPermission(user, PERMISSIONS.ACCOUNTING_MANAGE) && !udharCustomer && <a href={'/store/udhar?new=1&phone=' + encodeURIComponent(/^[6-9]\d{9}$/.test(accountSearch.trim()) ? accountSearch.trim() : phone) + '&name=' + encodeURIComponent(/\D/.test(accountSearch.trim()) ? accountSearch.trim() : '')} target="_blank" rel="noopener noreferrer" className="workspace-link">Create an Udhar account</a>}
          </section>
        </fieldset>
        </div>
        <div className="pos-checkout">
          {isSplit && <div className="flex justify-between gap-2 text-sm"><span className="text-slate-500">Receiving now</span><strong>₹{((cashMinor + upiMinor) / 100).toFixed(2)}</strong></div>}
          <div className="flex justify-between gap-2 text-sm"><span className="text-slate-500">Amount to {isUdhar ? 'add to Udhar' : 'collect'}</span><strong>₹{(isUdhar ? pendingAmount : grandTotal).toFixed(2)}</strong></div>
          {billError && <p className="workspace-feedback text-sm" role="alert">{billError}</p>}
          {retryPending && <p role="status" className="text-xs text-amber-300">{retryAt ? 'Request limit reached. The bill draft is intact.' : 'Could not confirm the bill. Retry to retrieve or complete the original sale.'}</p>}
          <a href="#pos-payment" className="workspace-link pos-payment-link">Payment <span className="font-normal text-slate-400">{PAYMENT_OPTIONS.find((option) => option.value === paymentMethod).label}</span></a>
          <button disabled={(!cart.length && !retryPending) || submitting || retrySeconds > 0} onClick={handleSubmit} className="btn-primary w-full min-h-12 text-base tabular-nums">
            {submitting ? <div role="status" aria-label="Saving bill" className="w-5 h-5 border-2 border-navy-700/30 border-t-navy-700 rounded-full animate-spin" />
              : <><CheckCircle2 size={18} />{retrySeconds > 0 ? `Retry bill in ${retrySeconds}s` : retryPending ? 'Retry original bill' : isUdhar ? 'Create Udhar Bill' : 'Collect Payment'}{!retryPending && grandTotal > 0 && ` · ₹${grandTotal.toFixed(2)}`}</>}
          </button>
        </div>
      </aside>
      </div>

      {/* Bill modal */}
      {billOrder && (
        <BillReceipt
          order={billOrder}
          store={store}
          onClose={handleNewSale}
          onNewSale={handleNewSale}
        />
      )}
    </div>
  );
}
