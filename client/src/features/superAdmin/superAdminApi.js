import { baseApi } from '../../api/baseApi';

const superAdminApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSystemStats: builder.query({
      query: () => '/super-admin/stats',
      providesTags: [{ type: 'SuperAdmin', id: 'STATS' }],
    }),
    getSAStores: builder.query({
      query: (params = {}) => ({ url: '/super-admin/stores', params }),
      providesTags: [{ type: 'SuperAdmin', id: 'STORES' }],
    }),
    getStoreDetail: builder.query({
      query: (id) => `/super-admin/stores/${id}`,
      providesTags: (r, e, id) => [{ type: 'SuperAdmin', id }],
    }),
    createStore: builder.mutation({
      query: (body) => ({ url: '/super-admin/stores', method: 'POST', body }),
      invalidatesTags: [{ type: 'SuperAdmin', id: 'STORES' }, { type: 'SuperAdmin', id: 'STATS' }],
    }),
    updateSubscription: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/super-admin/stores/${id}/subscription`, method: 'PATCH', body }),
      invalidatesTags: (r, e, { id }) => [{ type: 'SuperAdmin', id }, { type: 'SuperAdmin', id: 'STORES' }],
    }),
    toggleStoreStatus: builder.mutation({
      query: (id) => ({ url: `/super-admin/stores/${id}/toggle`, method: 'PATCH' }),
      invalidatesTags: (r, e, id) => [{ type: 'SuperAdmin', id }, { type: 'SuperAdmin', id: 'STORES' }],
    }),
    updateModules: builder.mutation({
      query: ({ id, enabledModules }) => ({ url: `/super-admin/stores/${id}/modules`, method: 'PATCH', body: { enabledModules } }),
      invalidatesTags: (r, e, { id }) => [{ type: 'SuperAdmin', id }],
    }),
    updateLimits: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/super-admin/stores/${id}/limits`, method: 'PATCH', body }),
      invalidatesTags: (r, e, { id }) => [{ type: 'SuperAdmin', id }],
    }),
    logSupportAccess: builder.mutation({
      query: ({ id, reason }) => ({ url: `/super-admin/stores/${id}/support-access`, method: 'POST', body: { reason } }),
    }),
    getSupportAccessLogs: builder.query({
      query: (id) => `/super-admin/stores/${id}/support-access`,
    }),
    getSAAuditLogs: builder.query({
      query: (params = {}) => ({ url: '/super-admin/audit-logs', params }),
      providesTags: [{ type: 'AuditLog', id: 'SA_LIST' }],
    }),
  }),
});

export const {
  useGetSystemStatsQuery,
  useGetSAStoresQuery,
  useGetStoreDetailQuery,
  useCreateStoreMutation,
  useUpdateSubscriptionMutation,
  useToggleStoreStatusMutation,
  useUpdateModulesMutation,
  useUpdateLimitsMutation,
  useLogSupportAccessMutation,
  useGetSupportAccessLogsQuery,
  useGetSAAuditLogsQuery,
} = superAdminApi;
