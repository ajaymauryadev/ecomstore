// Business data deliberately lives outside the service worker's public asset cache.
const DATABASE = 'smart-kirana-saved-data';
const VERSION = 2;
let database;

async function open() {
  if (!globalThis.indexedDB) throw new Error('Offline storage is unavailable in this browser.');
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      for (const name of ['snapshots', 'drafts', 'identity', 'outbox']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('Close older app tabs to update offline storage.')); };
  });
  return database;
}

export async function storageRequest(store, mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = operation(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error || request?.error);
    transaction.onabort = () => reject(transaction.error || new Error('Saving offline data was interrupted.'));
  });
}

export const savedStorage = {
  get: (store, key) => storageRequest(store, 'readonly', (table) => table.get(key)),
  put: (store, key, value) => storageRequest(store, 'readwrite', (table) => table.put(value, key)),
  delete: (store, key) => storageRequest(store, 'readwrite', (table) => table.delete(key)),
  all: (store) => storageRequest(store, 'readonly', (table) => table.getAll()),
};

export const SNAPSHOT_SCHEMA = 1;
export const MAX_SAVED_QUERIES = 240;
export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
export const OFFLINE_ACCESS_MS = 12 * 60 * 60 * 1000;

export function accountScope(auth) {
  return JSON.stringify([
    auth?.user?._id ?? 'guest', auth?.user?.role ?? 'public',
    auth?.user?.tenantId?._id ?? auth?.user?.tenantId ?? null,
    auth?.store?._id ?? auth?.store?.slug ?? null,
    [...(auth?.user?.permissions ?? [])].sort(), auth?.user?.isActive ?? true,
  ]);
}

export function canSaveQuery(query, auth) {
  if (query.data === undefined || !query.fulfilledTimeStamp || ['getMe', 'getSyncRevision'].includes(query.endpointName)) return false;
  // Guest tracking is authorized by a tab-scoped secret; never persist it as public catalog data.
  if (!auth.user && !['getStorefrontInfo', 'getPublicProducts', 'getPublicProduct', 'getPublicCategories', 'getCartProducts'].includes(query.endpointName)) return false;
  const status = query.error?.status;
  return !(typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status));
}

export function businessSnapshot(state) {
  const queries = {};
  let bytes = 0;
  for (const [key, query] of Object.entries(state.api.queries)
    .filter(([, value]) => canSaveQuery(value, state.auth))
    .sort((a, b) => b[1].fulfilledTimeStamp - a[1].fulfilledTimeStamp)) {
    const saved = {
      endpointName: query.endpointName, originalArgs: query.originalArgs,
      data: query.data, fulfilledTimeStamp: query.fulfilledTimeStamp,
      requestId: query.requestId, status: 'fulfilled',
    };
    const size = JSON.stringify(saved).length * 2;
    if (Object.keys(queries).length >= MAX_SAVED_QUERIES || bytes + size > MAX_SNAPSHOT_BYTES) continue;
    queries[key] = saved;
    bytes += size;
  }
  // Retain tag indexes only for retained queries. No mutations, credentials or headers.
  const provided = JSON.parse(JSON.stringify(state.api.provided));
  if (provided.tags) {
    for (const ids of Object.values(provided.tags)) {
      for (const id of Object.keys(ids)) ids[id] = ids[id].filter((key) => queries[key]);
    }
    if (provided.keys) for (const key of Object.keys(provided.keys)) if (!queries[key]) delete provided.keys[key];
  }
  const omitted = Object.values(state.api.queries).filter((query) => canSaveQuery(query, state.auth)).length - Object.keys(queries).length;
  return { schema: SNAPSHOT_SCHEMA, queries, provided, mutations: {}, omitted };
}
