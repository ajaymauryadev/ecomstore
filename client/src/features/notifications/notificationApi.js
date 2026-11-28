import { baseApi } from '../../api/baseApi';
import { notificationBelongsTo } from '../../utils/notificationAudience';
import { selectSessionEpoch } from '../auth/authSlice';

// Render a persisted socket event immediately; the coalesced background read
// still reconciles totals, pagination and changes made on another device.
export async function applyNotificationEvent(store, notification, seen) {
  const state = store.getState();
  if (!notificationBelongsTo(state.auth.user, notification) || seen.has(notification._id)) return;
  seen.add(notification._id);
  if (seen.size > 1000) seen.delete(seen.values().next().value);
  const epoch = selectSessionEpoch(state);
  const argsList = baseApi.util.selectCachedArgsForQuery(state, 'getNotifications');
  const known = argsList.some((args) => baseApi.endpoints.getNotifications.select(args)(state).data?.data?.some((entry) => entry._id === notification._id));
  const install = async (endpoint, args, data) => {
    if (selectSessionEpoch(store.getState()) !== epoch) return;
    store.dispatch(baseApi.util.getRunningQueryThunk(endpoint, args))?.abort();
    await store.dispatch(baseApi.util.upsertQueryData(endpoint, args, data));
  };
  const unread = baseApi.endpoints.getUnreadCount.select()(state).data;
  if (!known && !notification.isRead && unread) await install('getUnreadCount', undefined, {
    ...unread, data: { ...unread.data, count: (unread.data?.count ?? 0) + 1 },
  });
  for (const args of argsList) {
    if (selectSessionEpoch(store.getState()) !== epoch) return;
    if ((args?.page ?? 1) !== 1 || (args?.role && args.role !== notification.role) ||
        (args?.type && args.type !== notification.type) ||
        (args?.isRead !== undefined && String(args.isRead) !== String(Boolean(notification.isRead)))) continue;
    const cached = baseApi.endpoints.getNotifications.select(args)(store.getState()).data;
    if (!Array.isArray(cached?.data) || cached.data.some((entry) => entry._id === notification._id)) continue;
    const limit = cached.meta?.limit ?? args?.limit ?? 30;
    const total = (cached.meta?.total ?? cached.data.length) + 1;
    await install('getNotifications', args, { ...cached,
      data: [notification, ...cached.data].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || String(b._id).localeCompare(String(a._id))).slice(0, limit),
      ...(cached.meta && { meta: { ...cached.meta, total, totalPages: Math.ceil(total / limit), hasNextPage: total > limit } }),
    });
  }
}

const notificationApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getNotifications: builder.query({
      query: (params = {}) => ({ url: '/notifications', params }),
      providesTags: [{ type: 'Notification', id: 'LIST' }],
    }),
    getUnreadCount: builder.query({
      query: () => '/notifications/unread-count',
      providesTags: [{ type: 'Notification', id: 'UNREAD' }],
    }),
    markRead: builder.mutation({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'PATCH' }),
      invalidatesTags: [{ type: 'Notification', id: 'LIST' }, { type: 'Notification', id: 'UNREAD' }],
    }),
    markAllRead: builder.mutation({
      query: () => ({ url: '/notifications/mark-all-read', method: 'POST' }),
      invalidatesTags: [{ type: 'Notification', id: 'LIST' }, { type: 'Notification', id: 'UNREAD' }],
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkReadMutation,
  useMarkAllReadMutation,
} = notificationApi;
