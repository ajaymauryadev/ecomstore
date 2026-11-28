import { useEffect, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { baseApi } from '../api/baseApi';
import { useSavedViewState } from './useSavedViewState';
import { accountScope } from './storage';
import { outboxMemory, removeIntent, saveIntent } from './outbox';
import { Cloud, CloudOff, AlertCircle } from 'lucide-react';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { discardPackingItem } from './packingOutbox';
import toast from 'react-hot-toast';

export function SavedDataGate({ children, fallback = null }) {
  const restoring = useSelector((state) => state.savedData.restoring);
  const offlineSession = useSelector((state) => state.auth.offlineSession);
  // Public reads and verified routes mount while storage hydrates. A local-only
  // workspace waits for its exact scoped snapshot before mounting its page.
  return restoring && offlineSession && globalThis.navigator?.onLine === false ? fallback : children;
}

export function SavedScroll() {
  const { pathname } = useLocation();
  const [position, setPosition] = useSavedViewState('scroll', 0);
  useEffect(() => {
    let frame;
    const element = () => document.querySelector('main');
    const restore = () => {
      window.scrollTo?.(0, position);
      const main = element();
      if (main) main.scrollTop = position;
    };
    frame = requestAnimationFrame(restore);
    const remember = (event) => {
      const target = event.target;
      if (target === document || target?.tagName === 'MAIN') setPosition(target?.scrollTop || window.scrollY || 0);
    };
    document.addEventListener('scroll', remember, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('scroll', remember, true); };
    // Restore only when the route changes, not on every scroll update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}

export default function SavedDataStatus() {
  const { pathname } = useLocation();
  // Customers get connection information in the store header, never over products.
  return /^\/(s|store|staff|super-admin)\//.test(pathname) ? null : <WorkspaceSyncStatus standalone />;
}

export function CustomerConnectionStatus({ tagline }) {
  const status = useSelector((state) => state.savedData);
  const offline = status.offline || globalThis.navigator?.onLine === false;
  const message = offline ? 'Offline · browsing saved products'
    : status.serverUnavailable ? 'Server unavailable · browsing saved products'
      : status.storageError ? 'Device storage unavailable · keep this tab open'
        : tagline || 'Your neighbourhood, in one basket';
  return <p className="customer-store-note" role="status" aria-live="polite" title={message}>{message}</p>;
}

export function WorkspaceSyncStatus({ standalone = false }) {
  const store = useStore();
  useLocation();
  const status = useSelector((state) => state.savedData);
  const offlineSession = useSelector((state) => state.auth.offlineSession);
  const account = useSelector((state) => accountScope(state.auth));
  const [, changed] = useState(0);
  const [resolving, setResolving] = useState(null);
  const discard = async (intent) => {
    setResolving(intent.id);
    try {
      if (intent.kind === 'packing') await discardPackingItem(store, intent);
      else await removeIntent(intent.id);
    } catch (error) { toast.error(error?.data?.message || error.message || 'Could not clear this request.'); }
    finally { setResolving(null); }
  };
  useEffect(() => {
    const update = () => changed((value) => value + 1);
    window.addEventListener('saved-outbox-changed', update);
    return () => window.removeEventListener('saved-outbox-changed', update);
  }, []);
  const intents = [...outboxMemory.values()].filter((entry) => entry.account === account);
  const queries = useSelector((state) => state.api.queries);
  useSelector((state) => state.api.subscriptions);
  const subscriptions = store.dispatch(baseApi.internalActions.internal_getRTKQSubscriptions());
  const active = Object.entries(queries).filter(([key]) => subscriptions.getSubscriptionCount(key) > 0).map(([, query]) => query);
  const timestamps = active.filter((query) => query.data !== undefined && query.fulfilledTimeStamp).map((query) => query.fulfilledTimeStamp);
  const checking = active.some((query) => query.status === 'pending');
  const missing = active.some((query) => query.data === undefined && query.status === 'rejected');
  const failed = active.some((query) => query.status === 'rejected');
  const throttled = active.filter((query) => query.error?.status === 429);
  const retryAt = Math.max(0, ...throttled.map((query) => query.error.data?.retryAt || 0));
  const retrySeconds = useRetryCountdown(retryAt);
  const offline = status.offline || globalThis.navigator?.onLine === false;
  const unreachable = status.serverUnavailable || active.some((query) => ['FETCH_ERROR', 'TIMEOUT_ERROR', 502, 503, 504].includes(query.error?.status));
  let message = offline ? 'Offline — showing last synced data. Connect to the internet for current, accurate information.'
    : offlineSession ? 'Showing saved data — checking your session. Server confirmation is required for changes.'
      : unreachable ? 'Server unavailable — showing saved data. Changes need server confirmation.'
        : throttled.length ? `Updates temporarily paused by the server request limit. ${retrySeconds > 0 ? `Retrying in ${retrySeconds} seconds.` : 'Retrying automatically.'} Saved data remains visible.`
          : checking ? 'Checking for updates — saved data remains visible.'
          : failed ? 'Updates could not be downloaded — showing saved data.' : 'Showing saved data.';
  if (missing && !throttled.length) message += ' Connect to the internet to download missing data.';
  if (standalone && !offline && !offlineSession && !status.storageError && !status.logoutPending && !intents.length) return null;
  const needsAttention = offline || unreachable || failed || status.storageError || status.logoutPending || intents.length > 0;
  const Icon = offline ? CloudOff : needsAttention ? AlertCircle : Cloud;
  return (
    <aside className={`saved-data-status workspace-sync-status${standalone ? ' sync-standalone' : ''}`} aria-label="Saved data status" data-attention={Boolean(needsAttention)}>
      <details>
        <summary className="saved-data-summary" aria-label="Connection and sync details" title={offline ? 'Offline · saved data' : needsAttention ? 'Connection needs attention' : 'Connection and sync details'}><Icon size={19} aria-hidden="true" /><span className="sr-only" role="status" aria-live="polite">{offline ? 'Offline · saved data' : 'Saved data'}</span></summary>
        <div className="saved-data-details">
          <span>{message}</span>
          {timestamps.length > 0 && <span>Last synced (oldest visible snapshot): {new Date(Math.min(...timestamps)).toLocaleString()}.</span>}
          {status.storageError && <span>{status.storageError}</span>}
          {status.coverageWarning && <span>{status.coverageWarning}</span>}
          {status.logoutPending && <span>Signed out locally — connect online to finish signing out of the server.</span>}
          {offline && <span>Drafts are provisional; orders, stock and payments are confirmed only by the server.</span>}
          {intents.length > 0 && <details><summary>{intents.length} saved request(s) · {intents.filter((intent) => intent.status === 'syncing').length} syncing · {intents.filter((intent) => intent.status === 'conflict').length} action required</summary>
            <div className="max-h-48 overflow-y-auto space-y-2 pt-2">{intents.map((intent) => <p key={intent.id}>
              {intent.status === 'conflict' ? 'Action required' : intent.status === 'syncing' ? 'Syncing' : 'Pending server confirmation'}: recorded {new Date(intent.createdAt).toLocaleString()}. {intent.error || (intent.kind === 'packing' ? 'Saved checklist will sync when your session is confirmed online.' : 'Return to the original form to confirm online.')}
              {intent.status === 'conflict' && <button disabled={resolving !== null} className="underline ml-2" onClick={() => { void discard(intent); }}>{resolving === intent.id ? 'Refreshing…' : intent.kind === 'packing' ? 'Use server status and clear this item’s saved changes' : 'Discard rejected request and edit draft'}</button>}
              {intent.kind === 'packing' && intent.status === 'conflict' && intent.errorStatus !== 409 && intent.reconciliationVersion && <button disabled={resolving !== null} className="underline ml-2" onClick={() => { void saveIntent({ ...intent, status: 'pending', attempts: 0, retryAt: 0 }).catch(() => changed((value) => value + 1)); }}>Retry original checklist change</button>}
            </p>)}</div>
          </details>}
        </div>
      </details>
    </aside>
  );
}
