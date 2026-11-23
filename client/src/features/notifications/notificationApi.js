import { baseApi } from '../../api/baseApi';

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
