import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import authReducer, { clearCredentials } from '../../../features/auth/authSlice';
import { baseApi } from '../../../api/baseApi';
import LiveUpdates from '../LiveUpdates';

const { handlers, on, read } = vi.hoisted(() => {
  const handlers = new Map();
  return {
    handlers,
    read: vi.fn(),
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  };
});
vi.mock('../../../hooks/useSocket', () => ({ useSocket: () => ({ on }) }));

const api = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    livePerformanceProbe: builder.query({
      queryFn: (arg) => { read(arg); return { data: arg }; },
      providesTags: (_result, _error, arg) => [arg],
    }),
  }),
});

let store;
let view;
beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  read.mockClear();
  store = configureStore({
    reducer: { auth: authReducer, [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
});
afterEach(() => {
  view?.unmount();
  store.dispatch(baseApi.util.resetApiState());
  vi.useRealTimers();
});

async function subscribe(tags) {
  await Promise.all(tags.map((tag) => store.dispatch(api.endpoints.livePerformanceProbe.initiate(tag))));
  view = render(<Provider store={store}><LiveUpdates /></Provider>);
  read.mockClear();
}
const receive = (event, payload) => act(() => handlers.get(event)?.(payload));
const flush = () => act(() => vi.advanceTimersByTimeAsync(75));

describe('live query refreshes', () => {
  test('an inbox read update refreshes notifications without redownloading all saved business views', async () => {
    await subscribe([{ type: 'Notification' }, { type: 'Dashboard', id: 'CURRENT' }, { type: 'Reports' }]);
    receive('data:changed', { tags: ['Notification'] });
    await flush();
    expect(read.mock.calls.map(([tag]) => tag)).toEqual([{ type: 'Notification' }]);
    read.mockClear();
    receive('data:changed', {});
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
  });
  test('refreshes each affected subscription once for an order and notification burst', async () => {
    const affected = [
      { type: 'Order', id: 'admin-one' },
      { type: 'Packing', id: 'two' },
      { type: 'Dashboard', id: 'CURRENT' },
      { type: 'Notification' },
    ];
    await subscribe([...affected, { type: 'Order', id: 'admin-unrelated' }]);
    receive('order:updated', { orderId: 'one' });
    receive('notification:new', { notification: { data: { orderId: 'one' } } });
    receive('order:assigned', { orderId: 'two' });
    receive('packing:updated', { orderId: 'two' });
    expect(read).not.toHaveBeenCalled();
    await flush();
    expect(read.mock.calls.map(([tag]) => tag)).toEqual(expect.arrayContaining(affected));
    expect(read).toHaveBeenCalledTimes(affected.length);
    // A later event must still refresh the page after the first batch completes.
    receive('order:updated', { orderId: 'one' });
    await flush();
    expect(read).toHaveBeenCalledTimes(affected.length + 2);
  });

  test('recovers list, packing and account subscriptions on reconnection', async () => {
    const tags = [{ type: 'Packing', id: 'missed-order' }, { type: 'CurrentUser' }, { type: 'Order', id: 'ADMIN_LIST' }];
    await subscribe(tags);
    receive('connect');
    await flush();
    expect(read).toHaveBeenCalledTimes(tags.length);
  });

  test('checklist changes refresh their session and packing activity without fetching unrelated business views', async () => {
    const related = [{ type: 'Packing', id: 'one' }, { type: 'Packing', id: 'ACTIVITY' }];
    await subscribe([...related, { type: 'Packing', id: 'unrelated' }, { type: 'Dashboard', id: 'CURRENT' },
      { type: 'Reports' }, { type: 'Order', id: 'ADMIN_LIST' }, { type: 'Delivery', id: 'LIST' }]);
    receive('packing:updated', { orderId: 'one' });
    await flush();
    expect(read.mock.calls.map(([tag]) => tag)).toEqual(expect.arrayContaining(related));
    expect(read).toHaveBeenCalledTimes(related.length);
  });

  test('a missing-item alert refreshes its inbox and packing views without a full order refresh', async () => {
    const related = [{ type: 'Packing', id: 'one' }, { type: 'Notification' }];
    await subscribe([...related, { type: 'Reports' }, { type: 'Dashboard', id: 'CURRENT' }, { type: 'Order', id: 'ADMIN_LIST' }]);
    receive('notification:new', { notification: { type: 'item_missing', data: { orderId: 'one' } } });
    await flush();
    expect(read.mock.calls.map(([tag]) => tag)).toEqual(expect.arrayContaining(related));
    expect(read).toHaveBeenCalledTimes(related.length);
  });

  test('discards queued work and stale callbacks when the session changes', async () => {
    await subscribe([{ type: 'Dashboard', id: 'CURRENT' }]);
    const staleHandler = handlers.get('order:updated');
    receive('order:updated', { orderId: 'one' });
    act(() => store.dispatch(clearCredentials()));
    act(() => staleHandler({ orderId: 'one' }));
    await flush();
    expect(read).not.toHaveBeenCalled();
  });

  test('cancels pending refreshes when the listener unmounts', async () => {
    await subscribe([{ type: 'Dashboard', id: 'CURRENT' }]);
    receive('order:new', { orderId: 'one' });
    const staleHandler = handlers.get('order:new');
    view.unmount();
    act(() => staleHandler({ orderId: 'one' }));
    await flush();
    expect(read).not.toHaveBeenCalled();
  });
});
