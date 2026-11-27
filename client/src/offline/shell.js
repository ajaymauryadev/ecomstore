import { savedDataStatus } from './savedDataSlice';

export async function registerOfflineShell(store) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    store.dispatch(savedDataStatus({ shellReady: true }));
  } catch {
    store.dispatch(savedDataStatus({ storageError: 'Offline app assets could not be prepared. Reloading without internet may not work.' }));
  }
}
