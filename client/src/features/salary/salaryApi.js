import { baseApi } from '../../api/baseApi';

export const salaryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSalaryRecords: builder.query({
      query: (params) => ({ url: '/salary', params }),
      providesTags: [{ type: 'Salary', id: 'LIST' }],
    }),
    getSalaryStats: builder.query({
      query: (params) => ({ url: '/salary/stats', params }),
      providesTags: [{ type: 'Salary', id: 'STATS' }],
    }),
    getStaffList: builder.query({
      query: () => '/salary/staff',
      providesTags: [{ type: 'Salary', id: 'STAFF' }],
    }),
    getStaffSalaryHistory: builder.query({
      query: ({ staffId, ...params }) => ({ url: `/salary/history/${staffId}`, params }),
      providesTags: (r, e, { staffId }) => [{ type: 'Salary', id: `history-${staffId}` }],
    }),
    upsertSalaryRecord: builder.mutation({
      query: (body) => ({ url: '/salary', method: 'POST', body }),
      invalidatesTags: [{ type: 'Salary', id: 'LIST' }, { type: 'Salary', id: 'STATS' }],
    }),
    recordSalaryPayment: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/salary/${id}/payment`, method: 'POST', body }),
      invalidatesTags: (r, e, { id }) => [
        { type: 'Salary', id: 'LIST' },
        { type: 'Salary', id: 'STATS' },
        { type: 'Salary', id },
      ],
    }),
  }),
});

export const {
  useGetSalaryRecordsQuery,
  useGetSalaryStatsQuery,
  useGetStaffListQuery,
  useGetStaffSalaryHistoryQuery,
  useUpsertSalaryRecordMutation,
  useRecordSalaryPaymentMutation,
} = salaryApi;
