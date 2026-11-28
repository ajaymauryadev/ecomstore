import { baseApi } from '../../api/baseApi';

const expenseChanges = (_result, error) => error ? [] : ['Expense', 'DailyClosing'];

export const expenseApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getExpenses: builder.query({
      query: (params) => ({ url: '/expenses', params }),
      providesTags: [{ type: 'Expense', id: 'LIST' }],
    }),
    getExpenseStats: builder.query({
      query: (params) => ({ url: '/expenses/stats', params }),
      providesTags: [{ type: 'Expense', id: 'STATS' }],
    }),
    createExpense: builder.mutation({
      query: (body) => ({ url: '/expenses', method: 'POST', body }),
      invalidatesTags: expenseChanges,
    }),
    updateExpense: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/expenses/${id}`, method: 'PUT', body }),
      invalidatesTags: expenseChanges,
    }),
    deleteExpense: builder.mutation({
      query: (id) => ({ url: `/expenses/${id}`, method: 'DELETE' }),
      invalidatesTags: expenseChanges,
    }),
  }),
});

export const {
  useGetExpensesQuery,
  useGetExpenseStatsQuery,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
  useDeleteExpenseMutation,
} = expenseApi;
