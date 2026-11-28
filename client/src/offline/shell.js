import { savedDataStatus } from './savedDataSlice';
import { diagnosticsEnabled, markPerformance, recordDuration } from '../diagnostics/performance';

export async function registerOfflineShell(store) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const started = diagnosticsEnabled() ? performance.now() : null;
  try {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    store.dispatch(savedDataStatus({ shellReady: true }));
    markPerformance('service-worker:ready');
  } catch {
    store.dispatch(savedDataStatus({ storageError: 'Offline app assets could not be prepared. Reloading without internet may not work.' }));
  }
  finally { if (started !== null) recordDuration('serviceWorker.ready', performance.now() - started); }
}
