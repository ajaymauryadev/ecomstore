import { StrictMode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import authReducer, { restoreOfflineIdentity, setCredentials } from '../../../features/auth/authSlice';
import savedDataReducer, { savedDataStatus } from '../../../offline/savedDataSlice';
import AuthInit from '../AuthInit';

const { refresh, logout } = vi.hoisted(() => ({ refresh: vi.fn(), logout: vi.fn() }));
vi.mock('../../../features/auth/authApi', () => ({ useRefreshTokenMutation: () => [refresh], useLogoutMutation: () => [logout] }));
afterEach(() => vi.resetAllMocks());

function mount(identity, status = { identityReady: true }) {
  const store = configureStore({ reducer: { auth: authReducer, savedData: savedDataReducer,
    api: (state = { mutations: {} }, action) => action.type === 'test/signIn'
      ? { mutations: action.payload ? { login: { endpointName: 'login', status: 'pending' } } : {} } : state } });
  store.dispatch(savedDataStatus(status));
  if (identity) store.dispatch(restoreOfflineIdentity(identity));
  render(<StrictMode><Provider store={store}><MemoryRouter initialEntries={[window.location.pathname]}><AuthInit><p>Store content</p></AuthInit></MemoryRouter></Provider></StrictMode>);
  return store;
}

test('saved content is visible before session refresh resolves and survives a network error', async () => {
  let fail;
  refresh.mockReturnValue({ unwrap: () => new Promise((_resolve, reject) => { fail = reject; }) });
  mount({ user: { _id: 'owner' }, store: { _id: 'shop' }, verifiedAt: Date.now() });
  const content = screen.getByText('Store content');
  expect(content).toBeVisible();
  await act(async () => fail({ status: 'FETCH_ERROR' }));
  expect(screen.getByText('Store content')).toBe(content);
  expect(content).toBeVisible();
});

test('delayed device identity holds refresh but leaves the public login route mounted', async () => {
  window.history.replaceState({}, '', '/login');
  refresh.mockReturnValue({ unwrap: () => Promise.reject({ status: 401 }) });
  try {
    const store = mount(null, { identityReady: false });
    expect(screen.getByText('Store content')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
    act(() => store.dispatch(savedDataStatus({ identityReady: true })));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  } finally { window.history.replaceState({}, '', '/'); }
});

test('StrictMode starts only one refresh for a boot epoch', async () => {
  refresh.mockReturnValue({ unwrap: () => new Promise(() => {}) });
  mount();
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

test('a late refresh cannot replace a newly signed-in account', async () => {
  let release;
  refresh.mockReturnValue({ unwrap: () => new Promise((resolve) => { release = resolve; }) });
  const store = mount();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => store.dispatch(setCredentials({ user: { _id: 'account-b' }, accessToken: 'b' })));
  await act(async () => release({ data: { user: { _id: 'account-a' }, accessToken: 'a' } }));
  expect(store.getState().auth.user._id).toBe('account-b');
});

test('a pending sign-in suppresses the older cookie refresh', async () => {
  let release;
  refresh.mockReturnValue({ unwrap: () => new Promise((resolve) => { release = resolve; }) });
  const store = mount();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => store.dispatch({ type: 'test/signIn', payload: true }));
  await act(async () => release({ data: { user: { _id: 'old-cookie' }, accessToken: 'old' } }));
  expect(store.getState().auth.user).toBeNull();
  act(() => store.dispatch(setCredentials({ user: { _id: 'new-sign-in' }, accessToken: 'new' })));
  expect(store.getState().auth.user._id).toBe('new-sign-in');
});

test.each([429, 'TIMEOUT_ERROR'])('refresh %s keeps the private route gated for recovery', async (status) => {
  refresh.mockReturnValue({ unwrap: () => Promise.reject({ status, data: { retryAt: Date.now() + 60000 } }) });
  const store = mount();
  expect(await screen.findByText('Connection interrupted')).toBeInTheDocument();
  expect(store.getState().auth.isInitialized).toBe(false);
  expect(screen.queryByText('Store content')).not.toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('login UI opens immediately while the session check is still pending', () => {
  window.history.replaceState({}, '', '/login');
  refresh.mockReturnValue({ unwrap: () => new Promise(() => {}) });
  try {
    mount();
    expect(screen.getByText('Store content')).toBeVisible();
    expect(screen.queryByLabelText('Opening Smart Kirana')).not.toBeInTheDocument();
  } finally { window.history.replaceState({}, '', '/'); }
});

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
