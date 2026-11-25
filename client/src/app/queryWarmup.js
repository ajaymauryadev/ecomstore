import { baseApi } from '../api/baseApi';

export const queriesSettled = (store) => {
  const state = store.getState()[baseApi.reducerPath];
  return ![...Object.values(state?.queries ?? {}), ...Object.values(state?.mutations ?? {})]
    .some((request) => request.status === 'pending');
};

export function prefetchQuery(store, endpoint, args) {
  const query = baseApi.endpoints[endpoint];
  if (!query) return;
  const cached = query.select(args)(store.getState());
  if (cached.status === 'pending' || (cached.fulfilledTimeStamp && Date.now() - cached.fulfilledTimeStamp < 30000)) return;
  // No persistent subscription: unused pages expire normally in RTK Query.
  return store.dispatch(query.initiate(args, { subscribe: false, forceRefetch: true }));
}
