import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { setCredentials, clearCredentials, selectSessionEpoch } from '../features/auth/authSlice';

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
  const { rateLimitScope, retryAt } = normalized.error?.data ?? {};
  if (normalized.error?.status === 429 && retryAt && ['public', 'business'].includes(rateLimitScope)) {
    session.trafficCooldown = normalized;
  }
  return normalized;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  keepUnusedDataFor: 300,
  refetchOnMountOrArgChange: 30,
  refetchOnFocus: false,
  refetchOnReconnect: true,
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
  endpoints: () => ({}),
});
