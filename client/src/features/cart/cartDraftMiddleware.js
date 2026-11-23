import { setCredentials } from '../auth/authSlice';
import { clearCart } from './cartSlice';
import { clearGuestCartDrafts, removeCartDraft, writeCartDraft } from './cartDraftStorage';

export const cartDraftMiddleware = ({ getState }) => (next) => (action) => {
  const before = getState();
  const result = next(action);
  const after = getState();

  if (setCredentials.match(action) && !before.auth.user && after.auth.user) clearGuestCartDrafts();

  const cart = after.cart;
  if (clearCart.match(action)) {
    removeCartDraft(action.payload);
  } else if (cart.status === 'ready' && (before.cart.status !== 'ready' ||
      cart.items !== before.cart.items || cart.deliveryType !== before.cart.deliveryType || cart.coupon !== before.cart.coupon)) {
    writeCartDraft(cart);
  }
  return result;
};
