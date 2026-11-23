import { baseApi } from '../../api/baseApi';

export const customerApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    customerRegister: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/storefront/${slug}/auth/register`, method: 'POST', body }),
    }),

    customerLogin: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/storefront/${slug}/auth/login`, method: 'POST', body }),
    }),

    getCustomerProfile: builder.query({
      query: (slug) => `/storefront/${slug}/customer/profile`,
      providesTags: ['CustomerProfile'],
    }),

    updateCustomerProfile: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/storefront/${slug}/customer/profile`, method: 'PUT', body }),
      invalidatesTags: ['CustomerProfile'],
    }),

    saveAddress: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/storefront/${slug}/customer/addresses`, method: 'POST', body }),
      invalidatesTags: ['CustomerProfile'],
    }),

    deleteAddress: builder.mutation({
      query: ({ slug, addressId }) => ({ url: `/storefront/${slug}/customer/addresses/${addressId}`, method: 'DELETE' }),
      invalidatesTags: ['CustomerProfile'],
    }),

    toggleFavorite: builder.mutation({
      query: ({ slug, productId }) => ({ url: `/storefront/${slug}/customer/favorites`, method: 'POST', body: { productId } }),
      invalidatesTags: ['CustomerProfile', 'Favorites'],
    }),

    getFavorites: builder.query({
      query: (slug) => `/storefront/${slug}/customer/favorites`,
      providesTags: ['Favorites'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useCustomerRegisterMutation,
  useCustomerLoginMutation,
  useGetCustomerProfileQuery,
  useUpdateCustomerProfileMutation,
  useSaveAddressMutation,
  useDeleteAddressMutation,
  useToggleFavoriteMutation,
  useGetFavoritesQuery,
} = customerApi;
