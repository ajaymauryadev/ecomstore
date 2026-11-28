import { baseApi } from '../api/baseApi';

export function changedQueryKeys(state, previous, current) {
  const all = () => Object.keys(state.api.queries).filter((key) => state.api.queries[key].endpointName !== 'getSyncRevision');
  // Once per session, verify saved snapshots whose server version is unknown.
  if (!previous) return all();
  if (!previous.versions || !current?.versions) return previous.revision !== current?.revision ? all() : [];
  const tags = [...new Set([...Object.keys(previous.versions), ...Object.keys(current.versions)])]
    .filter((tag) => (previous.versions[tag] ?? 0) !== (current.versions[tag] ?? 0));
  if (tags.includes('All')) return all();
  return baseApi.util.selectInvalidatedBy(state, tags.map((type) => ({ type }))).map((query) => query.queryCacheKey);
}

export const retryableRead = (query) => query.status === 'rejected' &&
  (typeof query.error?.status !== 'number' || query.error.status >= 500 || [408, 429].includes(query.error.status));
