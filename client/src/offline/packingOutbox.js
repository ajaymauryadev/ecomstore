import { baseApi } from '../api/baseApi';
import '../features/packing/packingApi';
import { selectSessionEpoch } from '../features/auth/authSlice';
import { accountScope } from './storage';
import { outboxMemory, outboxKey, saveIntent, removeIntent } from './outbox';

const running = new WeakSet();
const legacyItemConflict = (intent) => intent.error === 'This item changed while you were offline. Review your saved checklist.';
const itemConflict = (intent) => intent.errorCode === 'PACKING_ITEM_CHANGED' || legacyItemConflict(intent);
export const packingIntents = (account, orderId) => [...outboxMemory.values()]
  .filter((entry) => entry.account === account && entry.kind === 'packing' && (!orderId || entry.payload.orderId === orderId))
  .sort((a, b) => a.sequence - b.sequence);

function packingRequest(store, orderId, item, action, reason) {
  const account = accountScope(store.getState().auth);
  const operationId = crypto.randomUUID();
  const existing = packingIntents(account);
  const recordedAt = new Date().toISOString();
  const scope = `packing:${orderId}:${operationId}`;
  return {
    id: outboxKey(account, scope), scope, account, kind: 'packing', status: 'pending',
    key: operationId, createdAt: Date.now(), sequence: Math.max(Date.now(), (existing.at(-1)?.sequence ?? 0) + 1), attempts: 0,
    payload: { orderId, itemId: item._id, action, ...(reason && { missingReason: reason }), operationId, recordedAt, expectedStatus: item.status },
  };
}

export async function enqueuePacking(store, orderId, item, action, reason) {
  await saveIntent(packingRequest(store, orderId, item, action, reason));
}

export async function submitPackingAction(store, orderId, item, action, reason) {
  const auth = store.getState().auth;
  if (!auth.accessToken || auth.offlineSession || navigator.onLine === false || packingIntents(accountScope(auth), orderId).length) {
    return enqueuePacking(store, orderId, item, action, reason);
  }
  // Online writes go straight to the server. Saving read snapshots or a slow
  // device database must not become a prerequisite for doing packing work.
  const intent = packingRequest(store, orderId, item, action, reason);
  const epoch = selectSessionEpoch(store.getState());
  const mutation = store.dispatch(baseApi.endpoints.updateItemStatus.initiate(intent.payload));
  try {
    const result = await mutation.unwrap();
    if (selectSessionEpoch(store.getState()) === epoch) await cacheSession(store, orderId, result?.data?.session);
  } catch (error) {
    if (selectSessionEpoch(store.getState()) !== epoch) throw error;
    const details = error?.data?.errors;
    if (details?.code === 'PACKING_ITEM_CHANGED') await cacheSession(store, orderId, details.session);
    const permanent = [400, 401, 403, 404, 409, 410, 422].includes(error?.status);
    const saved = { ...intent, status: permanent ? 'conflict' : 'pending', attempts: 1, reconciliationVersion: 1,
      retryAt: permanent ? null : Math.max(error?.data?.retryAt ?? 0, Date.now() + 2000),
      errorStatus: error?.status, errorCode: details?.code,
      error: error?.data?.message || 'Packing update not confirmed. The original request is saved for retry.' };
    try { await saveIntent(saved); }
    catch {
      // Keep the exact operation in memory when storage is unavailable; the
      // server receipt makes any subsequent retry safe.
      outboxMemory.set(saved.id, saved);
      window.dispatchEvent(new Event('saved-outbox-changed'));
      throw new Error('This packing change is not confirmed and could not be saved on this device. Keep this tab open and retry when connected.');
    }
  } finally { mutation.reset(); }
}

async function cacheSession(store, orderId, session) {
  if (!session) return;
  const endpoint = baseApi.endpoints.getPackingSession;
  const args = { orderId };
  const cached = endpoint.select(args)(store.getState());
  if (Date.parse(cached.data?.data?.session?.updatedAt) > Date.parse(session.updatedAt)) return;
  // Cancel a read started before this write so it cannot restore stale buttons.
  if (cached.status === 'pending') store.dispatch(baseApi.util.getRunningQueryThunk('getPackingSession', args))?.abort();
  if (cached.data) await store.dispatch(baseApi.util.upsertQueryData('getPackingSession', args, {
    ...cached.data, data: { ...cached.data.data, session },
  }));
}

export async function discardPackingItem(store, intent) {
  const account = accountScope(store.getState().auth);
  const epoch = selectSessionEpoch(store.getState());
  if (intent.account !== account) throw new Error('Reopen this order in the original account.');
  const { orderId, itemId } = intent.payload;
  const requests = packingIntents(account, orderId).filter((entry) => entry.payload.itemId === itemId);
  if (requests.some((entry) => entry.status === 'syncing')) throw new Error('Wait for this item to finish syncing.');
  // Download first. A failed read must not destroy the user's saved checklist.
  store.dispatch(baseApi.util.getRunningQueryThunk('getPackingSession', { orderId }))?.abort();
  await store.dispatch(baseApi.endpoints.getPackingSession.initiate({ orderId }, { subscribe: false, forceRefetch: true })).unwrap();
  if (selectSessionEpoch(store.getState()) !== epoch) throw new Error('Your session changed. Reopen this order.');
  // Remove dependent changes first; leave the blocking request until last.
  for (const entry of requests.reverse()) await removeIntent(entry.id);
}

export async function syncPackingOutbox(store) {
  if (running.has(store)) return;
  const auth = store.getState().auth;
  if (!auth.accessToken || auth.offlineSession || navigator.onLine === false || store.getState().savedData?.restoring) return;
  const account = accountScope(auth);
  if (!packingIntents(account).length) return;
  const epoch = selectSessionEpoch(store.getState());
  const current = () => selectSessionEpoch(store.getState()) === epoch && accountScope(store.getState().auth) === account &&
    store.getState().auth.accessToken && !store.getState().auth.offlineSession && navigator.onLine !== false;
  const blockedOrders = new Map();
  const blockedItems = new Map();
  const visited = new Set();
  const block = (intent) => {
    const { orderId, itemId } = intent.payload;
    if (itemConflict(intent)) blockedItems.set(JSON.stringify([orderId, itemId]), intent.id);
    else blockedOrders.set(orderId, intent.id);
  };
  running.add(store);
  try {
    // Drain newly added requests too: outbox events during a running sync are
    // deliberately deduplicated, so a one-time snapshot would strand them.
    while (current()) {
      const batch = packingIntents(account).filter((intent) => !visited.has(intent.id));
      if (!batch.length) break;
      for (const entry of batch) {
        if (!current()) return;
        visited.add(entry.id);
        // A user may have cleared this item while a different item was syncing.
        const intent = outboxMemory.get(entry.id);
        if (!intent) continue;
        const orderId = intent.payload.orderId;
        const itemKey = JSON.stringify([orderId, intent.payload.itemId]);
        if (outboxMemory.has(blockedOrders.get(orderId)) || outboxMemory.has(blockedItems.get(itemKey))) continue;
        // Upgrade previously rejected stale requests once. The server can now
        // acknowledge already-satisfied changes without overwriting newer work.
        const recoverLegacy = intent.status === 'conflict' && legacyItemConflict(intent) && !intent.reconciliationVersion;
        if ((intent.status === 'conflict' && !recoverLegacy) || intent.retryAt > Date.now()) {
          block(intent);
          continue;
        }
        const request = { ...intent, attempts: recoverLegacy ? 0 : intent.attempts, reconciliationVersion: 1 };
        try {
          await saveIntent({ ...request, status: 'syncing' });
          if (!current()) return;
          const mutation = store.dispatch(baseApi.endpoints.updateItemStatus.initiate(intent.payload));
          let result;
          try { result = await mutation.unwrap(); } finally { mutation.reset(); }
          if (!current()) return;
          await cacheSession(store, orderId, result?.data?.session);
          await removeIntent(intent.id);
        } catch (error) {
          if (!current()) return;
          const details = error?.data?.errors;
          if (details?.code === 'PACKING_ITEM_CHANGED') await cacheSession(store, orderId, details.session);
          const attempts = (request.attempts ?? 0) + 1;
          const permanent = [400, 401, 403, 404, 409, 410, 422].includes(error?.status) || attempts >= 5;
          const failed = { ...request, status: permanent ? 'conflict' : 'pending', attempts,
            retryAt: permanent ? null : Math.max(error?.data?.retryAt ?? 0, Date.now() + Math.min(60000, 1000 * 2 ** attempts)),
            errorStatus: error?.status, errorCode: details?.code,
            error: error?.data?.message || 'Packing update not confirmed. The original request is saved for retry.' };
          await saveIntent(failed);
          block(failed);
        }
      }
    }
  } finally { running.delete(store); }
}
