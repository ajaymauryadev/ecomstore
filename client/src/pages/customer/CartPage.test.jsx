import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import cartReducer from '../../features/cart/cartSlice';
import CartPage from './CartPage';

vi.mock('../../features/orders/orderApi', () => ({ useValidateCouponMutation: () => [vi.fn(), {}] }));
vi.mock('../../features/storefront/storefrontApi', () => ({
  useGetStorefrontInfoQuery: () => ({ data: { data: { store: { deliverySettings: { defaultCharge: 40 } } } } }),
}));

test('switches delivery options and leaves a pickup cart for checkout without a cleanup crash', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const store = configureStore({ reducer: { cart: cartReducer }, preloadedState: { cart: {
    ...cartReducer(undefined, { type: 'init' }), status: 'ready',
    items: [{ _id: 'rice', name: 'Rice', variantName: '1 kg', price: 100, quantity: 1, stock: 20 }],
  } } });
  render(<Provider store={store}><MemoryRouter initialEntries={['/s/test/cart']}><Routes>
    <Route path="/s/:storeSlug/cart" element={<CartPage />} />
    <Route path="/s/:storeSlug/checkout" element={<h1>Checkout</h1>} />
  </Routes></MemoryRouter></Provider>);
  expect(store.getState().cart.deliveryCharge).toBe(40);
  fireEvent.click(screen.getByRole('button', { name: 'Store Pickup' }));
  expect(store.getState().cart.deliveryCharge).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Home Delivery' }));
  expect(store.getState().cart.deliveryCharge).toBe(40);
  fireEvent.click(screen.getByRole('button', { name: 'Store Pickup' }));
  fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
  expect(screen.getByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
  expect(errors).not.toHaveBeenCalled();
});
