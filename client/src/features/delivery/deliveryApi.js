import { baseApi } from '../../api/baseApi';
import { orderViewTags } from '../../api/workspaceTags';

export const deliveryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDeliveryOrders: builder.query({
      query: (params) => ({ url: '/delivery/orders', params }),
      providesTags: [{ type: 'Delivery', id: 'LIST' }],
    }),
    updateDeliveryStatus: builder.mutation({
      query: ({ orderId, status }) => ({
        url: `/delivery/orders/${orderId}/status`, method: 'PATCH', body: { status },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),
  }),
});

export const { useGetDeliveryOrdersQuery, useUpdateDeliveryStatusMutation } = deliveryApi;
