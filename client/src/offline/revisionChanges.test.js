import { configureStore } from '@reduxjs/toolkit';
import { afterEach, expect, test } from 'vitest';
import { baseApi } from '../api/baseApi';
import { changedQueryKeys, retryableRead } from './revisionChanges';

const api = baseApi.injectEndpoints({ endpoints: (builder) => ({
  revisionProbe: builder.query({ queryFn: (tag) => ({ data: tag }), providesTags: (_data, _error, tag) => [tag] }),
}) });
let store;
afterEach(() => store?.dispatch(baseApi.util.resetApiState()));
async function setup() {
  store = configureStore({ reducer: { api: baseApi.reducer }, middleware: (middleware) => middleware().concat(baseApi.middleware) });
  await Promise.all(['Product', 'Notification', 'Expense'].map((tag) => store.dispatch(api.endpoints.revisionProbe.initiate(tag))));
  return store.getState();
}

test('unchanged counters fetch no business data and a read receipt refreshes only inbox queries', async () => {
  const state = await setup();
  const previous = { revision: 4, versions: { Product: 2, Notification: 2 } };
  expect(changedQueryKeys(state, previous, previous)).toEqual([]);
  const keys = changedQueryKeys(state, previous, { revision: 5, versions: { Product: 2, Notification: 3 } });
  expect(keys.map((key) => state.api.queries[key].originalArgs)).toEqual(['Notification']);
  // Unrelated internal activity does not invalidate the public catalog counters.
  expect(changedQueryKeys(state, previous, { ...previous, revision: 20 })).toEqual([]);
});

test('startup, unknown changes and legacy servers safely reconcile saved views', async () => {
  const state = await setup();
  expect(changedQueryKeys(state, undefined, { revision: 1, versions: {} })).toHaveLength(3);
  expect(changedQueryKeys(state, { revision: 1 }, { revision: 2 })).toHaveLength(3);
  expect(changedQueryKeys(state, { revision: 1, versions: {} }, { revision: 2, versions: { All: 1 } })).toHaveLength(3);
});

test('recovery retries temporary failures without repeatedly retrying revoked permissions', () => {
  for (const status of [429, 408, 503, 'FETCH_ERROR']) expect(retryableRead({ status: 'rejected', error: { status } })).toBe(true);
  for (const status of [401, 403, 404, 409, 422]) expect(retryableRead({ status: 'rejected', error: { status } })).toBe(false);
});
