import { setCredentials } from '../auth/authSlice';
import { clearCart } from './cartSlice';
import { clearGuestCartDrafts, removeCartDraft, writeCartDraft } from './cartDraftStorage';
import { currentCartItem } from './restoreCartDraft';

export const cartDraftMiddleware = ({ getState, dispatch }) => (next) => (action) => {
  const before = getState();
  const result = next(action);
  const after = getState();

  if (setCredentials.match(action) && !before.auth.user && after.auth.user) clearGuestCartDrafts();

  const cart = after.cart;
  if (action.type === 'api/executeQuery/fulfilled' && action.meta.arg.endpointName === 'getCartProducts' &&
      cart.status === 'ready' && cart.slug === action.meta.arg.originalArgs.slug) {
    const products = action.payload?.data?.products;
    if (Array.isArray(products)) {
      const requested = new Set(action.meta.arg.originalArgs.productIds);
      const byId = new Map(products.map((product) => [product._id, product]));
      const items = cart.items.map((line) => requested.has(line.productId) ? currentCartItem(line, byId.get(line.productId)) : line).filter(Boolean);
      if (JSON.stringify(items) !== JSON.stringify(cart.items)) dispatch({ type: 'cart/reconcileProducts', payload: items });
    }
  }
  if (clearCart.match(action)) {
    removeCartDraft(action.payload);
  } else if (cart.status === 'ready' && (before.cart.status !== 'ready' ||
      cart.items !== before.cart.items || cart.deliveryType !== before.cart.deliveryType || cart.coupon !== before.cart.coupon)) {
    writeCartDraft(cart);
  }
  return result;
};
