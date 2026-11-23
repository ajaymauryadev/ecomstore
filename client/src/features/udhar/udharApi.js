import { baseApi } from '../../api/baseApi';
import { orderViewTags } from '../../api/workspaceTags';

export const udharApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCustomerBills: builder.query({
      query: ({ id, ...params }) => ({ url: `/udhar/${id}/bills`, params }),
      providesTags: [{ type: 'Udhar', id: 'BILLS' }],
    }),
    getBillPayments: builder.query({
      query: ({ id, orderId, ...params }) => ({ url: `/udhar/${id}/bills/${orderId}/payments`, params }),
      providesTags: [{ type: 'Udhar', id: 'PAYMENTS' }],
    }),
    previewUdharPayment: builder.query({
      query: ({ id, ...params }) => ({ url: `/udhar/${id}/payment-preview`, params }),
      providesTags: [{ type: 'Udhar', id: 'PREVIEW' }],
    }),
    reverseUdharPayment: builder.mutation({
      query: ({ id, entryId, reason }) => ({ url: `/udhar/${id}/payments/${entryId}/reverse`, method: 'POST', body: { reason } }),
      invalidatesTags: (r, e) => e ? [] : [{ type: 'Udhar' }, ...orderViewTags()],
    }),
    getLegacyCreditBills: builder.query({
      query: (params) => ({ url: '/udhar/legacy-credit-bills', params }),
      providesTags: [{ type: 'Udhar', id: 'LEGACY_CREDIT_BILLS' }],
    }),
    getUdharCustomers: builder.query({
      query: (params) => ({ url: '/udhar', params }),
      providesTags: [{ type: 'Udhar', id: 'LIST' }],
    }),
    getUdharStats: builder.query({
      query: () => '/udhar/stats',
      providesTags: [{ type: 'Udhar', id: 'STATS' }],
    }),
    getUdharDues: builder.query({
      query: (params) => ({ url: '/udhar/dues', params }),
      providesTags: [{ type: 'Udhar', id: 'DUES' }],
    }),
    createUdharCustomer: builder.mutation({
      query: (body) => ({ url: '/udhar', method: 'POST', body }),
      invalidatesTags: [{ type: 'Udhar', id: 'LIST' }, { type: 'Udhar', id: 'STATS' }, { type: 'Reports', id: 'sales-overview' }],
    }),
    updateUdharCustomer: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/udhar/${id}`, method: 'PUT', body }),
      invalidatesTags: (r, e, { id }) => [
        { type: 'Udhar', id: 'LIST' },
        { type: 'Udhar', id },
        { type: 'Udhar', id: `ledger-${id}` },
        { type: 'Udhar', id: 'STATS' },
        { type: 'Udhar', id: 'DUES' },
        { type: 'Reports', id: 'sales-overview' },
      ],
    }),
    getCustomerLedger: builder.query({
      query: ({ id, ...params }) => ({ url: `/udhar/${id}/ledger`, params }),
      providesTags: (r, e, { id }) => [{ type: 'Udhar', id: `ledger-${id}` }],
    }),
    addUdharDebit: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/udhar/${id}/debit`, method: 'POST', body }),
      invalidatesTags: (r, e, { id }) => [
        { type: 'Udhar', id: 'LIST' },
        { type: 'Udhar', id: 'STATS' },
        { type: 'Udhar', id: 'DUES' },
        { type: 'Udhar', id: `ledger-${id}` },
        { type: 'Reports', id: 'sales-overview' },
      ],
    }),
    addUdharCredit: builder.mutation({
      query: ({ id, idempotencyKey, ...body }) => ({ url: `/udhar/${id}/credit`, method: 'POST', body,
        headers: { 'Idempotency-Key': idempotencyKey }, timeout: 30000 }),
      invalidatesTags: (r, e, { id }) => e ? [] : [
        ...orderViewTags(), { type: 'Udhar', id: 'PAYMENTS' }, { type: 'Udhar', id: 'PREVIEW' }, { type: 'Udhar', id: 'BILLS' },
        { type: 'Udhar', id: 'LIST' },
        { type: 'Udhar', id: 'STATS' },
        { type: 'Udhar', id: 'DUES' },
        { type: 'Udhar', id: `ledger-${id}` },
        { type: 'Reports', id: 'sales-overview' },
      ],
    }),
  }),
});

export const {
  useGetCustomerBillsQuery,
  useGetBillPaymentsQuery,
  usePreviewUdharPaymentQuery,
  useReverseUdharPaymentMutation,
  useGetUdharCustomersQuery,
  useGetLegacyCreditBillsQuery,
  useGetUdharStatsQuery,
  useGetUdharDuesQuery,
  useCreateUdharCustomerMutation,
  useUpdateUdharCustomerMutation,
  useGetCustomerLedgerQuery,
  useAddUdharDebitMutation,
  useAddUdharCreditMutation,
} = udharApi;
