import { baseApi } from '../../api/baseApi';
import { orderViewTags, soldProductIds, stockViewTags } from '../../api/workspaceTags';

export const posApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createPOSOrder: builder.mutation({
      query: ({ idempotencyKey, ...body }) => ({
        url: '/pos/order',
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body,
        timeout: 30000,
      }),
      invalidatesTags: (result, error, { items }) => error ? [] : [
        ...orderViewTags(result?.data?.order?._id),
        ...stockViewTags(soldProductIds(items)),
        { type: 'POS', id: 'ORDERS' },
        ...(result?.data?.order?.udharCustomerId ? [{ type: 'Udhar' }] : []),
      ],
    }),

    getPOSUdharCustomer: builder.query({
      query: (phone) => ({ url: '/pos/udhar-customer', params: { phone } }),
      providesTags: (result) => [{ type: 'Udhar', id: result?.data?.customer?._id ?? 'LIST' }],
    }),
    getPOSUdharCustomers: builder.query({
      query: (params) => ({ url: '/pos/udhar-customers', params }),
      providesTags: [{ type: 'Udhar', id: 'LIST' }],
    }),

    getPOSOrders: builder.query({
      query: (params) => ({ url: '/pos/orders', params }),
      providesTags: [{ type: 'POS', id: 'ORDERS' }],
    }),
  }),
});

export const { useCreatePOSOrderMutation, useGetPOSUdharCustomerQuery, useGetPOSUdharCustomersQuery, useGetPOSOrdersQuery } = posApi;
