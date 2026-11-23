import { baseApi } from '../../api/baseApi';

const closingTags = (_result, error, { date, id }) => error ? [] : [
  { type: 'DailyClosing', id: 'LIST' },
  { type: 'DailyClosing', id: `summary-${date}` },
  ...(id ? [{ type: 'DailyClosing', id }] : []),
];

export const dailyClosingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDailySummary: builder.query({
      query: (params) => ({ url: '/daily-closing/summary', params }),
      providesTags: (r, e, { date }) => [{ type: 'DailyClosing', id: `summary-${date}` }],
    }),

    saveDailyClosing: builder.mutation({
      query: (body) => ({ url: '/daily-closing', method: 'POST', body }),
      invalidatesTags: closingTags,
    }),

    finalizeDailyClosing: builder.mutation({
      query: ({ id, version }) => ({ url: `/daily-closing/${id}/finalize`, method: 'POST', body: { version } }),
      invalidatesTags: closingTags,
    }),

    correctDailyClosing: builder.mutation({
      query: ({ id, date: _date, ...body }) => ({ url: `/daily-closing/${id}/corrections`, method: 'POST', body }),
      invalidatesTags: closingTags,
    }),

    getDailyClosings: builder.query({
      query: (params) => ({ url: '/daily-closing', params }),
      providesTags: [{ type: 'DailyClosing', id: 'LIST' }],
    }),

    getDailyClosing: builder.query({
      query: (id) => `/daily-closing/${id}`,
      providesTags: (r, e, id) => [{ type: 'DailyClosing', id }],
    }),
  }),
});

export const {
  useGetDailySummaryQuery,
  useSaveDailyClosingMutation,
  useFinalizeDailyClosingMutation,
  useCorrectDailyClosingMutation,
  useGetDailyClosingsQuery,
  useGetDailyClosingQuery,
} = dailyClosingApi;
