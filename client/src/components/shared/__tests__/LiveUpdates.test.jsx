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
    view.unmount();
    await flush();
    expect(read).not.toHaveBeenCalled();
  });
});
