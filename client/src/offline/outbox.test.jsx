import { act, renderHook } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { expect, test, vi } from 'vitest';
import authReducer, { setCredentials } from '../features/auth/authSlice';
import { useIdempotentSubmission } from '../hooks/useIdempotentSubmission';
import { outboxMemory, loadOutbox } from './outbox';
import { savedStorage } from './storage';

function fixture() {
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setCredentials({ user: { _id: crypto.randomUUID(), role: 'store_owner' }, store: { _id: 'shop' }, accessToken: 'confirmed-online-token' }));
  return function OutboxTestWrapper({ children }) { return <Provider store={store}>{children}</Provider>; };
}

test('an uncertain financial request survives restart and retries only its original payload and ID', async () => {
  const wrapper = fixture();
  const send = vi.fn().mockReturnValueOnce({ unwrap: async () => { throw { status: 'TIMEOUT_ERROR' }; } })
    .mockReturnValue({ unwrap: async () => ({ data: { order: 'confirmed' } }) });
  let hook = renderHook(() => useIdempotentSubmission(send, 'pos:test', { persist: true }), { wrapper });
  await act(async () => { await expect(hook.result.current.submit({ items: [{ qty: 1 }] })).rejects.toMatchObject({ status: 'TIMEOUT_ERROR' }); });
  const original = send.mock.calls[0][0];
  expect(hook.result.current.retryPending).toBe(true);
  hook.unmount();
  outboxMemory.clear();
  await loadOutbox();
  hook = renderHook(() => useIdempotentSubmission(send, 'pos:test', { persist: true }), { wrapper });
  expect(hook.result.current.retryPending).toBe(true);
  await act(async () => { await hook.result.current.submit({ items: [{ qty: 999 }] }); });
  expect(send.mock.calls[1][0]).toEqual(original);
  expect(hook.result.current.retryPending).toBe(false);
  expect([...outboxMemory.values()].some((entry) => entry.scope === 'pos:test')).toBe(false);
});

test('storage failure prevents the first financial network write', async () => {
  const wrapper = fixture();
  const send = vi.fn();
  vi.spyOn(savedStorage, 'put').mockRejectedValue(new DOMException('Quota', 'QuotaExceededError'));
  const hook = renderHook(() => useIdempotentSubmission(send, 'pos:quota', { persist: true }), { wrapper });
  await act(async () => { await expect(hook.result.current.submit({ amount: 100 })).rejects.toMatchObject({ status: 'STORAGE_ERROR' }); });
  expect(send).not.toHaveBeenCalled();
});

test('independent submissions in the same account cannot overwrite or delete each other', async () => {
  const wrapper = fixture();
  const send = vi.fn().mockImplementation(() => ({ unwrap: async () => { throw { status: 'TIMEOUT_ERROR' }; } }));
  const first = renderHook(() => useIdempotentSubmission(send, 'pos:two-tabs', { persist: true }), { wrapper });
  const second = renderHook(() => useIdempotentSubmission(send, 'pos:two-tabs', { persist: true }), { wrapper });
  await act(async () => {
    await Promise.allSettled([first.result.current.submit({ amount: 10 }), second.result.current.submit({ amount: 20 })]);
  });
  const pending = [...outboxMemory.values()].filter((entry) => entry.scope === 'pos:two-tabs');
  expect(pending).toHaveLength(2);
  expect(new Set(pending.map((entry) => entry.id)).size).toBe(2);
  send.mockReturnValue({ unwrap: async () => ({ confirmed: true }) });
  await act(async () => { await first.result.current.submit(); });
  const remaining = [...outboxMemory.values()].filter((entry) => entry.scope === 'pos:two-tabs');
  expect(remaining).toHaveLength(1);
  expect(remaining[0].payload).toEqual({ amount: 20 });
  await act(async () => { await second.result.current.submit(); });
});
