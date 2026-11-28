import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { accountScope, businessSnapshot, savedStorage, writePendingLogoutMarker } from './storage';

let baseApi, sessionReducer, sessionCacheMiddleware, savedDataMiddleware, initializeSavedData, restoreScope, startSavedDataSync, useSavedViewState, setCredentials, clearCredentials;
const stores = [];
const NativeRequest = globalThis.Request;
beforeEach(() => {
  // jsdom's AbortSignal is a different realm from Node's native fetch classes.
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input, options) { super(input, { ...options, signal: undefined }); }
  });
});
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'https://shop.test/api/v1');
  ({ baseApi } = await import('../api/baseApi'));
  ({ sessionReducer, sessionCacheMiddleware } = await import('../app/store'));
  ({ savedDataMiddleware, initializeSavedData, restoreScope, startSavedDataSync } = await import('./savedData'));
  ({ useSavedViewState } = await import('./useSavedViewState'));
  ({ setCredentials, clearCredentials } = await import('../features/auth/authSlice'));
  baseApi.injectEndpoints({ endpoints: (builder) => ({
    savedReadProbe: builder.query({ query: (args) => ({ url: '/products', params: args }), providesTags: ['Product'] }),
    savedWriteProbe: builder.mutation({ query: () => ({ url: '/products', method: 'POST' }), invalidatesTags: ['Product'] }),
  }) });
});
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.dispatch(clearCredentials());
  writePendingLogoutMarker(false);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function makeStore(id = crypto.randomUUID()) {
  const store = configureStore({ reducer: sessionReducer, middleware: (getDefault) => getDefault()
    .concat(sessionCacheMiddleware, savedDataMiddleware, baseApi.middleware) });
  stores.push(store);
  store.dispatch(setCredentials({ user: { _id: id, role: 'store_owner', tenantId: 'shop', permissions: ['products.view'] }, store: { _id: 'shop' }, accessToken: 'not-for-storage' }));
  await waitFor(() => expect(store.getState().savedData.restoring).toBe(false));
  return store;
}
const read = (store, args = {}, options = {}) => store.dispatch(baseApi.endpoints.savedReadProbe.initiate(args, { subscribe: false, ...options }));

function emptyStore() {
  const store = configureStore({ reducer: sessionReducer, middleware: (getDefault) => getDefault()
    .concat(sessionCacheMiddleware, savedDataMiddleware, baseApi.middleware) });
  stores.push(store);
  return store;
}

test('delayed or rejected identity storage never blocks the shell state or restores an unverified identity', async () => {
  const store = emptyStore();
  let release;
  vi.spyOn(savedStorage, 'get').mockImplementation((table, key) => table === 'identity' && key === 'logoutPending'
    ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(null));
  const boot = initializeSavedData(store);
  expect(store.getState().savedData.identityReady).toBe(false);
  expect(store.getState().auth.user).toBeNull();
  release(false);
  await boot;
  expect(store.getState().savedData.identityReady).toBe(true);

  const failed = emptyStore();
  savedStorage.get.mockRejectedValue(new Error('IndexedDB unavailable'));
  await initializeSavedData(failed);
  expect(failed.getState().savedData.identityReady).toBe(true);
  expect(failed.getState().savedData.identityError).toBe(true);
  expect(failed.getState().savedData.storageError).toMatch(/Offline data/);
  expect(failed.getState().auth.user).toBeNull();
});

test('pending logout is read before identity and prevents restoring saved protected data', async () => {
  const store = emptyStore();
  const get = vi.spyOn(savedStorage, 'get').mockImplementation((table, key) =>
    table === 'identity' && key === 'logoutPending' ? Promise.resolve(true) : Promise.resolve(null));
  await initializeSavedData(store);
  expect(store.getState().savedData.logoutPending).toBe(true);
  expect(store.getState().savedData.identityError).toBe(false);
  expect(store.getState().auth.user).toBeNull();
  expect(get).not.toHaveBeenCalledWith('identity', 'active');
});

test('the pending logout mirror survives an unavailable IndexedDB open', async () => {
  writePendingLogoutMarker(true);
  const get = vi.spyOn(savedStorage, 'get').mockRejectedValue(new Error('IndexedDB blocked'));
  const store = emptyStore();
  await initializeSavedData(store);
  expect(store.getState().savedData.logoutPending).toBe(true);
  expect(store.getState().auth.user).toBeNull();
  expect(get).not.toHaveBeenCalledWith('identity', 'logoutPending');
});

test('a valid offline identity restores only when offline', async () => {
  const identity = { user: { _id: 'offline-owner', role: 'store_owner', tenantId: 'shop' },
    store: { _id: 'shop' }, verifiedAt: Date.now() };
  vi.spyOn(savedStorage, 'get').mockImplementation((table, key) => Promise.resolve(
    table === 'identity' && key === 'active' ? identity : null));
  const onlineStore = emptyStore();
  await initializeSavedData(onlineStore);
  expect(onlineStore.getState().auth.user).toBeNull();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const offlineStore = emptyStore();
  await initializeSavedData(offlineStore);
  expect(offlineStore.getState().auth.user._id).toBe('offline-owner');
  expect(offlineStore.getState().auth.offlineSession).toBe(true);
});

test('a delayed snapshot from tenant A cannot hydrate after switching to tenant B', async () => {
  const store = await makeStore('owner-a');
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: ['Tenant A rice'] })));
  await read(store);
  const scopeA = accountScope(store.getState().auth);
  const snapshotA = businessSnapshot(store.getState());
  store.dispatch(baseApi.util.resetApiState());
  let release;
  vi.spyOn(savedStorage, 'get').mockImplementation((table, key) => table === 'snapshots' && key === scopeA
    ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(null));
  const restoring = restoreScope(store);
  store.dispatch(setCredentials({ user: { _id: 'owner-b', role: 'store_owner', tenantId: 'other-shop' },
    store: { _id: 'other-shop' }, accessToken: 'tenant-b-token' }));
  release(snapshotA);
  await restoring;
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBeUndefined();
  expect(accountScope(store.getState().auth)).not.toBe(scopeA);
});

test('deduplicates reads and keeps visited data across repeated navigation without time expiry', async () => {
  const store = await makeStore();
  const fetch = vi.fn(async () => response({ data: ['Rice'] })); vi.stubGlobal('fetch', fetch);
  await Promise.all([read(store), read(store), read(store)]);
  const first = baseApi.endpoints.savedReadProbe.select({})(store.getState()).data;
  await read(store); await read(store);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBe(first);
});

test('six unchanged minutes check tiny counters without re-fetching saved pages; a product change refreshes its page', async () => {
  const store = await makeStore();
  let productVersion = 1;
  let expenseVersion = 1;
  const fetch = vi.fn(async (request) => request.url.endsWith('/sync/revision')
    ? response({ data: { revision: productVersion + expenseVersion, versions: { Product: productVersion, Expense: expenseVersion } } })
    : response({ data: ['Rice'] }));
  vi.stubGlobal('fetch', fetch);
  await read(store);
  const subscription = store.dispatch(baseApi.endpoints.savedReadProbe.initiate({}));
  await subscription;
  vi.useFakeTimers();
  const stop = startSavedDataSync(store);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    fetch.mockClear();
    await vi.advanceTimersByTimeAsync(360000);
    expect(fetch.mock.calls.filter(([request]) => request.url.includes('/products'))).toHaveLength(0);
    expect(fetch.mock.calls.filter(([request]) => request.url.endsWith('/sync/revision'))).toHaveLength(6);
    expenseVersion++;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch.mock.calls.filter(([request]) => request.url.includes('/products'))).toHaveLength(0);
    productVersion++;
    await vi.advanceTimersByTimeAsync(60200);
    expect(fetch.mock.calls.filter(([request]) => request.url.includes('/products'))).toHaveLength(1);
  } finally { subscription.unsubscribe(); stop(); vi.useRealTimers(); }
});

test('keeps data and its real timestamp during a slow update and a failed update', async () => {
  const store = await makeStore();
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: ['Saved'] })));
  await read(store);
  const before = baseApi.endpoints.savedReadProbe.select({})(store.getState());
  let release;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = resolve; })));
  const pending = read(store, {}, { forceRefetch: true });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBe(before.data);
  release(response({ message: 'Unavailable' }, 503)); await pending;
  const after = baseApi.endpoints.savedReadProbe.select({})(store.getState());
  expect(after.data).toBe(before.data);
  expect(after.fulfilledTimeStamp).toBe(before.fulfilledTimeStamp);
});

test('restores exact saved queries from IndexedDB before any network access, without tokens or mutation results', async () => {
  const store = await makeStore();
  vi.stubGlobal('fetch', vi.fn(async (request) => response({ data: new URL(request.url).searchParams.get('date') })));
  await read(store, { date: '2026-11-25', page: 2 });
  const saved = businessSnapshot(store.getState());
  expect(JSON.stringify(saved)).not.toContain('not-for-storage');
  expect(saved.mutations).toEqual({});
  await savedStorage.put('snapshots', accountScope(store.getState().auth), saved);
  store.dispatch(baseApi.util.resetApiState());
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted'); }));
  await restoreScope(store);
  const cached = baseApi.endpoints.savedReadProbe.select({ date: '2026-11-25', page: 2 })(store.getState());
  expect(cached.data).toEqual({ data: '2026-11-25' });
  expect(cached.fulfilledTimeStamp).toBe(Object.values(saved.queries)[0].fulfilledTimeStamp);
  await read(store, { date: '2026-11-25', page: 2 });
  expect(fetch).not.toHaveBeenCalled();
  expect(baseApi.endpoints.savedReadProbe.select({ date: '2026-11-26', page: 2 })(store.getState()).data).toBeUndefined();
});

test('a mutation leaves a closed page saved and refreshes it behind the same UI only when opened', async () => {
  const store = await makeStore();
  let version = 1;
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: version })));
  await read(store);
  const before = baseApi.endpoints.savedReadProbe.select({})(store.getState()).data;
  let release;
  const fetch = vi.fn(async (request) => request.method === 'POST' ? response({ data: 'ok' })
    : new Promise((resolve) => { release = resolve; }));
  vi.stubGlobal('fetch', fetch);
  await store.dispatch(baseApi.endpoints.savedWriteProbe.initiate());
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(fetch).toHaveBeenCalledTimes(1);
  const wrapper = ({ children }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>;
  const hook = renderHook(() => baseApi.useSavedReadProbeQuery({}), { wrapper });
  expect(hook.result.current.data).toBe(before);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBe(before);
  version++;
  await act(async () => release(response({ data: version })));
  await waitFor(() => expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toEqual({ data: 2 }));
  hook.unmount();
});

test('an older in-flight read cannot overwrite data after a successful mutation', async () => {
  const store = await makeStore();
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: 'before' })));
  await read(store);
  const subscription = store.dispatch(baseApi.endpoints.savedReadProbe.initiate({}));
  await subscription;
  let releaseOld;
  vi.stubGlobal('fetch', vi.fn((request) => {
    if (request.method === 'POST') return Promise.resolve(response({ data: 'confirmed write' }));
    if (!releaseOld) return new Promise((resolve) => { releaseOld = resolve; });
    return Promise.resolve(response({ data: 'after' }));
  }));
  const older = read(store, {}, { forceRefetch: true });
  await waitFor(() => expect(releaseOld).toBeTypeOf('function'));
  await store.dispatch(baseApi.endpoints.savedWriteProbe.initiate());
  await waitFor(() => expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toEqual({ data: 'after' }));
  releaseOld(response({ data: 'obsolete' }));
  await older;
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toEqual({ data: 'after' });
  subscription.unsubscribe();
});

test('offline misses are errors and offline writes cannot be mistaken for confirmed records', async () => {
  const store = await makeStore();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn());
  const result = await read(store);
  expect(result.error.data.message).toContain('Connect to the internet');
  expect(result.data).toBeUndefined();
  const write = await store.dispatch(baseApi.endpoints.savedWriteProbe.initiate());
  expect(write.error.data.message).toContain('server confirmation');
  expect(fetch).not.toHaveBeenCalled();
});

test('saved hooks never display the previous filter results and retain a saved result during refresh errors', async () => {
  const store = await makeStore();
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: ['Page one'] })));
  await read(store, { page: 1 });
  const wrapper = ({ children }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>;
  const { result, rerender } = renderHook(({ page }) => baseApi.useSavedReadProbeQuery({ page }), { wrapper, initialProps: { page: 1 } });
  expect(result.current.data).toEqual({ data: ['Page one'] });
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'Failed' }, 503)));
  await act(async () => { await result.current.refetch(); });
  expect(result.current.data).toEqual({ data: ['Page one'] });
  expect(result.current.isError).toBe(false);
  rerender({ page: 2 });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(result.current.error?.status).toBe(503));
  expect(result.current.isLoading).toBe(true);
  expect(result.current.isError).toBe(false);
  expect(result.current.error.status).toBe(503);
});

test('view choices/drafts survive unmount and stay isolated by role and permissions', async () => {
  const store = await makeStore();
  const wrapper = ({ children }) => <Provider store={store}><MemoryRouter initialEntries={['/store/reports']}>{children}</MemoryRouter></Provider>;
  let hook = renderHook(() => useSavedViewState('period', '2026-11-27'), { wrapper });
  act(() => hook.result.current[1]('2026-11-25'));
  hook.unmount();
  hook = renderHook(() => useSavedViewState('period', '2026-11-27'), { wrapper });
  expect(hook.result.current[0]).toBe('2026-11-25');
  const owner = accountScope(store.getState().auth);
  const staff = accountScope({ ...store.getState().auth, user: { ...store.getState().auth.user, role: 'staff' } });
  const revoked = accountScope({ ...store.getState().auth, user: { ...store.getState().auth.user, permissions: [] } });
  expect(owner).not.toBe(staff); expect(owner).not.toBe(revoked);
});

test('storage failure is visible and never claims that a snapshot was saved', async () => {
  const store = await makeStore();
  vi.spyOn(savedStorage, 'get').mockRejectedValueOnce(new DOMException('Quota exceeded', 'QuotaExceededError'));
  await restoreScope(store);
  expect(store.getState().savedData.storageError).toContain('Offline data may be incomplete');
  expect(store.getState().savedData.restoring).toBe(false);
});

test('authoritative deletion and permission rejection cannot fall back to an older authorized snapshot', async () => {
  const store = await makeStore();
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: ['Private record'] })));
  await read(store);
  const wrapper = ({ children }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>;
  const hook = renderHook(() => baseApi.useSavedReadProbeQuery({}), { wrapper });
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'Record removed' }, 404)));
  await act(async () => { await hook.result.current.refetch(); });
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.isError).toBe(true);
  expect(Object.keys(businessSnapshot(store.getState()).queries)).toHaveLength(0);
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'Permission revoked' }, 403)));
  await act(async () => { await hook.result.current.refetch(); });
  expect(store.getState().auth.user).not.toBeNull();
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.isError).toBe(true);
  expect(Object.keys(businessSnapshot(store.getState()).queries)).toHaveLength(0);
  hook.unmount();
});

test('offline authorization expires after twelve hours from actual identity confirmation', async () => {
  const store = await makeStore();
  const { selectIsAuthenticated, updateUser } = await import('../features/auth/authSlice');
  const confirmed = store.getState().auth.verifiedAt;
  vi.spyOn(Date, 'now').mockReturnValue(confirmed + 12 * 60 * 60 * 1000 + 1);
  expect(selectIsAuthenticated(store.getState())).toBe(false);
  store.dispatch(updateUser({ name: 'Server-confirmed user' }));
  expect(selectIsAuthenticated(store.getState())).toBe(true);
});

test('a slow unrelated request cannot delay a visible page invalidation', async () => {
  const store = await makeStore();
  let finishReport;
  baseApi.injectEndpoints({ endpoints: (builder) => ({ slowUnrelatedReport: builder.query({
    queryFn: () => new Promise((resolve) => { finishReport = resolve; }), providesTags: ['Reports'],
  }) }) });
  let value = 1;
  const fetch = vi.fn(async () => response({ data: value }));
  vi.stubGlobal('fetch', fetch);
  const visible = store.dispatch(baseApi.endpoints.savedReadProbe.initiate({}));
  await visible;
  const slow = store.dispatch(baseApi.endpoints.slowUnrelatedReport.initiate());
  await waitFor(() => expect(finishReport).toBeTypeOf('function'));
  value = 2;
  store.dispatch(baseApi.util.invalidateTags(['Product']));
  await waitFor(() => expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toEqual({ data: 2 }));
  expect(baseApi.endpoints.slowUnrelatedReport.select()(store.getState()).status).toBe('pending');
  finishReport({ data: 'report' }); await slow;
  visible.unsubscribe(); slow.unsubscribe();
});

test('many dormant filters stay cached without creating a read storm after a write', async () => {
  const store = await makeStore();
  const fetch = vi.fn(async () => response({ data: ['Saved row'] }));
  vi.stubGlobal('fetch', fetch);
  await Promise.all(Array.from({ length: 30 }, (_, page) => read(store, { page })));
  fetch.mockClear();
  await store.dispatch(baseApi.endpoints.savedWriteProbe.initiate());
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(Object.values(store.getState().api.queries).filter((query) => query.data)).toHaveLength(30);
  const wrapper = ({ children }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>;
  const hook = renderHook(() => baseApi.useSavedReadProbeQuery({ page: 15 }), { wrapper });
  expect(hook.result.current.data).toEqual({ data: ['Saved row'] });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  hook.unmount();
});

test('a pending packing write does not hold up revision reads and inbox recovery', async () => {
  const store = await makeStore();
  const { enqueuePacking } = await import('./packingOutbox');
  await enqueuePacking(store, 'packing-order', { _id: 'item', status: 'pending' }, 'pick');
  let finishPacking;
  const fetch = vi.fn(async (request) => request.method === 'PATCH'
    ? new Promise((resolve) => { finishPacking = resolve; })
    : response({ data: { revision: 1, versions: {} } }));
  vi.stubGlobal('fetch', fetch);
  const stop = startSavedDataSync(store);
  try {
    await waitFor(() => expect(finishPacking).toBeTypeOf('function'));
    await waitFor(() => expect(fetch.mock.calls.some(([request]) => request.url.endsWith('/sync/revision'))).toBe(true));
    finishPacking(response({ data: { session: { items: [] } } }));
    const { packingIntents } = await import('./packingOutbox');
    await waitFor(() => expect(packingIntents(accountScope(store.getState().auth))).toHaveLength(0));
  } finally { stop(); }
});

test('a deferred packing retry runs at its deadline rather than waiting for the minute heartbeat', async () => {
  const store = await makeStore();
  const { enqueuePacking, packingIntents } = await import('./packingOutbox');
  const { saveIntent } = await import('./outbox');
  const account = accountScope(store.getState().auth);
  await enqueuePacking(store, 'packing-order', { _id: 'item', status: 'pending' }, 'pick');
  const intent = packingIntents(account)[0];
  await saveIntent({ ...intent, retryAt: Date.now() + 100 });
  const fetch = vi.fn(async (request) => response({ data: request.method === 'PATCH'
    ? { session: { items: [] } } : { revision: 1, versions: {} } }));
  vi.stubGlobal('fetch', fetch);
  const stop = startSavedDataSync(store);
  try {
    await waitFor(() => expect(packingIntents(account)).toHaveLength(0));
    expect(fetch.mock.calls.filter(([request]) => request.method === 'PATCH')).toHaveLength(1);
  } finally { stop(); }
});
