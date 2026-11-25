// Speculative reads yield to the visible page and limited connections.
export function backgroundAllowed() {
  const connection = navigator.connection;
  return navigator.onLine !== false && document.visibilityState !== 'hidden' &&
    !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType);
}

export function scheduleBackgroundTasks(tasks, { isCurrent = () => true, isReady = () => true, delay = 350 } = {}) {
  let cancelled = false, running = false, timer, idle;
  const remaining = [...tasks];
  const cancel = () => {
    cancelled = true;
    clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('online', schedule);
    navigator.connection?.removeEventListener?.('change', schedule);
  };
  async function run() {
    idle = undefined;
    if (cancelled) return;
    if (!isCurrent() || !remaining.length) { cancel(); return; }
    if (!backgroundAllowed()) return;
    if (!isReady() || navigator.scheduling?.isInputPending?.()) { schedule(); return; }
    running = true;
    try { await remaining.shift()(); } catch { /* Visible pages handle their own errors. */ }
    running = false;
    schedule();
  }
  function schedule() {
    if (cancelled || running || timer !== undefined || idle !== undefined) return;
    if (!isCurrent() || !remaining.length) { cancel(); return; }
    if (!backgroundAllowed()) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 2000 });
      else void run();
    }, delay);
  }
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('online', schedule);
  navigator.connection?.addEventListener?.('change', schedule);
  schedule();
  return cancel;
}
