import { savedStorage } from './storage';

// Confirmation intents, not booked sales/collections. Replay is explicitly manual
// because stock, prices, balances, permissions and payment outcomes need review.
export const outboxMemory = new Map();
export const outboxKey = (account, scope) => JSON.stringify([account, scope]);
export async function loadOutbox() {
  for (const record of await savedStorage.all('outbox')) outboxMemory.set(record.id, record);
}
export async function saveIntent(record) {
  await savedStorage.put('outbox', record.id, record);
  outboxMemory.set(record.id, record);
  window.dispatchEvent(new Event('saved-outbox-changed'));
}
export async function removeIntent(id) {
  await savedStorage.delete('outbox', id);
  outboxMemory.delete(id);
  window.dispatchEvent(new Event('saved-outbox-changed'));
}
