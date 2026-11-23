import { baseApi } from '../../api/baseApi';

export const storefrontApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getStorefrontInfo: builder.query({
      query: (slug) => `/storefront/${slug}`,
      providesTags: (result, error, slug) => [{ type: 'Store', id: `sf-${slug}` }],
    }),
  }),
  overrideExisting: false,
});

export const { useGetStorefrontInfoQuery } = storefrontApi;
