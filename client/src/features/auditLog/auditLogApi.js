import { baseApi } from '../../api/baseApi';

const auditLogApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAuditLogs: builder.query({
      query: (params = {}) => ({ url: '/audit-logs', params }),
      providesTags: [{ type: 'AuditLog', id: 'LIST' }],
    }),
    getAuditStats: builder.query({
      query: () => '/audit-logs/stats',
      providesTags: [{ type: 'AuditLog', id: 'STATS' }],
    }),
  }),
});

export const { useGetAuditLogsQuery, useGetAuditStatsQuery } = auditLogApi;
