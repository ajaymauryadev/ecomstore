import { baseApi } from '../../api/baseApi';

const offersApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getOffers: builder.query({
      query: (params = {}) => ({ url: '/offers', params }),
      providesTags: [{ type: 'Offer', id: 'LIST' }],
    }),
    createOffer: builder.mutation({
      query: (body) => ({ url: '/offers', method: 'POST', body }),
      invalidatesTags: [{ type: 'Offer', id: 'LIST' }],
    }),
    updateOffer: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/offers/${id}`, method: 'PUT', body }),
      invalidatesTags: [{ type: 'Offer', id: 'LIST' }],
    }),
    deleteOffer: builder.mutation({
      query: (id) => ({ url: `/offers/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Offer', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetOffersQuery,
  useCreateOfferMutation,
  useUpdateOfferMutation,
  useDeleteOfferMutation,
} = offersApi;
