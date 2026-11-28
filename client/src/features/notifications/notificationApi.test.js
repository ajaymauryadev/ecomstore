import { configureStore } from '@reduxjs/toolkit';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import authReducer, { setCredentials } from '../auth/authSlice';

let baseApi, applyNotificationEvent, store;
const NativeRequest = globalThis.Request;
const owner = { _id: 'owner', role: 'store_owner', tenantId: 'shop' };
const notification = (id = 'new', overrides = {}) => ({ _id: id, tenantId: 'shop', role: 'admin', type: 'new_order',
  title: 'New order', isRead: false, createdAt: new Date().toISOString(), ...overrides });
const response = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'https://shop.test/api/v1');
  ({ baseApi } = await import('../../api/baseApi'));
  ({ applyNotificationEvent } = await import('./notificationApi'));
});
beforeEach(() => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input, options) { super(input, { ...options, signal: undefined }); }
  });
  store = configureStore({ reducer: { auth: authReducer, api: baseApi.reducer }, middleware: (getDefault) => getDefault().concat(baseApi.middleware) });
  store.dispatch(setCredentials({ user: owner, accessToken: 'online' }));
});
afterEach(() => { store.dispatch(baseApi.util.resetApiState()); vi.unstubAllGlobals(); });
async function seed(args = { limit: 2 }, rows = [notification('old', { createdAt: '2026-01-01T00:00:00Z' })]) {
  await store.dispatch(baseApi.util.upsertQueryData('getNotifications', args, { data: rows, meta: { total: rows.length, page: args.page ?? 1, limit: args.limit } }));
  await store.dispatch(baseApi.util.upsertQueryData('getUnreadCount', undefined, { data: { count: 1 } }));
}
const inbox = (args = { limit: 2 }) => baseApi.endpoints.getNotifications.select(args)(store.getState()).data;
const unread = () => baseApi.endpoints.getUnreadCount.select()(store.getState()).data.data.count;

test('shows new persisted events in the inbox and unread badge without waiting for another GET or double-counting delivery', async () => {
  await seed();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const seen = new Set();
  await applyNotificationEvent(store, notification(), seen);
  expect(inbox().data.map((entry) => entry._id)).toEqual(['new', 'old']);
  expect(inbox().meta.total).toBe(2);
  expect(unread()).toBe(2);
  await applyNotificationEvent(store, notification(), seen);
  expect(unread()).toBe(2);
  await applyNotificationEvent(store, notification('another'), seen);
  expect(inbox().data).toHaveLength(2);
  expect(inbox().meta).toMatchObject({ total: 3, totalPages: 2, hasNextPage: true });
  expect(fetch).not.toHaveBeenCalled();
});

test('ignores another tenant, recipient or role and respects read filters and page boundaries', async () => {
  await seed({ page: 1, limit: 2, isRead: 'true' }, []);
  await seed({ page: 2, limit: 2 });
  const seen = new Set();
  await applyNotificationEvent(store, notification('wrong-tenant', { tenantId: 'other' }), seen);
  await applyNotificationEvent(store, notification('wrong-person', { userId: 'staff' }), seen);
  await applyNotificationEvent(store, notification('wrong-role', { role: 'staff' }), seen);
  expect(unread()).toBe(1);
  await applyNotificationEvent(store, notification(), seen);
  expect(unread()).toBe(2);
  expect(inbox({ page: 1, limit: 2, isRead: 'true' }).data).toEqual([]);
  expect(inbox({ page: 2, limit: 2 }).data[0]._id).toBe('old');
});

test('an old in-flight inbox response cannot remove a notification already delivered by socket', async () => {
  await seed();
  let finish;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
  const read = store.dispatch(baseApi.endpoints.getNotifications.initiate({ limit: 2 }, { subscribe: false, forceRefetch: true }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await applyNotificationEvent(store, notification(), new Set());
  finish(response({ data: [] }));
  await read;
  expect(inbox().data[0]._id).toBe('new');
  expect(unread()).toBe(2);
});

test('a slow report does not delay inbox verification or unread updates', async () => {
  await seed();
  let finishReport;
  baseApi.injectEndpoints({ endpoints: (builder) => ({ heldNotificationReport: builder.query({
    queryFn: () => new Promise((resolve) => { finishReport = resolve; }), providesTags: ['Reports'],
  }) }) });
  const fetch = vi.fn(async (request) => response(request.url.endsWith('unread-count') ? { data: { count: 2 } } : { data: [notification()] }));
  vi.stubGlobal('fetch', fetch);
  const list = store.dispatch(baseApi.endpoints.getNotifications.initiate({ limit: 2 }));
  const count = store.dispatch(baseApi.endpoints.getUnreadCount.initiate());
  await Promise.all([list, count]);
  const report = store.dispatch(baseApi.endpoints.heldNotificationReport.initiate());
  await applyNotificationEvent(store, notification(), new Set());
  store.dispatch(baseApi.util.invalidateTags(['Notification']));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(baseApi.endpoints.heldNotificationReport.select()(store.getState()).status).toBe('pending');
  expect(unread()).toBe(2);
  finishReport({ data: 'ready' }); await report;
  list.unsubscribe(); count.unsubscribe(); report.unsubscribe();
});
