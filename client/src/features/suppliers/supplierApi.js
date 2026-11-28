import { baseApi } from '../../api/baseApi';

export const supplierApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSuppliers: builder.query({
      query: (params = {}) => ({ url: '/suppliers', params }),
      providesTags: (result) =>
        result?.data?.suppliers
          ? [
              ...result.data.suppliers.map(({ _id }) => ({ type: 'Supplier', id: _id })),
              { type: 'Supplier', id: 'LIST' },
            ]
          : [{ type: 'Supplier', id: 'LIST' }],
    }),

    getSupplierReconciliation: builder.query({
      query: (params) => ({ url: '/suppliers/reconciliation', params }),
      providesTags: [{ type: 'Supplier', id: 'RECONCILIATION' }],
    }),
    getSupplier: builder.query({
      query: (id) => `/suppliers/${id}`,
      providesTags: (result, error, id) => [{ type: 'Supplier', id }],
    }),

    createSupplier: builder.mutation({
      query: (body) => ({ url: '/suppliers', method: 'POST', body }),
      invalidatesTags: [{ type: 'Supplier', id: 'LIST' }],
    }),

    updateSupplier: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/suppliers/${id}`, method: 'PUT', body }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Supplier', id }, { type: 'Supplier', id: 'LIST' }],
    }),

    deleteSupplier: builder.mutation({
      query: (id) => ({ url: `/suppliers/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Supplier', id: 'LIST' }],
    }),

    recordSupplierPayment: builder.mutation({
      query: ({ id, idempotencyKey, ...body }) => ({
        url: `/suppliers/${id}/payment`, method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body, timeout: 30000,
      }),
      invalidatesTags: (result, error, { id }) => result ? [
        'DailyClosing',
        { type: 'Supplier', id }, { type: 'Supplier', id: 'LIST' }, { type: 'Supplier', id: 'RECONCILIATION' },
        { type: 'Purchase', id: 'LIST' }, { type: 'Purchase', id: 'STATS' },
        ...result.data.payment.allocations.map(({ purchaseId }) => ({ type: 'Purchase', id: purchaseId })),
      ] : [],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetSuppliersQuery,
  useGetSupplierReconciliationQuery,
  useGetSupplierQuery,
  useCreateSupplierMutation,
  useUpdateSupplierMutation,
  useDeleteSupplierMutation,
  useRecordSupplierPaymentMutation,
} = supplierApi;
