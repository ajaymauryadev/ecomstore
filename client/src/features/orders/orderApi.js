import { baseApi } from '../../api/baseApi';
import { orderViewTags, soldProductIds, stockViewTags } from '../../api/workspaceTags';
import { getGuestOrderToken } from '../../utils/guestOrderAccess';

async function syncAssignment({ slug, orderId }, { dispatch, getState, queryFulfilled }) {
  try {
    const { data } = await queryFulfilled;
    const saved = data?.data?.order;
    if (!saved) return;
    const apply = (order) => {
      for (const field of ['assignedTo', 'deliveryAssignedTo', 'fulfillment', 'timeline', 'updatedAt']) {
        if (Object.hasOwn(saved, field)) order[field] = saved[field];
      }
    };
    dispatch(orderApi.util.updateQueryData('getAdminOrder', { slug, orderId }, (draft) => {
      if (draft.data?.order) apply(draft.data.order);
    }));
    for (const args of orderApi.util.selectCachedArgsForQuery(getState(), 'getAdminOrders')) {
      if (args.slug === slug) dispatch(orderApi.util.updateQueryData('getAdminOrders', args, (draft) => {
        const order = draft.data?.find((entry) => entry._id === orderId);
        if (order) apply(order);
      }));
    }
  } catch { /* Existing mutation error UI handles failed assignments. */ }
}

export const orderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminOrderPayments: builder.query({
      query: ({ slug, orderId, ...params }) => ({ url: `/storefront/${slug}/admin/orders/${orderId}/payments`, params }),
      providesTags: (r, e, { orderId }) => [{ type: 'Order', id: `payments-${orderId}` }, { type: 'Udhar', id: 'PAYMENTS' }],
    }),
    /* ── Customer ─────────────────────────── */
    createOrder: builder.mutation({
      query: ({ slug, idempotencyKey, ...body }) => ({
        url: `/storefront/${slug}/orders`,
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body,
        timeout: 30000,
      }),
      invalidatesTags: (result, error, { items }) => error ? [] : [
        ...orderViewTags(result?.data?.order?._id), ...stockViewTags(soldProductIds(items)),
      ],
    }),

    getOrders: builder.query({
      query: ({ slug, ...params }) => ({ url: `/storefront/${slug}/orders`, params }),
      providesTags: [{ type: 'Order', id: 'LIST' }],
    }),

    getOrder: builder.query({
      query: ({ slug, orderId }) => ({
        url: `/storefront/${slug}/orders/${orderId}`,
        headers: getGuestOrderToken(slug, orderId)
          ? { 'x-order-access-token': getGuestOrderToken(slug, orderId) }
          : undefined,
      }),
      providesTags: (result, error, { orderId }) => [{ type: 'Order', id: orderId }],
    }),

    cancelOrder: builder.mutation({
      query: ({ slug, orderId, reason }) => ({
        url: `/storefront/${slug}/orders/${orderId}/cancel`,
        method: 'POST',
        body: { reason },
        headers: getGuestOrderToken(slug, orderId)
          ? { 'x-order-access-token': getGuestOrderToken(slug, orderId) }
          : undefined,
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : [
        ...orderViewTags(orderId), ...stockViewTags(soldProductIds(result?.data?.order?.items)),
      ],
    }),

    submitPaymentProof: builder.mutation({
      query: ({ slug, orderId, formData }) => ({
        url: `/storefront/${slug}/orders/${orderId}/payment/proof`,
        method: 'POST',
        body: formData,
        headers: getGuestOrderToken(slug, orderId)
          ? { 'x-order-access-token': getGuestOrderToken(slug, orderId) }
          : undefined,
        // Don't set Content-Type — browser sets multipart/form-data with boundary
        formData: true,
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),

    validateCoupon: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/storefront/${slug}/coupon/validate`, method: 'POST', body }),
    }),

    /* ── Admin ──────────────────────────────── */
    getAdminOrders: builder.query({
      query: ({ slug, ...params }) => ({ url: `/storefront/${slug}/admin/orders`, params }),
      providesTags: [{ type: 'Order', id: 'ADMIN_LIST' }],
    }),

    getAdminOrder: builder.query({
      query: ({ slug, orderId }) => `/storefront/${slug}/admin/orders/${orderId}`,
      providesTags: (result, error, { orderId }) => [{ type: 'Order', id: `admin-${orderId}` }, { type: 'Udhar', id: 'PAYMENTS' }],
    }),

    getPaymentQueue: builder.query({
      query: ({ slug, ...params }) => ({ url: `/storefront/${slug}/admin/orders/payment-queue`, params }),
      providesTags: [{ type: 'Order', id: 'PAYMENT_QUEUE' }],
    }),

    updateOrderStatus: builder.mutation({
      query: ({ slug, orderId, ...body }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/status`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),

    adminCancelOrder: builder.mutation({
      query: ({ slug, orderId, reason }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/cancel`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : [
        ...orderViewTags(orderId), ...stockViewTags(soldProductIds(result?.data?.order?.items)),
      ],
    }),

    rejectOrder: builder.mutation({
      query: ({ slug, orderId, reason }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/reject`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : [
        ...orderViewTags(orderId), ...stockViewTags(soldProductIds(result?.data?.order?.items)),
      ],
    }),

    verifyPayment: builder.mutation({
      query: ({ slug, orderId, action, reason }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/payment/verify`,
        method: 'POST',
        body: { action, reason },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),

    partialFulfillOrder: builder.mutation({
      query: ({ slug, orderId, fulfilledItems, reason }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/partial`,
        method: 'POST',
        body: { fulfilledItems, reason },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : [
        ...orderViewTags(orderId), ...stockViewTags(soldProductIds(result?.data?.order?.items)),
      ],
    }),

    assignStaff: builder.mutation({
      onQueryStarted: syncAssignment,
      query: ({ slug, orderId, staffId }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/assign`,
        method: 'PATCH',
        body: { staffId },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),
    assignDelivery: builder.mutation({
      onQueryStarted: syncAssignment,
      query: ({ slug, orderId, deliveryId }) => ({
        url: `/storefront/${slug}/admin/orders/${orderId}/assign-delivery`,
        method: 'PATCH',
        body: { deliveryId },
      }),
      invalidatesTags: (result, error, { orderId }) => error ? [] : orderViewTags(orderId),
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetAdminOrderPaymentsQuery,
  useCreateOrderMutation,
  useGetOrdersQuery,
  useGetOrderQuery,
  useCancelOrderMutation,
  useSubmitPaymentProofMutation,
  useValidateCouponMutation,
  useGetAdminOrdersQuery,
  useGetAdminOrderQuery,
  useGetPaymentQueueQuery,
  useUpdateOrderStatusMutation,
  useAdminCancelOrderMutation,
  useRejectOrderMutation,
  useVerifyPaymentMutation,
  usePartialFulfillOrderMutation,
  useAssignStaffMutation,
  useAssignDeliveryMutation,
} = orderApi;
