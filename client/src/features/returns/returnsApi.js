import { baseApi } from '../../api/baseApi';
import { orderViewTags, soldProductIds, stockViewTags } from '../../api/workspaceTags';

export const returnsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createReturn: builder.mutation({
      query: (body) => ({ url: '/returns', method: 'POST', body }),
      invalidatesTags: [{ type: 'Return', id: 'LIST' }, { type: 'Return', id: 'STATS' }],
    }),

    processReturn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/returns/${id}/process`, method: 'POST', body }),
      invalidatesTags: (result, error, { id }) => {
        const processed = result?.data?.return;
        if (!processed) return [];
        return [
          { type: 'Return', id: 'LIST' },
          { type: 'Return', id },
          { type: 'Return', id: 'STATS' },
          ...(processed.status === 'processed' ? [
            ...orderViewTags(processed.orderId),
            ...stockViewTags(soldProductIds([...(processed.items ?? []), ...(processed.exchangeItems ?? [])])),
          ] : []),
          ...(processed.status === 'processed' && processed.type === 'purchase_return' && processed.adjustSupplierBalance
            ? [{ type: 'Supplier' }, { type: 'Purchase' }]
            : []),
        ];
      },
    }),

    getReturns: builder.query({
      query: (params) => ({ url: '/returns', params }),
      providesTags: [{ type: 'Return', id: 'LIST' }],
    }),

    getReturn: builder.query({
      query: (id) => `/returns/${id}`,
      providesTags: (r, e, id) => [{ type: 'Return', id }],
    }),

    getReturnStats: builder.query({
      query: (params) => ({ url: '/returns/stats', params }),
      providesTags: [{ type: 'Return', id: 'STATS' }],
    }),
  }),
});

export const {
  useCreateReturnMutation,
  useProcessReturnMutation,
  useGetReturnsQuery,
  useGetReturnQuery,
  useGetReturnStatsQuery,
} = returnsApi;
