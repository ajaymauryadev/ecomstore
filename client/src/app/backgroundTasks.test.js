import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { scheduleBackgroundTasks } from './backgroundTasks';

let cancel;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
});
afterEach(() => { cancel?.(); vi.useRealTimers(); });

test('waits for visible work and runs one background task at a time', async () => {
  let ready = false, release;
  const first = vi.fn(() => new Promise((resolve) => { release = resolve; }));
  const second = vi.fn();
  cancel = scheduleBackgroundTasks([first, second], { isReady: () => ready });
  await vi.advanceTimersByTimeAsync(1000);
  expect(first).not.toHaveBeenCalled();
  ready = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  release();
  await vi.advanceTimersByTimeAsync(400);
  expect(second).toHaveBeenCalledOnce();
});

test('resumes after a hidden tab becomes visible', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const task = vi.fn();
  cancel = scheduleBackgroundTasks([task]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(task).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(400);
  expect(task).toHaveBeenCalledOnce();
});

test.each([{ saveData: true }, { effectiveType: '2g' }])('skips speculative traffic for %j', async (connection) => {
  Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
  const task = vi.fn();
  cancel = scheduleBackgroundTasks([task]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(task).not.toHaveBeenCalled();
});

test('stops queued work when the session changes or the caller cancels', async () => {
  let current = true;
  const task = vi.fn();
  cancel = scheduleBackgroundTasks([task], { isCurrent: () => current });
  current = false;
  await vi.advanceTimersByTimeAsync(400);
  expect(task).not.toHaveBeenCalled();
  cancel = scheduleBackgroundTasks([task]);
  cancel();
  await vi.advanceTimersByTimeAsync(400);
  expect(task).not.toHaveBeenCalled();
});
