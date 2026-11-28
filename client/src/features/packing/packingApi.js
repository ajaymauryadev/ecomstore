import { baseApi } from '../../api/baseApi';
import { orderViewTags, soldProductIds, stockViewTags } from '../../api/workspaceTags';

export const packingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /* ── Staff ─────────────────────────────────────── */
    getMyPackingOrders: builder.query({
      query: (params) => ({ url: '/packing/my-orders', params }),
      providesTags: [{ type: 'Packing', id: 'MY_ORDERS' }],
    }),

    acceptPackingOrder: builder.mutation({
      query: ({ orderId }) => ({ url: `/packing/orders/${orderId}/accept`, method: 'POST' }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),

    getPackingSession: builder.query({
      query: ({ orderId }) => `/packing/session/${orderId}`,
      providesTags: (result, error, { orderId }) => [{ type: 'Packing', id: orderId }],
    }),

    startPackingSession: builder.mutation({
      query: ({ orderId }) => ({ url: `/packing/session/${orderId}/start`, method: 'POST' }),
      invalidatesTags: (result, error, { orderId }) => [
        { type: 'Packing', id: 'MY_ORDERS' },
        { type: 'Packing', id: orderId },
      ],
    }),

    updateItemStatus: builder.mutation({
      query: ({ orderId, itemId, ...body }) => ({
        url: `/packing/session/${orderId}/item/${itemId}`,
        method: 'PATCH',
        body,
      }),
      // The outbox installs the returned session before clearing its draft.
      // Avoid a redundant GET (and a stale-data gap) for every picked item.
      invalidatesTags: [],
    }),

    suggestReplacement: builder.mutation({
      query: ({ orderId, itemId, ...body }) => ({
        url: `/packing/session/${orderId}/item/${itemId}/replacement`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (result, error, { orderId }) => [{ type: 'Packing', id: orderId }],
    }),

    completePackingSession: builder.mutation({
      query: ({ orderId, ...body }) => ({
        url: `/packing/session/${orderId}/complete`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (result, error, { orderId }) => [
        { type: 'Packing', id: 'MY_ORDERS' },
        { type: 'Packing', id: orderId },
        { type: 'Order', id: 'ADMIN_LIST' },
        { type: 'Packing', id: 'ADMIN_QUEUE' },
      ],
    }),

    /* ── Admin ─────────────────────────────────────── */
    getPackingQueue: builder.query({
      query: (params) => ({ url: '/packing/admin/queue', params }),
      providesTags: [{ type: 'Packing', id: 'ADMIN_QUEUE' }],
    }),

    getStaffPackingSessions: builder.query({
      query: (params) => ({ url: '/packing/admin/sessions', params }),
      providesTags: [{ type: 'Packing', id: 'SESSIONS' }],
    }),

    getAdminPackingSession: builder.query({
      query: ({ sessionId }) => `/packing/admin/session/${sessionId}`,
      providesTags: (result, error, { sessionId }) => [
        { type: 'Packing', id: `session-${sessionId}` },
        ...(result?.data?.session?.orderId ? [{ type: 'Packing', id: result.data.session.orderId }] : []),
      ],
    }),

    verifyPackingSession: builder.mutation({
      query: ({ sessionId, ...body }) => ({
        url: `/packing/admin/session/${sessionId}/verify`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (result, error, { sessionId, action }) => error ? [] : [
        ...orderViewTags(result?.data?.order?._id),
        { type: 'Packing', id: 'SESSIONS' },
        { type: 'Packing', id: `session-${sessionId}` },
        ...(action === 'approve' ? stockViewTags(soldProductIds(result?.data?.order?.items)) : []),
      ],
    }),

    getStaffActivityLogs: builder.query({
      query: (params) => ({ url: '/packing/admin/activity', params }),
      providesTags: [{ type: 'Packing', id: 'ACTIVITY' }],
    }),

    getMissingItemsReport: builder.query({
      query: (params) => ({ url: '/packing/admin/missing-report', params }),
      providesTags: [{ type: 'Packing', id: 'MISSING_REPORT' }],
    }),

    getHighValueAlerts: builder.query({
      query: (params) => ({ url: '/packing/admin/high-value-alerts', params }),
      providesTags: [{ type: 'Packing', id: 'HV_ALERTS' }],
    }),
  }),
});

export const {
  useGetMyPackingOrdersQuery,
  useAcceptPackingOrderMutation,
  useGetPackingSessionQuery,
  useStartPackingSessionMutation,
  useUpdateItemStatusMutation,
  useSuggestReplacementMutation,
  useCompletePackingSessionMutation,
  useGetPackingQueueQuery,
  useGetStaffPackingSessionsQuery,
  useGetAdminPackingSessionQuery,
  useVerifyPackingSessionMutation,
  useGetStaffActivityLogsQuery,
  useGetMissingItemsReportQuery,
  useGetHighValueAlertsQuery,
} = packingApi;
