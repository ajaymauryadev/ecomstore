import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { accountScope, businessSnapshot, savedStorage } from './storage';

let baseApi, sessionReducer, sessionCacheMiddleware, savedDataMiddleware, restoreScope, useSavedViewState, setCredentials, clearCredentials;
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
  ({ savedDataMiddleware, restoreScope } = await import('./savedData'));
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

test('deduplicates reads and keeps visited data across repeated navigation without time expiry', async () => {
  const store = await makeStore();
  const fetch = vi.fn(async () => response({ data: ['Rice'] })); vi.stubGlobal('fetch', fetch);
  await Promise.all([read(store), read(store), read(store)]);
  const first = baseApi.endpoints.savedReadProbe.select({})(store.getState()).data;
  await read(store); await read(store);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBe(first);
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

test('a mutation refreshes a closed page while retaining its data and unrelated queries', async () => {
  const store = await makeStore();
  let version = 1;
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: version })));
  await read(store);
  const before = baseApi.endpoints.savedReadProbe.select({})(store.getState()).data;
  let release;
  vi.stubGlobal('fetch', vi.fn(async (request) => request.method === 'POST' ? response({ data: 'ok' })
    : new Promise((resolve) => { release = resolve; })));
  await store.dispatch(baseApi.endpoints.savedWriteProbe.initiate());
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBe(before);
  version++;
  release(response({ data: version }));
  await waitFor(() => expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toEqual({ data: 2 }));
});

test('an older in-flight read cannot overwrite data after a successful mutation', async () => {
  const store = await makeStore();
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: 'before' })));
  await read(store);
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
  await waitFor(() => expect(result.current.isError).toBe(true));
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
  hook.unmount();
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'Permission revoked' }, 403)));
  await read(store, {}, { forceRefetch: true });
  expect(store.getState().auth.user).toBeNull();
  expect(baseApi.endpoints.savedReadProbe.select({})(store.getState()).data).toBeUndefined();
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
