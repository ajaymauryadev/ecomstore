import { baseApi } from '../../api/baseApi';

const couponsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCoupons: builder.query({
      query: (params = {}) => ({ url: '/coupons', params }),
      providesTags: [{ type: 'Coupon', id: 'LIST' }],
    }),
    createCoupon: builder.mutation({
      query: (body) => ({ url: '/coupons', method: 'POST', body }),
      invalidatesTags: [{ type: 'Coupon', id: 'LIST' }],
    }),
    updateCoupon: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/coupons/${id}`, method: 'PUT', body }),
      invalidatesTags: [{ type: 'Coupon', id: 'LIST' }],
    }),
    deleteCoupon: builder.mutation({
      query: (id) => ({ url: `/coupons/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Coupon', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetCouponsQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
} = couponsApi;
