import { useNavigationPrefetch } from '../../hooks/useNavigationPrefetch';
import { useState, useEffect } from 'react';
import { Outlet, useParams, Link, useNavigate, useLocation, useMatch, Navigate } from 'react-router-dom';
import RouteContent from './RouteContent';
import MobileNavigation from './MobileNavigation';
import { ROUTES } from '../../constants/routes';
import { WorkspaceTheme } from './WorkspaceTheme';
import './workspace.css';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  ShoppingCart, Plus, Minus, Trash2, Home, LayoutGrid,
  User, Tag, Truck, Store, AlertTriangle,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { useCart } from '../../hooks/useCart';
import { cartDraftKey } from '../../features/cart/cartDraftStorage';
import { restoreCartDraft } from '../../features/cart/restoreCartDraft';
import { selectCurrentUser } from '../../features/auth/authSlice';
import { useGetStorefrontInfoQuery } from '../../features/storefront/storefrontApi';
import { formatCurrency } from '../../utils/formatters';
import { PageLoader } from '../ui/Spinner';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import StoreSearch from '../products/StoreSearch';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) {
  if (!url) return null;
  return url?.startsWith('/') ? `${API_BASE}${url}` : url;
}

function searchDestination(storeSlug, location, search) {
  const base = `/s/${storeSlug}`;
  const isCatalog = [base, `${base}/search`, `${base}/categories`].includes(location.pathname);
  const params = new URLSearchParams(isCatalog ? location.search : '');
  if (search) params.set('q', search);
  else params.delete('q');
  const path = location.pathname === `${base}/categories` ? `${base}/categories` : search ? `${base}/search` : base;
  return `${path}${params.size ? `?${params}` : ''}`;
}

/* ─── Cart Drawer ─────────────────────────────────── */
function CartDrawer({ isOpen, onClose }) {
  const { items, count, subtotal, total, deliveryCharge, couponDiscount, coupon, updateQuantity } = useCart();
  const { storeSlug } = useParams();
  const navigate = useNavigate();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`My Cart (${count})`} closeLabel="Close cart"
      className="workspace-cart" overlayClassName="workspace-cart-overlay">
        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="workspace-cart-empty flex flex-col items-center justify-center h-full gap-3 text-slate-500 py-16">
              <div className="workspace-cart-empty-icon"><ShoppingCart size={48} strokeWidth={1.5} /></div>
              <p className="font-medium text-slate-400">Your cart is empty</p>
              <p className="text-sm">Add items to get started</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {items.map((item) => (
                <div key={item._id} className="flex items-center gap-3 bg-navy-800 rounded-xl p-3 border border-navy-700/40">
                  {item.image ? (
                    <img src={imgSrc(item.image)} alt={item.name} className="w-14 h-14 rounded-lg object-cover bg-navy-700 shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-navy-700 shrink-0 flex items-center justify-center">
                      <ShoppingCart size={18} className="text-navy-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 leading-tight line-clamp-1">{item.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{item.variantName}</p>
                    <p className="text-gold-400 font-bold text-sm mt-1">{formatCurrency(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${item.name}`}
                      onClick={() => updateQuantity(item._id, item.quantity - 1)}
                      className="w-11 h-11 rounded-lg bg-navy-700 hover:bg-navy-600 flex items-center justify-center text-slate-300 transition-colors"
                    >
                      {item.quantity === 1 ? <Trash2 size={11} className="text-red-400" /> : <Minus size={11} />}
                    </button>
                    <span className="text-sm font-bold text-slate-100 w-5 text-center select-none">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${item.name}`}
                      disabled={item.quantity >= item.stock}
                      onClick={() => updateQuantity(item._id, item.quantity + 1)}
                      className="w-11 h-11 rounded-lg bg-gold-500/10 hover:bg-gold-500/20 disabled:opacity-40 flex items-center justify-center text-gold-400 transition-colors"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="shrink-0 border-t border-navy-700/60 p-4 space-y-3 safe-bottom bg-navy-900">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span className="text-slate-200">{formatCurrency(subtotal)}</span>
              </div>
              {couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span className="flex items-center gap-1"><Tag size={11} /> {coupon?.code}</span>
                  <span>-{formatCurrency(couponDiscount)}</span>
                </div>
              )}
              {deliveryCharge > 0 && (
                <div className="flex justify-between text-slate-400">
                  <span className="flex items-center gap-1"><Truck size={11} /> Delivery</span>
                  <span>{formatCurrency(deliveryCharge)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-100 pt-1 border-t border-navy-700/60">
                <span>Total</span>
                <span className="text-gold-400">{formatCurrency(total)}</span>
              </div>
            </div>
            <button
              onClick={() => { onClose(); navigate(`/s/${storeSlug}/checkout`); }}
              className="btn btn-primary btn-lg w-full"
            >
              Proceed to Checkout
            </button>
          </div>
        )}
    </Modal>
  );
}

/* ─── Main Layout ─────────────────────────────────── */
export default function CustomerLayout() {
  const prefetchHandlers = useNavigationPrefetch();
  const [search, setSearch] = useState('');
  const [searchEdited, setSearchEdited] = useState(false);
  const settledSearch = useDebouncedValue(search.trim(), 250);
  const { count, isOpen, openCart, closeCart } = useCart();
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const user = useSelector(selectCurrentUser);
  const { scopeKey, status, restoredWithChanges } = useSelector((state) => state.cart);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  const { currentData: storeData, isFetching: isStoreFetching, isError: isStoreError, error: storeError, refetch: refetchStore } = useGetStorefrontInfoQuery(storeSlug, { skip: !storeSlug });
  const store = storeData?.data?.store;
  const isAuth = useMatch('/s/:storeSlug/auth');
  const isCheckout = useMatch('/s/:storeSlug/checkout');
  const isCart = useMatch('/s/:storeSlug/cart');
  const isCustomer = user?.role === 'customer' && (user.tenantId?._id ?? user.tenantId) === store?._id;
  const sessionUserId = user?._id ?? null;
  const userId = isCustomer ? sessionUserId : null;
  const expectedScope = cartDraftKey(store?._id, userId);
  const cartReady = scopeKey === expectedScope && status === 'ready';

  useEffect(() => {
    if (!expectedScope) return;
    const request = dispatch(restoreCartDraft({ scopeKey: expectedScope, slug: storeSlug, userId, sessionUserId }));
    return () => request.abort();
  }, [dispatch, expectedScope, restoreAttempt, storeSlug, userId, sessionUserId]);

  useEffect(() => {
    setSearch(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!searchEdited || settledSearch !== search.trim()) return;
    setSearchEdited(false);
    navigate(searchDestination(storeSlug, location, settledSearch), { replace: true });
  }, [settledSearch, searchEdited, search, storeSlug, navigate, location]);

  if (isStoreFetching && !store) return <PageLoader className="workspace-theme" />;
  if (isStoreError || !store) {
    const unavailable = storeError?.status === 404;
    return (
      <main className="workspace-theme min-h-screen bg-navy-950 flex items-center justify-center p-6">
        <div className="card max-w-md p-8 text-center">
          <AlertTriangle size={44} className="mx-auto text-amber-400" aria-hidden="true" />
          <h1 className="text-xl font-bold text-slate-100 mt-4">{unavailable ? 'Store unavailable' : 'Store could not be loaded'}</h1>
          <p className="text-sm text-slate-400 mt-2">{unavailable ? 'This store is inactive, expired, or the address is incorrect.' : 'Check your connection and try again.'}</p>
          {!unavailable && <Button className="mt-5" variant="secondary" onClick={refetchStore}>Try again</Button>}
        </div>
      </main>
    );
  }

  if (isAuth) return <RouteContent><Outlet context={{ store }} /></RouteContent>;

  if (isCheckout && !isCustomer) {
    return <Navigate to={`/s/${storeSlug}/auth`} state={{ checkout: true, buyNow: location.state?.buyNow }} replace />;
  }

  // Only cart/checkout require restored cart data. Browsing and order history
  // must not wait for an unrelated product/coupon verification request.
  if ((isCart || isCheckout) && (scopeKey !== expectedScope || status === 'idle' || status === 'loading')) return <PageLoader className="workspace-theme" />;
  if ((isCart || isCheckout) && status === 'error') {
    return (
      <main className="workspace-theme min-h-screen bg-navy-950 flex items-center justify-center p-6">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-xl font-bold text-slate-100">Cart could not be checked</h1>
          <p className="text-sm text-slate-400 mt-2">Your draft is saved in this tab. Check your connection and try again.</p>
          <Button className="mt-5" variant="secondary" onClick={() => setRestoreAttempt((attempt) => attempt + 1)}>Try again</Button>
        </div>
      </main>
    );
  }

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchEdited(false);
    navigate(searchDestination(storeSlug, location, search.trim()));
  };

  const cartLabel = `Open cart with ${count} items`;
  const mobileItems = [
    { label: 'Home', icon: Home, to: ROUTES.STOREFRONT(storeSlug), end: true },
    { label: 'Categories', icon: LayoutGrid, to: ROUTES.STOREFRONT_CATEGORIES(storeSlug) },
    { label: 'Account', icon: User, to: isCustomer ? ROUTES.STOREFRONT_ACCOUNT(storeSlug) : ROUTES.STOREFRONT_AUTH(storeSlug) },
    { label: 'Cart', icon: ShoppingCart, onClick: openCart, disabled: !cartReady, ariaLabel: cartLabel, expanded: isOpen, active: isOpen, count },
  ];

  const isOrderPage = location.pathname.includes('/orders/');

  return (
    <WorkspaceTheme.Provider value>
      <div className="workspace-theme customer-layout flex flex-col overflow-hidden bg-navy-950" {...prefetchHandlers}>
        <a href="#shop-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 btn btn-primary">Skip to main content</a>
        {/* Sticky Header */}
        <header className="shrink-0 z-40 bg-navy-900 border-b border-navy-700/60">
          <div className="page-width">
            <div className="customer-header-row flex items-center gap-2 sm:gap-4 min-h-16 py-2">
              {/* Logo / Store name */}
              <Link to={`/s/${storeSlug}`} aria-label={`${store.name} home`} className="min-w-0 flex items-center gap-2">
                <div className="w-7 h-7 shrink-0 workspace-mark rounded-lg flex items-center justify-center">
                  <Store size={14} aria-hidden="true" />
                </div>
                <span className="font-black text-slate-100 text-base leading-tight truncate max-w-40 hidden sm:block">
                  {store?.name || 'Kirana'}
                </span>
              </Link>

              {/* Search */}
              <StoreSearch value={search} storeSlug={storeSlug} onSubmit={handleSearch}
                onChange={(value) => { setSearch(value); setSearchEdited(true); }}
                onClear={() => { setSearch(''); setSearchEdited(false); navigate(searchDestination(storeSlug, location, '')); }} />

              {/* Account */}
              {isCustomer ? (
                <Link
                  to={`/s/${storeSlug}/account`}
                  aria-label="Customer account"
                  title="Account"
                  className="relative hidden min-w-11 min-h-11 md:inline-flex items-center justify-center rounded-xl bg-navy-800 border border-navy-600 hover:border-gold-500/50 text-slate-300 hover:text-gold-400 transition-all shrink-0"
                >
                  <User size={18} />
                </Link>
              ) : (
                <Link
                  to={`/s/${storeSlug}/auth`}
                  className="btn btn-secondary btn-sm min-w-11 min-h-11 shrink-0 px-2 sm:px-3"
                >
                  <User size={18} aria-hidden="true" /><span className="sr-only sm:not-sr-only">Login</span>
                </Link>
              )}

              {/* Cart */}
              {!isCheckout && (
                <button
                  onClick={openCart}
                  disabled={!cartReady}
                  aria-label={cartLabel}
                  aria-expanded={isOpen}
                  title="Cart"
                  className="relative hidden min-w-11 min-h-11 md:inline-flex items-center justify-center rounded-xl bg-navy-800 border border-navy-600 hover:border-gold-500/50 text-slate-300 hover:text-gold-400 transition-all shrink-0"
                >
                  <ShoppingCart size={20} />
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 bg-gold-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Delivery strip */}
        {!isOrderPage && (
          <div className="shrink-0 bg-[var(--brand-tint)] border-b border-navy-700/30">
            <div className="page-width py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
              {!store.orderSettings?.isAcceptingOrders ? <span className="text-amber-300">Online ordering is currently paused.</span> : <>
                {store.deliverySettings?.minOrderAmount > 0 && <div className="flex items-center gap-1.5"><ShoppingCart size={11} className="text-gold-500" /><span>Minimum delivery order <strong className="text-slate-200">{formatCurrency(store.deliverySettings.minOrderAmount)}</strong></span></div>}
                {store.deliverySettings?.freeDeliveryAbove > 0 && <div className="flex items-center gap-1.5"><Truck size={11} className="text-gold-500" /><span>Free delivery above <strong className="text-slate-200">{formatCurrency(store.deliverySettings.freeDeliveryAbove)}</strong></span></div>}
              </>}
            </div>
          </div>
        )}

        {/* Page content */}
        <div key={location.pathname} className="customer-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          <main id="shop-content" tabIndex={-1} className="page-width customer-main py-5 sm:py-8">
            {!cartReady && <div role="status" className="mb-4 text-sm text-slate-400">
              {status === 'error' ? <>
                Cart could not be checked. Your saved draft is retained.
                <button type="button" className="ml-2 underline" onClick={() => setRestoreAttempt((attempt) => attempt + 1)}>Retry cart</button>
              </> : 'Checking saved cart… You can continue browsing.'}
            </div>}
            {restoredWithChanges && (
              <p role="status" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                Cart availability or coupon eligibility changed. Review your cart before checkout.
              </p>
            )}
            <RouteContent><Outlet context={{ search, store, cartReady }} /></RouteContent>
          </main>
        </div>

        {!isCheckout && <MobileNavigation label="Shop navigation" items={mobileItems} className="md:hidden" />}

        {cartReady && <CartDrawer isOpen={isOpen} onClose={closeCart} />}
      </div>
    </WorkspaceTheme.Provider>
  );
}
