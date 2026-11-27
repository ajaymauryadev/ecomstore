import { StrictMode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import authReducer from '../../../features/auth/authSlice';
import AuthInit from '../AuthInit';

const { refresh, logout } = vi.hoisted(() => ({ refresh: vi.fn(), logout: vi.fn() }));
vi.mock('../../../features/auth/authApi', () => ({ useRefreshTokenMutation: () => [refresh], useLogoutMutation: () => [logout] }));
afterEach(() => vi.resetAllMocks());

function mount() {
  const store = configureStore({ reducer: { auth: authReducer } });
  render(<StrictMode><Provider store={store}><AuthInit><p>Store content</p></AuthInit></Provider></StrictMode>);
  return store;
}

test('a startup server error retains session recovery and restores the user on retry', async () => {
  refresh.mockReturnValueOnce({ unwrap: () => Promise.reject({ status: 500 }) })
    .mockReturnValueOnce({ unwrap: () => Promise.resolve({ data: { user: { _id: 'owner' }, accessToken: 'renewed' } }) });
  const store = mount();
  expect(await screen.findByText('Connection interrupted')).toBeInTheDocument();
  expect(store.getState().auth.isInitialized).toBe(false);
  expect(screen.queryByText('Store content')).not.toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Store content')).toBeInTheDocument();
  expect(store.getState().auth.user._id).toBe('owner');
});

test('retries automatically when the connection comes back', async () => {
  refresh.mockReturnValueOnce({ unwrap: () => Promise.reject({ status: 'FETCH_ERROR' }) })
    .mockReturnValueOnce({ unwrap: () => Promise.resolve({ data: { user: { _id: 'customer' }, accessToken: 'renewed' } }) });
  mount();
  await screen.findByText('Connection interrupted');
  act(() => window.dispatchEvent(new Event('online')));
  expect(await screen.findByText('Store content')).toBeInTheDocument();
});

test('allows an anonymous visitor only when the server confirms there is no session', async () => {
  refresh.mockReturnValue({ unwrap: () => Promise.reject({ status: 401 }) });
  const store = mount();
  await waitFor(() => expect(store.getState().auth.isInitialized).toBe(true));
  expect(screen.getByText('Store content')).toBeInTheDocument();
  expect(store.getState().auth.user).toBeNull();
  expect(store.getState().auth.sessionEpoch).toBe(0);
});
