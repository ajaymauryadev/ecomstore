import { createSlice } from '@reduxjs/toolkit';
import { clearCredentials, setCredentials } from '../auth/authSlice';
import { restoreCartDraft } from './restoreCartDraft';

const initialState = {
  items: [],
  slug: null,
  draftRevision: 0,
  scopeKey: null,
  userId: null,
  status: 'idle',
  restoreRequestId: null,
  restoredWithChanges: false,
  provisional: false,
  pendingCouponCode: null,
  isOpen: false,
  deliveryType: 'home_delivery',
  deliveryCharge: 0,
  coupon: null,
  couponDiscount: 0,
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    reconcileProducts: (state, { payload }) => {
      state.items = payload;
      state.restoredWithChanges = true;
      if (state.coupon) {
        state.pendingCouponCode = state.coupon.code;
        state.coupon = null;
        state.couponDiscount = 0;
        state.provisional = true;
      }
    },
    showSavedDraft: (state, { payload }) => {
      if (state.scopeKey === payload.scopeKey && state.restoreRequestId === payload.requestId) {
        state.items = payload.items;
        state.deliveryType = payload.deliveryType;
        state.status = 'ready';
        state.provisional = true;
        state.pendingCouponCode = payload.pendingCouponCode ?? null;
      }
    },
    addItem: (state, action) => {
      state.draftRevision++;
      const existing = state.items.find((i) => i._id === action.payload._id);
      if (existing) {
        existing.quantity = Math.min(existing.quantity + 1, action.payload.stock ?? 999);
      } else {
        state.items.push({ ...action.payload, quantity: 1 });
      }
    },

    removeItem: (state, action) => {
      state.draftRevision++;
      state.items = state.items.filter((i) => i._id !== action.payload);
    },

    updateQuantity: (state, action) => {
      state.draftRevision++;
      const { id, quantity } = action.payload;
      if (quantity <= 0) {
        state.items = state.items.filter((i) => i._id !== id);
      } else {
        const item = state.items.find((i) => i._id === id);
        if (item) item.quantity = quantity;
      }
    },

    clearCart: (state, action) => {
      if (state.scopeKey === action.payload) {
        return { ...initialState, scopeKey: state.scopeKey, userId: state.userId, slug: state.slug, status: 'ready' };
      }
    },

    toggleCart: (state) => { state.isOpen = !state.isOpen; },
    openCart: (state) => { state.isOpen = true; },
    closeCart: (state) => { state.isOpen = false; },

    setDeliveryType: (state, action) => {
      state.draftRevision++;
      state.deliveryType = action.payload; // 'home_delivery' | 'self_pickup'
      if (action.payload === 'self_pickup') state.deliveryCharge = 0;
    },

    setDeliveryCharge: (state, action) => {
      state.deliveryCharge = Number(action.payload) || 0;
    },

    applyCoupon: (state, action) => {
      const { scopeKey, coupon, discount } = action.payload;
      if (state.scopeKey === scopeKey && state.status === 'ready' && state.items.length) {
        state.draftRevision++;
        state.pendingCouponCode = null;
        state.coupon = coupon;
        state.couponDiscount = discount;
      }
    },

    removeCoupon: (state) => {
      state.draftRevision++;
      state.pendingCouponCode = null;
      state.coupon = null;
      state.couponDiscount = 0;
    },
  },
  extraReducers: (builder) => builder
    .addCase(setCredentials, (state, { payload }) => {
      if (state.userId !== (payload.user?._id ?? null)) return initialState;
    })
    .addCase(clearCredentials, (state) => {
      if (state.userId) return initialState;
    })
    .addCase(restoreCartDraft.pending, (_, { meta }) => ({
      ...initialState,
      scopeKey: meta.arg.scopeKey,
      userId: meta.arg.userId,
      slug: meta.arg.slug,
      restoreRequestId: meta.requestId,
      status: 'loading',
    }))
    .addCase(restoreCartDraft.fulfilled, (state, { payload, meta }) => {
      if (state.restoreRequestId === meta.requestId) {
        Object.assign(state, payload, { status: 'ready', restoreRequestId: null });
      }
    })
    .addCase(restoreCartDraft.rejected, (state, { meta }) => {
      if (state.restoreRequestId === meta.requestId && !meta.aborted) {
        state.status = 'error';
        state.restoreRequestId = null;
      }
    }),
});

export const {
  addItem, removeItem, updateQuantity, clearCart,
  toggleCart, openCart, closeCart,
  setDeliveryType, setDeliveryCharge, applyCoupon, removeCoupon,
} = cartSlice.actions;

export const selectCartItems = (state) => state.cart.items;
export const selectCartCount = (state) => state.cart.items.reduce((s, i) => s + i.quantity, 0);
export const selectCartSubtotal = (state) =>
  state.cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
export const selectCartTotal = (state) => {
  const sub = state.cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  return sub - state.cart.couponDiscount + state.cart.deliveryCharge;
};
export const selectCartOpen = (state) => state.cart.isOpen;
export const selectItemQuantity = (id) => (state) =>
  state.cart.items.find((i) => i._id === id)?.quantity ?? 0;
export const selectDeliveryType = (state) => state.cart.deliveryType;
export const selectDeliveryCharge = (state) => state.cart.deliveryCharge;
export const selectCoupon = (state) => state.cart.coupon;
export const selectCouponDiscount = (state) => state.cart.couponDiscount;
export const selectCartScope = (state) => state.cart.scopeKey;

export default cartSlice.reducer;
