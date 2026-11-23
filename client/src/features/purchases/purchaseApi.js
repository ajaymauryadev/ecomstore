import { baseApi } from '../../api/baseApi';
import { soldProductIds, stockViewTags } from '../../api/workspaceTags';

export const purchaseApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPurchases: builder.query({
      query: (params = {}) => ({ url: '/purchases', params }),
      providesTags: (result) =>
        result?.data?.purchases
          ? [
              ...result.data.purchases.map(({ _id }) => ({ type: 'Purchase', id: _id })),
              { type: 'Purchase', id: 'LIST' },
            ]
          : [{ type: 'Purchase', id: 'LIST' }],
    }),

    getPurchase: builder.query({
      query: (id) => `/purchases/${id}`,
      providesTags: (result, error, id) => [{ type: 'Purchase', id }],
    }),

    getPurchaseStats: builder.query({
      query: (params = {}) => ({ url: '/purchases/stats', params }),
      providesTags: [{ type: 'Purchase', id: 'STATS' }],
    }),

    createPurchase: builder.mutation({
      query: (body) => ({ url: '/purchases', method: 'POST', body }),
      invalidatesTags: (result, error, { items }) => error ? [] : [
        { type: 'Purchase', id: 'LIST' },
        { type: 'Purchase', id: 'STATS' },
        ...stockViewTags(soldProductIds(items)),
        { type: 'Supplier' },
      ],
    }),

    recordPurchasePayment: builder.mutation({
      query: ({ id, idempotencyKey, ...body }) => ({
        url: `/purchases/${id}/payment`, method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body, timeout: 30000,
      }),
      invalidatesTags: (result, error, { id }) => result ? [
        { type: 'Purchase', id },
        { type: 'Purchase', id: 'LIST' },
        { type: 'Purchase', id: 'STATS' },
        { type: 'Supplier' },
      ] : [],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetPurchasesQuery,
  useGetPurchaseQuery,
  useGetPurchaseStatsQuery,
  useCreatePurchaseMutation,
  useRecordPurchasePaymentMutation,
} = purchaseApi;
