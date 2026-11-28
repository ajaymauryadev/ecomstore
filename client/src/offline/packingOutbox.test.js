import { configureStore } from '@reduxjs/toolkit';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import authReducer, { clearCredentials, setCredentials } from '../features/auth/authSlice';
import savedDataReducer from './savedDataSlice';
import { savedStorage, accountScope } from './storage';
import { outboxMemory, saveIntent } from './outbox';

let baseApi, enqueuePacking, submitPackingAction, syncPackingOutbox, packingIntents, discardPackingItem;
const stores = [];
const NativeRequest = globalThis.Request;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const item = (id = 'one', status = 'pending') => ({ _id: id, status, requiredQty: 1, pickedQty: status === 'pending' ? 0 : 1 });
const session = (...items) => ({ _id: 'session', status: 'in_progress', items });
const legacyError = 'This item changed while you were offline. Review your saved checklist.';

beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'https://shop.test/api/v1');
  ({ baseApi } = await import('../api/baseApi'));
  ({ enqueuePacking, submitPackingAction, syncPackingOutbox, packingIntents, discardPackingItem } = await import('./packingOutbox'));
});
beforeEach(async () => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input, options) { super(input, { ...options, signal: undefined }); }
  });
  for (const entry of await savedStorage.all('outbox')) await savedStorage.delete('outbox', entry.id);
  outboxMemory.clear();
});
afterEach(() => {
  for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState());
  vi.unstubAllGlobals();
});
function makeStore() {
  const store = configureStore({ reducer: { auth: authReducer, savedData: savedDataReducer, api: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware) });
  store.dispatch(setCredentials({ user: { _id: 'packer', tenantId: 'shop', role: 'packer' }, accessToken: 'online' }));
  stores.push(store);
  return store;
}
const queue = (store) => packingIntents(accountScope(store.getState().auth), 'order');
async function seed(store, saved = session(item())) {
  await import('../features/packing/packingApi');
  await store.dispatch(baseApi.util.upsertQueryData('getPackingSession', { orderId: 'order' }, { data: { session: saved, order: { _id: 'order' } } }));
}
const cached = (store) => baseApi.endpoints.getPackingSession.select({ orderId: 'order' })(store.getState()).data.data.session;

test('installs confirmed data before removing drafts, with no GET per mutation or retained mutation results', async () => {
  const store = makeStore();
  await seed(store);
  const fetch = vi.fn(async () => response({ data: { session: session(item('one', 'picked')) } }));
  vi.stubGlobal('fetch', fetch);
  await enqueuePacking(store, 'order', item(), 'pick');
  const remove = vi.spyOn(savedStorage, 'delete').mockImplementation(async () => {
    expect(cached(store).items[0].status).toBe('picked');
  });
  await syncPackingOutbox(store);
  expect(queue(store)).toHaveLength(0);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0].method).toBe('PATCH');
  expect(Object.keys(store.getState().api.mutations)).toHaveLength(0);
});

test('drains actions queued during a running sync and deduplicates concurrent runners', async () => {
  const store = makeStore();
  await seed(store);
  let finish;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementation(async () => response({ data: { session: session(item('one', 'packed')) } }));
  vi.stubGlobal('fetch', fetch);
  await enqueuePacking(store, 'order', item(), 'pick');
  const syncing = syncPackingOutbox(store);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await enqueuePacking(store, 'order', item('one', 'picked'), 'pack');
  await syncPackingOutbox(store);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(response({ data: { session: session(item('one', 'picked')) } }));
  await syncing;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(queue(store)).toHaveLength(0);
  expect(cached(store).items[0].status).toBe('packed');
});

test('recovers old stale-status rejections once using the original operation and payload', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  const original = queue(store)[0];
  await saveIntent({ ...original, status: 'conflict', error: legacyError });
  const fetch = vi.fn(async () => response({ data: { session: session(item('one', 'packed')) } }));
  vi.stubGlobal('fetch', fetch);
  await syncPackingOutbox(store);
  expect(await fetch.mock.calls[0][0].json()).toEqual(Object.fromEntries(Object.entries(original.payload).filter(([key]) => !['orderId', 'itemId'].includes(key))));
  expect(queue(store)).toHaveLength(0);
});

test('a real item conflict keeps its dependent actions but allows other items to sync without repeated retries', async () => {
  const store = makeStore();
  await seed(store);
  await enqueuePacking(store, 'order', item(), 'pick');
  await enqueuePacking(store, 'order', item('one', 'picked'), 'pack');
  await enqueuePacking(store, 'order', item('two'), 'pick');
  const fetch = vi.fn(async (request) => request.url.endsWith('/one')
    ? response({ message: 'Review this item.', errors: { code: 'PACKING_ITEM_CHANGED', session: session(item('one', 'missing'), item('two')) } }, 409)
    : response({ data: { session: session(item('one', 'missing'), item('two', 'picked')) } }));
  vi.stubGlobal('fetch', fetch);
  await syncPackingOutbox(store);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(queue(store).map((entry) => entry.status)).toEqual(['conflict', 'pending']);
  expect(cached(store).items[0].status).toBe('missing');
  await syncPackingOutbox(store);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('an old conflict against an older server is retried only once', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  await saveIntent({ ...queue(store)[0], status: 'conflict', error: legacyError });
  const fetch = vi.fn(async () => response({ message: legacyError }, 409));
  vi.stubGlobal('fetch', fetch);
  await syncPackingOutbox(store);
  await syncPackingOutbox(store);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(queue(store)[0].status).toBe('conflict');
});

test('assignment conflicts block the order while another order continues', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  await enqueuePacking(store, 'order', item('two'), 'pick');
  await enqueuePacking(store, 'other-order', item('three'), 'pick');
  const fetch = vi.fn(async (request) => request.url.includes('/session/order/')
    ? response({ message: 'The packing assignment changed.' }, 409)
    : response({ data: { session: session(item('three', 'picked')) } }));
  vi.stubGlobal('fetch', fetch);
  await syncPackingOutbox(store);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(queue(store)).toHaveLength(2);
});

test('clears all dependent item drafts after a successful fresh read, with the blocker removed last', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  const first = queue(store)[0];
  await saveIntent({ ...first, status: 'conflict', error: legacyError, reconciliationVersion: 1 });
  await enqueuePacking(store, 'order', item('one', 'picked'), 'pack');
  const second = queue(store)[1];
  await enqueuePacking(store, 'order', item('two'), 'pick');
  vi.stubGlobal('fetch', vi.fn(async () => response({ data: { session: session(item('one', 'missing')) } })));
  const deleted = vi.spyOn(savedStorage, 'delete');
  await discardPackingItem(store, first);
  expect(deleted.mock.calls.map((args) => args[1])).toEqual([second.id, first.id]);
  expect(queue(store).map((entry) => entry.payload.itemId)).toEqual(['two']);
  expect(cached(store).items[0].status).toBe('missing');
});

test('failed refresh keeps every saved item change', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  await enqueuePacking(store, 'order', item('one', 'picked'), 'pack');
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'Unavailable' }, 503)));
  await expect(discardPackingItem(store, queue(store)[0])).rejects.toMatchObject({ status: 503 });
  expect(queue(store)).toHaveLength(2);
});

test('storage failures prevent network writes', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(savedStorage, 'put').mockRejectedValue(new Error('Quota'));
  await expect(syncPackingOutbox(store)).rejects.toThrow('Quota');
  expect(fetch).not.toHaveBeenCalled();
});

test('rate limits preserve the original payload and pause writes until the retry time', async () => {
  const store = makeStore();
  await enqueuePacking(store, 'order', item(), 'pick');
  const original = queue(store)[0].payload;
  const fetch = vi.fn(async () => response({ message: 'Slow down', retryAfterSeconds: 60 }, 429));
  vi.stubGlobal('fetch', fetch);
  await syncPackingOutbox(store);
  expect(queue(store)[0]).toMatchObject({ status: 'pending', payload: original });
  expect(queue(store)[0].retryAt).toBeGreaterThan(Date.now());
  await syncPackingOutbox(store);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('logout during sync retains the request and does not apply the response to another session', async () => {
  const store = makeStore();
  await seed(store);
  await enqueuePacking(store, 'order', item(), 'pick');
  let finish;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
  const syncing = syncPackingOutbox(store);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const original = queue(store)[0];
  store.dispatch(clearCredentials());
  finish(response({ data: { session: session(item('one', 'picked')) } }));
  await syncing;
  expect(outboxMemory.has(original.id)).toBe(true);
  expect(cached(store).items[0].status).toBe('pending');
});

test('a slow pre-write read cannot replace the confirmed mutation session', async () => {
  const store = makeStore();
  await seed(store);
  let finishRead;
  const fetch = vi.fn(async (request) => request.method === 'GET'
    ? new Promise((resolve) => { finishRead = resolve; })
    : response({ data: { session: session(item('one', 'picked')) } }));
  vi.stubGlobal('fetch', fetch);
  const read = store.dispatch(baseApi.endpoints.getPackingSession.initiate({ orderId: 'order' }, { subscribe: false, forceRefetch: true }));
  await waitFor(() => expect(finishRead).toBeTypeOf('function'));
  await enqueuePacking(store, 'order', item(), 'pick');
  await syncPackingOutbox(store);
  finishRead(response({ data: { session: session(item()) } }));
  await read;
  expect(cached(store).items[0].status).toBe('picked');
  expect(queue(store)).toHaveLength(0);
});

test('successful online packing goes straight to the server even when device storage is full', async () => {
  const store = makeStore();
  await seed(store);
  const put = vi.spyOn(savedStorage, 'put').mockRejectedValue(new Error('Quota'));
  const fetch = vi.fn(async () => response({ data: { session: session(item('one', 'picked')) } }));
  vi.stubGlobal('fetch', fetch);
  await submitPackingAction(store, 'order', item(), 'pick');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(put).not.toHaveBeenCalled();
  expect(queue(store)).toHaveLength(0);
  expect(cached(store).items[0].status).toBe('picked');
});

test('an uncertain online write is saved for retry with its exact original operation', async () => {
  const store = makeStore();
  const fetch = vi.fn().mockImplementationOnce(async () => { throw new Error('Disconnected after write'); })
    .mockImplementation(async () => response({ data: { session: session(item('one', 'picked')) } }));
  vi.stubGlobal('fetch', fetch);
  await submitPackingAction(store, 'order', item(), 'pick');
  expect(queue(store)).toHaveLength(1);
  expect(queue(store)[0].status).toBe('pending');
  const originalBody = await fetch.mock.calls[0][0].clone().json();
  expect(queue(store)[0].payload.operationId).toBe(originalBody.operationId);
  await saveIntent({ ...queue(store)[0], retryAt: 0 });
  await syncPackingOutbox(store);
  expect(await fetch.mock.calls[1][0].json()).toEqual(originalBody);
  expect(queue(store)).toHaveLength(0);
});

test('offline actions remain saved drafts and cannot be reported as confirmed packing', async () => {
  const store = makeStore();
  await seed(store);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn());
  await submitPackingAction(store, 'order', item(), 'pick');
  expect(fetch).not.toHaveBeenCalled();
  expect(queue(store)).toHaveLength(1);
  expect(cached(store).items[0].status).toBe('pending');
});

test('an order-specific packing update reaches both staff and admin session views without touching another order', async () => {
  const store = makeStore();
  await seed(store);
  await store.dispatch(baseApi.util.upsertQueryData('getAdminPackingSession', { sessionId: 'admin-session' }, { data: { session: { orderId: 'order' } } }));
  await store.dispatch(baseApi.util.upsertQueryData('getAdminPackingSession', { sessionId: 'unrelated-session' }, { data: { session: { orderId: 'other-order' } } }));
  const affected = baseApi.util.selectInvalidatedBy(store.getState(), [{ type: 'Packing', id: 'order' }]);
  expect(affected.map(({ endpointName, originalArgs }) => [endpointName, originalArgs])).toEqual(expect.arrayContaining([
    ['getPackingSession', { orderId: 'order' }], ['getAdminPackingSession', { sessionId: 'admin-session' }],
  ]));
  expect(affected).toHaveLength(2);
});
