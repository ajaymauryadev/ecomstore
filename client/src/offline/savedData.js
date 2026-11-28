import { baseApi, savedEndpointDefinitions } from '../api/baseApi';
import { clearCredentials, restoreOfflineIdentity, selectSessionEpoch } from '../features/auth/authSlice';
import { accountScope, businessSnapshot, savedStorage, SNAPSHOT_SCHEMA, MAX_SAVED_QUERIES, OFFLINE_ACCESS_MS } from './storage';
import { HYDRATE_SAVED_DATA, INVALIDATE_SAVED_QUERIES, savedDataStatus } from './savedDataSlice';
import { loadOutbox } from './outbox';
import { packingIntents, syncPackingOutbox } from './packingOutbox';
import { changedQueryKeys, retryableRead } from './revisionChanges';

export const viewMemory = new Map();
let sessionChannel;
const storageFailure = (dispatch) => dispatch(savedDataStatus({ storageError: 'Changes could not be saved on this device. Offline data may be incomplete.' }));
const online = () => globalThis.navigator?.onLine !== false;

export async function restoreScope(store) {
  const scope = accountScope(store.getState().auth);
  const epoch = selectSessionEpoch(store.getState());
  store.dispatch(savedDataStatus({ restoring: true }));
  try {
    const [snapshot, drafts] = await Promise.all([
      savedStorage.get('snapshots', scope), savedStorage.get('drafts', scope),
    ]);
    if (selectSessionEpoch(store.getState()) !== epoch) return;
    if (drafts) viewMemory.set(scope, drafts);
    if (snapshot?.schema === SNAPSHOT_SCHEMA && snapshot.queries && snapshot.provided) {
      store.dispatch({ type: HYDRATE_SAVED_DATA, payload: snapshot });
    }
  } catch { storageFailure(store.dispatch); }
  finally {
    if (selectSessionEpoch(store.getState()) === epoch) store.dispatch(savedDataStatus({ restoring: false }));
  }
}

export async function initializeSavedData(store) {
  try {
    await loadOutbox();
    const logoutPending = await savedStorage.get('identity', 'logoutPending');
    if (logoutPending) {
      store.dispatch(savedDataStatus({ logoutPending: true }));
      store.dispatch({ ...clearCredentials(), meta: { savedBoot: true } });
      await restoreScope(store);
      return;
    }
    const identity = await savedStorage.get('identity', 'active');
    if (identity?.user && identity.verifiedAt <= Date.now() && Date.now() - identity.verifiedAt < OFFLINE_ACCESS_MS && identity.user.isActive !== false) {
      store.dispatch({ ...restoreOfflineIdentity(identity), meta: { savedBoot: true } });
    } else if (identity) await savedStorage.delete('identity', 'active');
  } catch { storageFailure(store.dispatch); }
  await restoreScope(store);
}

// Only visible subscriptions compete for the network. Dormant views keep their
// saved data and refresh when opened after an actual invalidation.
export async function refreshSavedQueries(store, keys) {
  const epoch = selectSessionEpoch(store.getState());
  const subscriptions = store.dispatch(baseApi.internalActions.internal_getRTKQSubscriptions());
  const wanted = keys && new Set(keys);
  const priority = (query) => ['getNotifications', 'getUnreadCount', 'getMe'].includes(query.endpointName) ? 0 : 1;
  const entries = Object.entries(store.getState().api.queries)
    .filter(([key]) => (!wanted || wanted.has(key)) && subscriptions.getSubscriptionCount(key) > 0)
    .sort(([, a], [, b]) => priority(a) - priority(b));
  let cursor = 0;
  let complete = true;
  const worker = async () => {
    while (cursor < entries.length) {
      const [key, saved] = entries[cursor++];
      const state = store.getState();
      if (selectSessionEpoch(state) !== epoch || !online() || (state.auth.user && !state.auth.accessToken)) { complete = false; return; }
      const endpoint = baseApi.endpoints[saved.endpointName];
      const current = state.api.queries[key];
      if (!endpoint || !current || saved.endpointName === 'getSyncRevision') continue;
      if (current.status === 'pending') continue;
      if (current.fulfilledTimeStamp !== saved.fulfilledTimeStamp && current.status === 'fulfilled') continue;
      const result = await store.dispatch(endpoint.initiate(saved.originalArgs, { subscribe: false, forceRefetch: true }));
      // A busy/unavailable server gets a quiet interval before the next background pass.
      if (result.error && retryableRead({ status: 'rejected', error: result.error })) { complete = false; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  return complete;
}

export const savedDataMiddleware = (store) => {
  let saveTimer;
  let saveIdle;
  let refreshTimer;
  let refreshing = false;
  let followup = false;
  const invalidated = new Map();
  const requestVersions = new Map();
  let version = 0;
  const markStale = (keys, abort = false) => {
    for (const key of keys) {
      const query = store.getState().api.queries[key];
      if (!query || query.endpointName === 'getSyncRevision') continue;
      invalidated.set(key, ++version);
      if (abort && query.status === 'pending') store.dispatch(baseApi.util.getRunningQueryThunk(query.endpointName, query.originalArgs))?.abort();
    }
    scheduleRefresh();
  };
  const scheduleRefresh = () => {
    if (refreshing) { followup = true; return; }
    if (refreshTimer !== undefined) return;
    const subscriptions = store.dispatch(baseApi.internalActions.internal_getRTKQSubscriptions());
    if (![...invalidated.keys()].some((key) => subscriptions.getSubscriptionCount(key) > 0 && store.getState().api.queries[key]?.status !== 'pending')) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = undefined;
      refreshing = true;
      const keys = [...invalidated.keys()];
      try { await refreshSavedQueries(store, keys); }
      finally {
        refreshing = false;
        if (followup) { followup = false; scheduleRefresh(); }
      }
    }, 100);
  };
  let chain = Promise.resolve();
  const persist = () => {
    if (saveTimer !== undefined || saveIdle !== undefined) return;
    const save = () => {
      saveIdle = undefined;
      const state = store.getState();
      const scope = accountScope(state.auth);
      const epoch = selectSessionEpoch(state);
      const snapshot = businessSnapshot(state);
      chain = chain.then(async () => {
        if (epoch !== selectSessionEpoch(store.getState())) return;
        await savedStorage.put('snapshots', scope, snapshot);
        if (epoch === selectSessionEpoch(store.getState())) store.dispatch(savedDataStatus({ coverageWarning: snapshot.omitted
          ? 'Some downloaded data exceeds the device cache limit. Use narrower filters to prepare it for offline access.' : null }));
      }).catch(() => storageFailure(store.dispatch));
    };
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      if (typeof window.requestIdleCallback === 'function') saveIdle = window.requestIdleCallback(save, { timeout: 1000 });
      else save();
    }, 250);
  };
  return (next) => (action) => {
    if (action.type === INVALIDATE_SAVED_QUERIES) {
      markStale(action.payload);
      return action;
    }
    if (action.type === 'api/executeMutation/fulfilled' || action.type === baseApi.util.invalidateTags.type) {
      const definition = savedEndpointDefinitions.get(action.meta?.arg?.endpointName);
      const tags = action.type === baseApi.util.invalidateTags.type ? action.payload : typeof definition?.invalidatesTags === 'function'
        ? definition.invalidatesTags(action.payload, undefined, action.meta.arg.originalArgs, action.meta.baseQueryMeta)
        : definition?.invalidatesTags;
      // A read started before a confirmed write must not later replace the write's
      // patched data. Abort only affected reads; normal tag invalidation starts
      // their replacements, retaining the last success throughout.
      markStale(baseApi.util.selectInvalidatedBy(store.getState(), tags ?? []).map((query) => query.queryCacheKey), true);
    }
    // Keep invalidated closed views without downloading them. Opening one shows
    // the saved result immediately and schedules its background replacement.
    if (action.type === baseApi.internalActions.removeQueryResult.type && !action.meta?.allowSavedRemoval) {
      const query = store.getState().api.queries[action.payload.queryCacheKey];
      if (query?.data !== undefined) {
        if (!invalidated.has(action.payload.queryCacheKey)) markStale([action.payload.queryCacheKey]);
        return action;
      }
    }
    if (action.type === baseApi.internalActions.removeQueryResult.type) invalidated.delete(action.payload.queryCacheKey);
    if (action.type === baseApi.util.resetApiState.type) { invalidated.clear(); requestVersions.clear(); }
    const previous = store.getState();
    const result = next(action);
    const state = store.getState();
    if (action.type === 'api/executeQuery/pending') requestVersions.set(action.meta.requestId, invalidated.get(action.meta.arg.queryCacheKey));
    if (action.type === 'api/executeQuery/fulfilled' || (action.type === 'api/executeQuery/rejected' && !action.meta.condition)) {
      const key = action.meta.arg.queryCacheKey;
      if (action.type.endsWith('/fulfilled') && requestVersions.get(action.meta.requestId) === invalidated.get(key)) invalidated.delete(key);
      requestVersions.delete(action.meta.requestId);
      if ((action.type.endsWith('/fulfilled') || action.meta.aborted) && invalidated.has(key)) scheduleRefresh();
    }
    if (action.type === HYDRATE_SAVED_DATA) markStale(Object.keys(action.payload.queries));
    if (action.type === 'api/executeQuery/rejected' && action.meta.condition && action.meta.arg.subscribe !== false && invalidated.has(action.meta.arg.queryCacheKey)) scheduleRefresh();
    if (selectSessionEpoch(previous) !== selectSessionEpoch(state)) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      if (saveIdle !== undefined) window.cancelIdleCallback?.(saveIdle);
      saveIdle = undefined;
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      invalidated.clear();
      requestVersions.clear();
      if (!action.meta?.remoteSession && !action.meta?.savedBoot) sessionChannel?.postMessage({ previousScope: accountScope(previous.auth), scope: accountScope(state.auth), logout: action.type === clearCredentials.type });
      // Credentials never enter IndexedDB. Only a time-limited identity unlocks
      // this device's snapshots, and it cannot authorize server-side writes.
      if (action.type === clearCredentials.type) {
        const oldScope = accountScope(previous.auth);
        chain = chain.then(() => !action.meta?.remoteSession && savedStorage.delete('identity', 'active'))
          .then(() => previous.auth.user && savedStorage.delete('snapshots', oldScope))
          .catch(() => storageFailure(store.dispatch));
      }
      if (!action.meta?.savedBoot) void restoreScope(store);
    }
    if (state.auth.user && state.auth.accessToken && !state.auth.offlineSession &&
        ['auth/setCredentials', 'auth/updateUser', 'auth/setStore'].includes(action.type)) {
      scheduleRefresh();
      const identity = { user: state.auth.user, store: state.auth.store, verifiedAt: state.auth.verifiedAt };
      const identityEpoch = selectSessionEpoch(state);
      chain = chain.then(async () => {
        if (selectSessionEpoch(store.getState()) !== identityEpoch) return;
        const active = await savedStorage.get('identity', 'active');
        if (action.type !== 'auth/setCredentials' && active?.user?._id && active.user._id !== identity.user._id) return;
        if (selectSessionEpoch(store.getState()) === identityEpoch) await savedStorage.put('identity', 'active', identity);
      }).catch(() => storageFailure(store.dispatch));
    }
    const businessRead = action.meta?.arg?.endpointName && !['getMe', 'getSyncRevision'].includes(action.meta.arg.endpointName);
    if ((businessRead && (action.type === 'api/executeQuery/fulfilled' ||
        (action.type === 'api/executeQuery/rejected' && !action.meta?.condition))) || action.type === 'api/queries/queryResultPatched') {
      persist();
      const queries = Object.entries(state.api.queries);
      if (queries.length > MAX_SAVED_QUERIES) {
        const subscriptions = store.dispatch(baseApi.internalActions.internal_getRTKQSubscriptions());
        let excess = queries.length - MAX_SAVED_QUERIES;
        for (const [key, value] of queries.sort((a, b) => (a[1].fulfilledTimeStamp ?? 0) - (b[1].fulfilledTimeStamp ?? 0))) {
          if (excess <= 0) break;
          if (value.status === 'pending' || subscriptions.getSubscriptionCount(key)) continue;
          store.dispatch({ ...baseApi.internalActions.removeQueryResult({ queryCacheKey: key }), meta: { allowSavedRemoval: true } });
          excess--;
        }
      }
    }
    return result;
  };
};

export function startSavedDataSync(store) {
  let stopped = false;
  let outboxTimer;
  if ('BroadcastChannel' in window) {
    sessionChannel = new BroadcastChannel('smart-kirana-session');
    sessionChannel.onmessage = ({ data }) => {
      const auth = store.getState().auth;
      if (auth.user && (data.scope !== accountScope(auth) || (data.logout && data.previousScope === accountScope(auth)))) {
        store.dispatch({ ...clearCredentials(), meta: { remoteSession: true } });
      }
    };
  }
  let running = false;
  let lastCheck = 0;
  const revisions = new Map();
  const checkRevision = async () => {
    const state = store.getState();
    const epoch = selectSessionEpoch(state);
    const scope = accountScope(state.auth);
    if (state.auth.user && !state.auth.accessToken) return;
    const slugs = new Set(Object.values(state.api.queries)
      .filter((query) => query.endpointName === 'getStorefrontInfo').map((query) => query.originalArgs));
    if (state.auth.accessToken) slugs.add(undefined);
    // The minute heartbeat downloads counters only. Business data is fetched
    // only for changed domains or failed reads, never on a five-minute timer.
    const checked = new Map();
    const keys = new Set();
    for (const slug of slugs) {
      const result = await store.dispatch(baseApi.endpoints.getSyncRevision.initiate(slug, { subscribe: false, forceRefetch: true }));
      if (selectSessionEpoch(store.getState()) !== epoch || result.error) return;
      checked.set(slug, result.data?.data);
      for (const key of changedQueryKeys(store.getState(), revisions.get(scope)?.get(slug), result.data?.data)) keys.add(key);
    }
    // Retry unsuccessful reads even if the revision did not change.
    for (const [key, query] of Object.entries(store.getState().api.queries)) if (retryableRead(query)) keys.add(key);
    if (selectSessionEpoch(store.getState()) === epoch) {
      if (keys.size) store.dispatch({ type: INVALIDATE_SAVED_QUERIES, payload: [...keys] });
      revisions.set(scope, checked);
    }
  };
  const check = async (force = false) => {
    if (stopped || running || !online() || document.visibilityState === 'hidden' || (!force && Date.now() - lastCheck < 60000)) return;
    if (store.getState().savedData.restoring) return;
    running = true;
    lastCheck = Date.now();
    // Write replay and reads are independent. A delayed packing request or a
    // device-storage error must never hold the inbox or revision probe hostage.
    syncOutbox();
    try { await checkRevision(); } finally { running = false; }
  };
  const connection = () => {
    store.dispatch(savedDataStatus({ offline: !online() }));
    if (online()) void check(true);
  };
  const focus = () => {
    const auth = store.getState().auth;
    if (auth.user && auth.verifiedAt && Date.now() - auth.verifiedAt >= OFFLINE_ACCESS_MS) store.dispatch(clearCredentials());
    void check();
  };
  const cartStorageError = () => storageFailure(store.dispatch);
  const schedulePackingRetry = () => {
    clearTimeout(outboxTimer);
    if (stopped || !online() || !store.getState().auth.accessToken) return;
    const retries = packingIntents(accountScope(store.getState().auth))
      .filter((intent) => intent.status === 'pending' && intent.retryAt > Date.now()).map((intent) => intent.retryAt);
    if (retries.length) outboxTimer = setTimeout(syncOutbox, Math.max(1, Math.min(...retries) - Date.now()));
  };
  const syncOutbox = () => {
    if (stopped) return;
    void syncPackingOutbox(store).catch(() => storageFailure(store.dispatch)).finally(schedulePackingRetry);
  };
  window.addEventListener('saved-cart-storage-error', cartStorageError);
  window.addEventListener('saved-outbox-changed', syncOutbox);
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  window.addEventListener('focus', focus);
  document.addEventListener('visibilitychange', focus);
  // Controlled fallback covers modules and anonymous customers without socket events.
  const interval = setInterval(focus, 60000);
  let authChecked = false;
  const unsubscribe = store.subscribe(() => {
    const state = store.getState();
    if (!state.auth.accessToken) authChecked = false;
    if (state.auth.accessToken && !state.savedData.restoring && !authChecked) {
      authChecked = true;
      queueMicrotask(() => { void check(true); });
    }
    if (state.auth.user && state.auth.verifiedAt && Date.now() - state.auth.verifiedAt >= OFFLINE_ACCESS_MS) store.dispatch(clearCredentials());
  });
  connection();
  return () => {
    stopped = true;
    clearTimeout(outboxTimer);
    clearInterval(interval); unsubscribe();
    window.removeEventListener('online', connection); window.removeEventListener('offline', connection);
    window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
    window.removeEventListener('saved-cart-storage-error', cartStorageError);
    window.removeEventListener('saved-outbox-changed', syncOutbox);
    sessionChannel?.close(); sessionChannel = undefined;
  };
}
