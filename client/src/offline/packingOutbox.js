import { baseApi } from '../api/baseApi';
import { accountScope } from './storage';
import { outboxMemory, outboxKey, saveIntent, removeIntent } from './outbox';

const running = new WeakSet();
export const packingIntents = (account, orderId) => [...outboxMemory.values()]
  .filter((entry) => entry.account === account && entry.kind === 'packing' && (!orderId || entry.payload.orderId === orderId))
  .sort((a, b) => a.sequence - b.sequence);

export async function enqueuePacking(store, orderId, item, action, reason) {
  const account = accountScope(store.getState().auth);
  const operationId = crypto.randomUUID();
  const existing = packingIntents(account);
  const recordedAt = new Date().toISOString();
  const scope = `packing:${orderId}:${operationId}`;
  await saveIntent({
    id: outboxKey(account, scope), scope, account, kind: 'packing', status: 'pending',
    key: operationId, createdAt: Date.now(), sequence: Math.max(Date.now(), (existing.at(-1)?.sequence ?? 0) + 1), attempts: 0,
    payload: { orderId, itemId: item._id, action, ...(reason && { missingReason: reason }), operationId, recordedAt, expectedStatus: item.status },
  });
}

export async function syncPackingOutbox(store) {
  if (running.has(store)) return;
  const auth = store.getState().auth;
  if (!auth.accessToken || auth.offlineSession || navigator.onLine === false || store.getState().savedData?.restoring) return;
  const account = accountScope(auth);
  const blocked = new Set();
  running.add(store);
  try {
    for (const intent of packingIntents(account)) {
      if (accountScope(store.getState().auth) !== account || !store.getState().auth.accessToken || navigator.onLine === false) break;
      const orderId = intent.payload.orderId;
      if (blocked.has(orderId)) continue;
      if (intent.status === 'conflict' || intent.retryAt > Date.now()) { blocked.add(orderId); continue; }
      try {
        await saveIntent({ ...intent, status: 'syncing' });
        const endpoint = baseApi.endpoints.updateItemStatus;
        if (!endpoint) break;
        await store.dispatch(endpoint.initiate(intent.payload)).unwrap();
        await removeIntent(intent.id);
      } catch (error) {
        const attempts = (intent.attempts ?? 0) + 1;
        const permanent = [400, 401, 403, 404, 409, 410, 422].includes(error?.status) || attempts >= 5;
        await saveIntent({ ...intent, status: permanent ? 'conflict' : 'pending', attempts,
          retryAt: permanent ? null : Math.max(error?.data?.retryAt ?? 0, Date.now() + Math.min(60000, 1000 * 2 ** attempts)),
          error: error?.data?.message || 'Packing update not confirmed. The original request is saved for retry.' });
        blocked.add(orderId);
      }
    }
  } finally { running.delete(store); }
}
