import { baseApi, savedEndpointDefinitions } from '../api/baseApi';
import { clearCredentials, restoreOfflineIdentity, selectSessionEpoch } from '../features/auth/authSlice';
import { accountScope, businessSnapshot, savedStorage, SNAPSHOT_SCHEMA, MAX_SAVED_QUERIES, OFFLINE_ACCESS_MS } from './storage';
import { HYDRATE_SAVED_DATA, savedDataStatus } from './savedDataSlice';
import { loadOutbox } from './outbox';
import { syncPackingOutbox } from './packingOutbox';
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

// Serial, deduplicated background reads also include closed pages; navigation is not a refresh signal.
export async function refreshSavedQueries(store, keys) {
  const epoch = selectSessionEpoch(store.getState());
  const subscriptions = store.dispatch(baseApi.internalActions.internal_getRTKQSubscriptions());
  const entries = Object.entries(store.getState().api.queries).filter(([key]) => !keys || keys.includes(key))
    .sort(([a], [b]) => Number(subscriptions.getSubscriptionCount(b) > 0) - Number(subscriptions.getSubscriptionCount(a) > 0));
  for (const [key, saved] of entries) {
    const state = store.getState();
    if (selectSessionEpoch(state) !== epoch || !online() || (state.auth.user && !state.auth.accessToken)) return false;
    const endpoint = baseApi.endpoints[saved.endpointName];
    const current = state.api.queries[key];
    if (!endpoint || !current || saved.endpointName === 'getSyncRevision') continue;
    // A read already in flight may predate the detected write. Do not advance
    // the revision checkpoint until it can be reconciled on the next pass.
    if (current.status === 'pending') return false;
    if (current.fulfilledTimeStamp !== saved.fulfilledTimeStamp && current.status === 'fulfilled') continue;
    const result = await store.dispatch(endpoint.initiate(saved.originalArgs, { subscribe: false, forceRefetch: true }));
    // A busy/unavailable server gets a quiet interval before the next background pass.
    if (result.error && retryableRead({ status: 'rejected', error: result.error })) return false;
  }
  return true;
}

export const savedDataMiddleware = (store) => {
  let saveTimer;
  let refreshTimer;
  let refreshing = false;
  const invalidated = new Set();
  const scheduleRefresh = () => {
    if (refreshing || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = undefined;
      refreshing = true;
      const keys = [...invalidated];
      invalidated.clear();
      try { await refreshSavedQueries(store, keys); }
      finally {
        refreshing = false;
        if (invalidated.size) scheduleRefresh();
      }
    }, 100);
  };
  let chain = Promise.resolve();
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
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
    }, 100);
  };
  return (next) => (action) => {
    if (action.type === 'api/executeMutation/fulfilled') {
      const definition = savedEndpointDefinitions.get(action.meta.arg.endpointName);
      const tags = typeof definition?.invalidatesTags === 'function'
        ? definition.invalidatesTags(action.payload, undefined, action.meta.arg.originalArgs, action.meta.baseQueryMeta)
        : definition?.invalidatesTags;
      // A read started before a confirmed write must not later replace the write's
      // patched data. Abort only affected reads; normal tag invalidation starts
      // their replacements, retaining the last success throughout.
      for (const query of baseApi.util.selectInvalidatedBy(store.getState(), tags ?? [])) {
        const current = store.getState().api.queries[query.queryCacheKey];
        if (current?.status === 'pending') store.dispatch(baseApi.util.getRunningQueryThunk(query.endpointName, query.originalArgs))?.abort();
      }
    }
    // RTK normally deletes invalidated queries with no mounted subscribers. Keep
    // the last success and refresh it, including when a mutation affects a closed page.
    if (action.type === baseApi.internalActions.removeQueryResult.type && !action.meta?.allowSavedRemoval) {
      const query = store.getState().api.queries[action.payload.queryCacheKey];
      if (query?.data !== undefined) {
        invalidated.add(action.payload.queryCacheKey);
        scheduleRefresh();
        return action;
      }
    }
    const previous = store.getState();
    const result = next(action);
    const state = store.getState();
    if (selectSessionEpoch(previous) !== selectSessionEpoch(state)) {
      clearTimeout(saveTimer);
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      invalidated.clear();
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
      const identity = { user: state.auth.user, store: state.auth.store, verifiedAt: state.auth.verifiedAt };
      const identityEpoch = selectSessionEpoch(state);
      chain = chain.then(async () => {
        if (selectSessionEpoch(store.getState()) !== identityEpoch) return;
        const active = await savedStorage.get('identity', 'active');
        if (action.type !== 'auth/setCredentials' && active?.user?._id && active.user._id !== identity.user._id) return;
        if (selectSessionEpoch(store.getState()) === identityEpoch) await savedStorage.put('identity', 'active', identity);
      }).catch(() => storageFailure(store.dispatch));
    }
    if (action.type === 'api/executeQuery/fulfilled' || action.type === 'api/queries/queryResultPatched' ||
        (action.type === 'api/executeQuery/rejected' && !action.meta?.condition)) {
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
    if ((!keys.size || await refreshSavedQueries(store, [...keys])) && selectSessionEpoch(store.getState()) === epoch) {
      revisions.set(scope, checked);
    }
  };
  const check = async (force = false) => {
    if (running || !online() || document.visibilityState === 'hidden' || (!force && Date.now() - lastCheck < 60000)) return;
    if (store.getState().savedData.restoring) return;
    running = true;
    lastCheck = Date.now();
    try { await syncPackingOutbox(store); await checkRevision(); } finally { running = false; }
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
  const syncOutbox = () => { void syncPackingOutbox(store).catch(() => storageFailure(store.dispatch)); };
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
    clearInterval(interval); unsubscribe();
    window.removeEventListener('online', connection); window.removeEventListener('offline', connection);
    window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
    window.removeEventListener('saved-cart-storage-error', cartStorageError);
    window.removeEventListener('saved-outbox-changed', syncOutbox);
    sessionChannel?.close(); sessionChannel = undefined;
  };
}
