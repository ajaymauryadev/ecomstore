import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useIdempotentSubmission } from './useIdempotentSubmission';

test('reuses the submitted key and details after a timeout, then gives an identical new sale a new key', async () => {
  const timeout = { status: 'TIMEOUT_ERROR' };
  const response = { data: { order: { _id: 'order-id' } } };
  const createOrder = vi.fn()
    .mockReturnValueOnce({ unwrap: () => Promise.reject(timeout) })
    .mockReturnValue({ unwrap: () => Promise.resolve(response) });
  const { result } = renderHook(() => useIdempotentSubmission(createOrder, 'store:cashier'));
  const payload = { items: [{ productId: 'product', variantId: 'variant', qty: 1 }] };

  await act(async () => {
    await expect(result.current.submit(payload)).rejects.toBe(timeout);
  });
  expect(result.current.retryPending).toBe(true);
  const submitted = createOrder.mock.calls[0][0];

  await act(async () => {
    await expect(result.current.submit()).resolves.toBe(response);
  });
  expect(createOrder.mock.calls[1][0]).toEqual(submitted);
  expect(result.current.retryPending).toBe(false);

  await act(async () => {
    await result.current.submit(payload);
  });
  expect(createOrder.mock.calls[2][0]).toMatchObject(payload);
  expect(createOrder.mock.calls[2][0].idempotencyKey).not.toBe(submitted.idempotencyKey);
});
