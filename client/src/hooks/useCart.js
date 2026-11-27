import { useSelector, useDispatch } from 'react-redux';
import { useCallback } from 'react';
import {
  selectCartItems, selectCartCount, selectCartSubtotal, selectCartTotal,
  selectCartOpen, selectDeliveryType, selectDeliveryCharge,
  selectCoupon, selectCouponDiscount, selectCartScope,
  addItem, removeItem, updateQuantity, clearCart,
  toggleCart, openCart, closeCart,
  setDeliveryType, setDeliveryCharge, applyCoupon, removeCoupon,
} from '../features/cart/cartSlice';

export const useCart = () => {
  const dispatch = useDispatch();
  const items = useSelector(selectCartItems);
  const count = useSelector(selectCartCount);
  const subtotal = useSelector(selectCartSubtotal);
  const total = useSelector(selectCartTotal);
  const isOpen = useSelector(selectCartOpen);
  const deliveryType = useSelector(selectDeliveryType);
  const deliveryCharge = useSelector(selectDeliveryCharge);
  const coupon = useSelector(selectCoupon);
  const couponDiscount = useSelector(selectCouponDiscount);
  const scopeKey = useSelector(selectCartScope);
  const provisional = useSelector((state) => state.cart.provisional);
  const updateDeliveryCharge = useCallback((charge) => dispatch(setDeliveryCharge(charge)), [dispatch]);

  const getItemQuantity = (id) => items.find((i) => i._id === id)?.quantity ?? 0;

  return {
    items,
    provisional,
    count,
    subtotal,
    total,
    isOpen,
    isEmpty: items.length === 0,
    deliveryType,
    deliveryCharge,
    coupon,
    couponDiscount,
    getItemQuantity,
    addItem: (product) => dispatch(addItem(product)),
    removeItem: (id) => dispatch(removeItem(id)),
    updateQuantity: (id, quantity) => dispatch(updateQuantity({ id, quantity })),
    clearCart: () => dispatch(clearCart(scopeKey)),
    toggleCart: () => dispatch(toggleCart()),
    openCart: () => dispatch(openCart()),
    closeCart: () => dispatch(closeCart()),
    setDeliveryType: (type) => dispatch(setDeliveryType(type)),
    setDeliveryCharge: updateDeliveryCharge,
    applyCoupon: (coupon, discount) => dispatch(applyCoupon({ scopeKey, coupon, discount })),
    removeCoupon: () => dispatch(removeCoupon()),
  };
};
