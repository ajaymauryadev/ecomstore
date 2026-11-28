import SyncRevision from '../models/SyncRevision.js';

export const revisionScope = (tenantId) => tenantId ? `tenant:${tenantId}` : 'platform';

export function incrementSyncRevision(scope, tags, { session } = {}) {
  const increments = Object.fromEntries(tags.map((tag) => [`versions.${tag}`, 1]));
  return SyncRevision.updateOne({ _id: scope }, { $inc: { revision: 1, ...increments } }, { upsert: true, session });
}

export const recordTenantChange = (tenantId, tags, session) =>
  incrementSyncRevision(revisionScope(tenantId), tags, { session });
