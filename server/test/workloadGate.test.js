import { expect, test, vi } from 'vitest';
import { workloadGate } from '../src/middleware/workloadGate.js';

test('shares capacity across expensive endpoints and frees it after errors', async () => {
  const admit = workloadGate(1);
  let release;
  const held = admit(() => new Promise((resolve) => { release = resolve; }));
  const work = vi.fn(async () => { throw new Error('Injected failure'); });
  const limited = admit(work);
  const res = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  const pending = held({}, res, next);
  await limited({}, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.set).toHaveBeenCalledWith('Retry-After', '2');
  expect(work).not.toHaveBeenCalled();
  release();
  await pending;
  await limited({}, res, next);
  await limited({}, res, next);
  expect(work).toHaveBeenCalledTimes(2);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Injected failure' }));
});
