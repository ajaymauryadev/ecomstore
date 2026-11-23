// @vitest-environment node
import { configureStore } from '@reduxjs/toolkit';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { clearCredentials, setCredentials, setStore } from '../features/auth/authSlice';

let api;
let store;
let sessionReducer;
let sessionCacheMiddleware;

beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'https://shop.test/api/v1');
  const { baseApi } = await import('./baseApi');
  ({ sessionReducer, sessionCacheMiddleware } = await import('../app/store'));
  await Promise.all([
    import('../features/products/productApi'), import('../features/inventory/inventoryApi'),
    import('../features/orders/orderApi'), import('../features/pos/posApi'), import('../features/auth/authApi'),
  ]);
  api = baseApi.injectEndpoints({
    endpoints: (builder) => ({
      queue: builder.query({ query: () => '/packing/admin/queue' }),
      unread: builder.query({ query: () => '/notifications/unread-count' }),
      submitBill: builder.mutation({ query: () => ({ url: '/pos/order', method: 'POST' }) }),
    }),
  });
});

afterEach(() => {
  store?.dispatch(api.util.resetApiState());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => vi.unstubAllEnvs());

const createStore = (id) => {
  store = configureStore({
    reducer: sessionReducer,
    middleware: (middleware) => middleware().concat(sessionCacheMiddleware, api.middleware),
  });
  store.dispatch(setCredentials({ accessToken: 'original', user: { _id: id }, store: { _id: 'alpha' } }));
  return store;
};
const reply = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const read = (endpoint) => store.dispatch(api.endpoints[endpoint].initiate(undefined, {
  subscribe: false, forceRefetch: true,
})).unwrap();

test('backs off background reads across the account and resumes after Retry-After', async () => {
  createStore('owner');
  let now = Date.UTC(2026, 10, 21);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fetch = vi.fn()
    .mockResolvedValueOnce(reply(429, { message: 'Account request limit reached.', rateLimitScope: 'business' }, { 'Retry-After': '45' }))
    .mockResolvedValueOnce(reply(200, { data: { count: 2 } }));
  vi.stubGlobal('fetch', fetch);

  await expect(read('queue')).rejects.toMatchObject({
    status: 429, data: { message: expect.stringContaining('45 seconds'), retryAt: now + 45000 },
  });
  now += 30000;
  await expect(read('unread')).rejects.toMatchObject({ status: 429, data: { message: expect.stringContaining('15 seconds') } });
  expect(fetch).toHaveBeenCalledTimes(1);

  now += 15000;
  await expect(read('unread')).resolves.toEqual({ data: { count: 2 } });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('keeps the POS session when refresh is throttled and can retry with a renewed access token', async () => {
  createStore('cashier');
  let now = Date.UTC(2026, 10, 21);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fetch = vi.fn()
    .mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(429, { message: 'Session refresh limit reached.', retryAfterSeconds: 10 }))
    .mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(200, { data: { user: { _id: 'cashier' }, accessToken: 'renewed' } }))
    .mockResolvedValueOnce(reply(201, { data: { order: { _id: 'sale' } } }));
  vi.stubGlobal('fetch', fetch);
  const sell = () => store.dispatch(api.endpoints.submitBill.initiate()).unwrap();

  await expect(sell()).rejects.toMatchObject({ status: 429, data: { retryAt: now + 10000 } });
  expect(store.getState().auth.accessToken).toBe('original');
  await expect(read('unread')).rejects.toMatchObject({ status: 429 });
  expect(fetch).toHaveBeenCalledTimes(2);
  now += 10000;
  await expect(sell()).resolves.toMatchObject({ data: { order: { _id: 'sale' } } });
  expect(fetch.mock.calls[4][0].headers.get('Authorization')).toBe('Bearer renewed');
});

test('a tenant switch clears prior data immediately and discards an old in-flight read', async () => {
  createStore('owner');
  let release;
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  const fetch = vi.fn()
    .mockResolvedValueOnce(reply(200, { data: 'Alpha queue' }))
    .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; started(); }))
    .mockResolvedValueOnce(reply(200, { data: 'Beta queue' }));
  vi.stubGlobal('fetch', fetch);

  await expect(read('queue')).resolves.toEqual({ data: 'Alpha queue' });
  const oldRead = read('unread').catch((error) => error);
  await pending;
  store.dispatch(setStore({ _id: 'beta' }));
  expect(api.endpoints.queue.select()(store.getState()).data).toBeUndefined();
  await expect(read('unread')).resolves.toEqual({ data: 'Beta queue' });
  release(reply(200, { data: 'Alpha unread' }));
  expect(await oldRead).not.toEqual({ data: 'Alpha unread' });
  expect(api.endpoints.unread.select()(store.getState()).data).toEqual({ data: 'Beta queue' });
  store.dispatch(clearCredentials());
  expect(Object.keys(store.getState().api.queries)).toHaveLength(0);
  expect(store.getState().auth.store).toBeNull();
});

test('two expired reads share one refresh and keep same-tenant cached data', async () => {
  createStore('owner');
  const fetch = vi.fn(async (request) => {
    if (request.url.endsWith('/auth/refresh')) return reply(200, { data: { user: { _id: 'owner' }, accessToken: 'renewed' } });
    const token = request.headers.get('Authorization');
    return token === 'Bearer renewed' ? reply(200, { data: 'renewed read' }) : reply(401, {});
  });
  vi.stubGlobal('fetch', fetch);
  const before = store.getState().auth.sessionEpoch;
  await expect(Promise.all([read('queue'), read('unread')])).resolves.toEqual([
    { data: 'renewed read' }, { data: 'renewed read' },
  ]);
  expect(fetch.mock.calls.filter(([request]) => request.url.endsWith('/auth/refresh'))).toHaveLength(1);
  expect(store.getState().auth.sessionEpoch).toBe(before);
  expect(store.getState().auth.store._id).toBe('alpha');
});

test.each([500, 503, 'offline'])('keeps the account after a temporary refresh failure: %s', async (status) => {
  createStore('owner');
  const fetch = vi.fn().mockResolvedValueOnce(reply(401, {}));
  if (status === 'offline') fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else fetch.mockResolvedValueOnce(reply(status, { message: 'Temporarily unavailable' }));
  fetch.mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(200, { data: { user: { _id: 'owner' }, accessToken: 'renewed' } }))
    .mockResolvedValueOnce(reply(200, { data: 'Recovered' }));
  vi.stubGlobal('fetch', fetch);

  await expect(read('queue')).rejects.toMatchObject({ status: status === 'offline' ? 'FETCH_ERROR' : status });
  expect(store.getState().auth).toMatchObject({ user: { _id: 'owner' }, accessToken: 'original' });
  await expect(read('queue')).resolves.toEqual({ data: 'Recovered' });
  expect(store.getState().auth.accessToken).toBe('renewed');
});

test('retries a cross-tab refresh conflict using the updated shared cookie', async () => {
  createStore('owner');
  const fetch = vi.fn()
    .mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(409, { message: 'This session was just refreshed by another request.' }))
    .mockResolvedValueOnce(reply(200, { data: { user: { _id: 'owner' }, accessToken: 'renewed' } }))
    .mockResolvedValueOnce(reply(200, { data: 'Recovered' }));
  vi.stubGlobal('fetch', fetch);
  await expect(read('queue')).resolves.toEqual({ data: 'Recovered' });
  expect(fetch.mock.calls.filter(([request]) => request.url.endsWith('/auth/refresh'))).toHaveLength(2);
  expect(store.getState().auth.accessToken).toBe('renewed');
});

test('an old refresh cannot restore its account or replay a mutation after a new login', async () => {
  createStore('owner');
  let release;
  let refreshing;
  const refreshStarted = new Promise((resolve) => { refreshing = resolve; });
  const fetch = vi.fn()
    .mockResolvedValueOnce(reply(401, {}))
    .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; refreshing(); }));
  vi.stubGlobal('fetch', fetch);
  const pending = store.dispatch(api.endpoints.submitBill.initiate()).unwrap().catch((error) => error);
  await refreshStarted;
  store.dispatch(setCredentials({ user: { _id: 'next-owner' }, accessToken: 'beta' }));
  release(reply(200, { data: { user: { _id: 'owner' }, accessToken: 'stale', store: { _id: 'alpha' } } }));
  expect((await pending)?.data?.order).toBeUndefined();
  expect(store.getState().auth).toMatchObject({ user: { _id: 'next-owner' }, accessToken: 'beta', store: null });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('successful writes refresh related active lists, and a rejected bill leaves them cached', async () => {
  createStore('owner');
  const reads = new Map();
  let rejectBill = true;
  vi.stubGlobal('fetch', vi.fn(async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return reply(200, { data: [] });
    }
    if (path.endsWith('/pos/order') && rejectBill) return reply(409, { message: 'Stock changed' });
    return reply(200, { data: { order: { _id: 'order-1' } } });
  }));
  const subscribe = (name, args) => store.dispatch(api.endpoints[name].initiate(args));
  await Promise.all([
    subscribe('getProducts', { page: 1, limit: 20 }),
    subscribe('getInventoryList', {}),
    subscribe('getAdminOrders', { slug: 'alpha' }),
  ]);
  const bill = () => store.dispatch(api.endpoints.createPOSOrder.initiate({ items: [{ productId: 'rice' }], idempotencyKey: 'bill-1' })).unwrap();
  const waitForReads = () => Promise.all(store.dispatch(api.util.getRunningQueriesThunk()));
  await expect(bill()).rejects.toMatchObject({ status: 409 });
  expect([...reads.values()]).toEqual([1, 1, 1]);
  rejectBill = false;
  await expect(bill()).resolves.toMatchObject({ data: { order: { _id: 'order-1' } } });
  await waitForReads();
  expect([...reads.values()]).toEqual([2, 2, 2]);

  await store.dispatch(api.endpoints.adjustStock.initiate({ productId: 'rice', adjustment: 1 })).unwrap();
  await waitForReads();
  expect([...reads.values()]).toEqual([3, 3, 2]);
  await store.dispatch(api.endpoints.verifyPayment.initiate({ slug: 'alpha', orderId: 'order-1', action: 'approve' })).unwrap();
  await waitForReads();
  expect([...reads.values()]).toEqual([3, 3, 3]);
});

test('the logout endpoint clears the API state before another account reads the same view', async () => {
  createStore('owner');
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(reply(200, { data: 'Alpha order' }))
    .mockResolvedValueOnce(reply(200, { data: null }))
    .mockResolvedValueOnce(reply(200, { data: 'Beta order' })));
  await read('queue');
  await store.dispatch(api.endpoints.logout.initiate()).unwrap();
  expect(store.getState().auth.user).toBeNull();
  expect(api.endpoints.queue.select()(store.getState()).data).toBeUndefined();
  store.dispatch(setCredentials({ user: { _id: 'other-owner' }, accessToken: 'other', store: { _id: 'beta' } }));
  await expect(read('queue')).resolves.toEqual({ data: 'Beta order' });
});
