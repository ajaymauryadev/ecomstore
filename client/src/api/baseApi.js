import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { setCredentials, clearCredentials, selectSessionEpoch } from '../features/auth/authSlice';
import { savedDataStatus, HYDRATE_SAVED_DATA } from '../offline/savedDataSlice';
import { useQueryReadState } from '../offline/ReadStateContext';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

const baseQuery = fetchBaseQuery({
  baseUrl: API_URL,
  credentials: 'include',
  cache: 'no-store',
  timeout: 15000,
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.accessToken;
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  },
});

const sessions = new WeakMap();
const staleSession = () => ({ error: { status: 'CUSTOM_ERROR', data: { message: 'The session changed. Reopen this view.' } } });

const requestUrl = (args) => typeof args === 'string' ? args : args?.url;
const isSessionEndpoint = (args) => /^\/auth\/(login|register|refresh|logout)$/.test(requestUrl(args) || '');

// Another tab may have rotated the shared cookie while this request was in flight.
// Retry only refresh, after the winning response has had time to set its cookie.
const refreshQuery = async (args, api, extraOptions, isCurrent) => {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await baseQuery(args, api, extraOptions);
    if (!isCurrent()) return staleSession();
    if (result.error?.status !== 409) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return result;
};

function rateLimitError(result, retryAt) {
  const data = typeof result.error.data === 'object' && result.error.data ? result.error.data : {};
  const message = data?.rateLimitMessage ?? data?.message ?? 'Too many requests.';
  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  return {
    ...result,
    error: {
      status: 429,
      data: {
        ...data,
        rateLimitMessage: message,
        message: seconds > 0 ? `${message} Try again in ${seconds} second${seconds === 1 ? '' : 's'}.` : message,
        ...(retryAt && { retryAt }),
      },
    },
  };
}

const normalizeApiError = (result) => {
  if (result?.error?.status === 429 || result?.error?.originalStatus === 429) {
    const header = result.meta?.response?.headers.get('Retry-After');
    const bodySeconds = result.error.data?.retryAfterSeconds;
    const now = Date.now();
    const headerAt = /^\d+$/.test(header ?? '') ? now + Number(header) * 1000 : Date.parse(header);
    const bodyAt = Number.isFinite(bodySeconds) && bodySeconds >= 0 ? now + bodySeconds * 1000 : null;
    return rateLimitError(result, Number.isFinite(headerAt) ? headerAt : bodyAt);
  }
  if (!result?.error || result.error.data?.message) return result;
  const message = result.error.status === 'FETCH_ERROR'
    ? 'Unable to reach the server. Check your connection and try again.'
    : result.error.status === 'TIMEOUT_ERROR'
      ? 'The server took too long to respond. Please try again.'
      : 'The request could not be completed.';
  return { ...result, error: { ...result.error, data: { message } } };
};

const baseQueryWithReauth = async (args, api, extraOptions) => {
  const epoch = selectSessionEpoch(api.getState());
  const isCurrent = () => epoch === selectSessionEpoch(api.getState());
  const { accessToken } = api.getState().auth;
  let session = sessions.get(api.getState);
  if (session?.epoch !== epoch) {
    session = { epoch };
    sessions.set(api.getState, session);
  }
  const sessionEndpoint = isSessionEndpoint(args);
  if (/\/auth\/(login|register)$/.test(requestUrl(args) || '') && api.getState().savedData?.logoutPending) {
    return { error: { status: 409, data: { message: 'Finishing the previous sign-out. Connect online and try again shortly.' } } };
  }
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) ||
      (!sessionEndpoint && api.getState().auth.offlineSession && !accessToken)) {
    return { error: { status: 'FETCH_ERROR', data: { message: api.type === 'mutation'
      ? 'An online connection and server confirmation are required. Your draft has not been submitted.'
      : 'Connect to the internet to download this data.' } } };
  }
  const { trafficCooldown, refreshCooldown } = session;
  if (!sessionEndpoint && trafficCooldown?.error.data.retryAt > Date.now()) {
    return rateLimitError(trafficCooldown, trafficCooldown.error.data.retryAt);
  }
  if (!sessionEndpoint && refreshCooldown && refreshCooldown.token === accessToken &&
      refreshCooldown.result.error.data.retryAt > Date.now()) {
    return rateLimitError(refreshCooldown.result, refreshCooldown.result.error.data.retryAt);
  }

  let result = requestUrl(args) === '/auth/refresh'
    ? await refreshQuery(args, api, extraOptions, isCurrent)
    : await baseQuery(args, api, extraOptions);
  if (!isCurrent()) return staleSession();

  if (result?.error?.status === 401 && accessToken && !sessionEndpoint) {
    const currentToken = api.getState().auth.accessToken;
    if (currentToken && currentToken !== accessToken) {
      result = await baseQuery(args, api, extraOptions);
    } else {
      const cooldown = session.refreshCooldown;
      if (cooldown?.result.error.data.retryAt > Date.now()) {
        return rateLimitError(cooldown.result, cooldown.result.error.data.retryAt);
      }
      session.refreshPromise ??= (async () => {
        const response = normalizeApiError(await refreshQuery(
          { url: '/auth/refresh', method: 'POST' },
          api,
          extraOptions,
          isCurrent
        ));
        if (!isCurrent()) return staleSession();
        if (response?.data?.data) {
          api.dispatch(setCredentials(response.data.data));
          session.refreshCooldown = null;
        } else if (response?.error?.status === 429) {
          session.refreshCooldown = { token: accessToken, result: response };
        } else if ([401, 403].includes(response?.error?.status)) {
          api.dispatch(clearCredentials());
        }
        return response;
      })().finally(() => { session.refreshPromise = null; });
      const refreshResult = await session.refreshPromise;
      if (!isCurrent()) return staleSession();
      if (!refreshResult?.data?.data) return refreshResult;
      result = await baseQuery(args, api, extraOptions);
    }
  }

  if (!isCurrent()) return staleSession();
  const normalized = normalizeApiError(result);
  api.dispatch(savedDataStatus({ serverUnavailable: ['FETCH_ERROR', 'TIMEOUT_ERROR', 502, 503, 504].includes(normalized.error?.status) }));
  // A permission denial applies to this request, not the user's login. Rejected
  // snapshots are excluded by the query hooks and offline persistence below.
  if (normalized.error?.status === 401 && !sessionEndpoint) {
    api.dispatch(clearCredentials());
    return normalized;
  }
  const { rateLimitScope, retryAt } = normalized.error?.data ?? {};
  if (normalized.error?.status === 429 && retryAt && ['public', 'business'].includes(rateLimitScope)) {
    session.trafficCooldown = normalized;
  }
  return normalized;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  keepUnusedDataFor: Infinity,
  refetchOnMountOrArgChange: false,
  refetchOnFocus: false,
  refetchOnReconnect: false,
  extractRehydrationInfo: (action) => action.type === HYDRATE_SAVED_DATA ? action.payload : undefined,
  tagTypes: [
    'CurrentUser',
    'Store',
    'Product',
    'Category',
    'Order',
    'Inventory',
    'Staff',
    'Transaction',
    'Supplier',
    'Purchase',
    'StockLedger',
    'CustomerProfile',
    'Favorites',
    'Coupon',
    'Packing',
    'POS',
    'DailyClosing',
    'Return',
    'Udhar',
    'Expense',
    'Salary',
    'Reports',
    'Notification',
    'Offer',
    'Plan',
    'SuperAdmin',
    'AuditLog',
    'Dashboard',
    'Delivery',
  ],
  endpoints: (builder) => ({
    getSyncRevision: builder.query({
      query: (slug) => slug ? `/storefront/${slug}/sync-revision` : '/sync/revision',
    }),
  }),
});

// Normalize every injected query hook, including lazy-loaded role modules. A hook's
// `data` may otherwise belong to its previous arguments (a different report date,
// product or page). `currentData` is the result for this exact cache key.
const injectEndpoints = baseApi.injectEndpoints.bind(baseApi);
const wrappedHooks = new Set();
export const savedEndpointDefinitions = new Map();
baseApi.injectEndpoints = (options) => {
  const api = injectEndpoints({ ...options, endpoints: (builder) => {
    const definitions = options.endpoints(builder);
    for (const [name, definition] of Object.entries(definitions)) savedEndpointDefinitions.set(name, definition);
    return definitions;
  } });
  for (const [name, endpoint] of Object.entries(api.endpoints)) {
    if (!endpoint.useQuery || wrappedHooks.has(name)) continue;
    wrappedHooks.add(name);
    const useQuery = endpoint.useQuery;
    const useSavedQuery = (...args) => {
      const result = useQuery(...args);
      useQueryReadState(result);
      if (args[1]?.selectFromResult) return result;
      const status = result.error?.status;
      const rejected = typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status);
      const saved = rejected ? undefined : result.currentData;
      return {
        ...result, data: saved, currentData: saved,
        isError: result.isError && saved === undefined,
        // Error details stay available to the persistent status notice/retry UI.
        isLoading: saved === undefined && (result.isLoading || result.isFetching),
      };
    };
    endpoint.useQuery = useSavedQuery;
    api[`use${name[0].toUpperCase()}${name.slice(1)}Query`] = useSavedQuery;
  }
  return api;
};
