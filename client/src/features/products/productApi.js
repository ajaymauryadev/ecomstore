import { baseApi } from '../../api/baseApi';
import { stockViewTags } from '../../api/workspaceTags';

export const productApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProducts: builder.query({
      query: (params = {}) => ({ url: '/products', params }),
      providesTags: (result) =>
        result?.data
          ? [
              ...result.data.map(({ _id }) => ({ type: 'Product', id: _id })),
              { type: 'Product', id: 'LIST' },
            ]
          : [{ type: 'Product', id: 'LIST' }],
    }),

    getProduct: builder.query({
      query: (id) => `/products/${id}`,
      providesTags: (result, error, id) => [{ type: 'Product', id }],
    }),

    createProduct: builder.mutation({
      query: (body) => ({ url: '/products', method: 'POST', body }),
      invalidatesTags: (result) => result ? [
        ...stockViewTags(result.data?.product?._id ? [result.data.product._id] : []), { type: 'Category', id: 'LIST' },
      ] : [],
    }),

    importProducts: builder.mutation({
      query: (body) => ({ url: '/products/import', method: 'POST', body, timeout: 60000 }),
      invalidatesTags: (result, error, body) => result && body.get('preview') !== 'true'
        ? [...stockViewTags([]), { type: 'Category', id: 'LIST' }] : [],
    }),

    downloadProductSample: builder.mutation({
      async queryFn(arg, api, extraOptions, baseQuery) {
        const result = await baseQuery({ url: '/products/import/sample', responseHandler: (response) => response.ok ? response.blob() : response.json() });
        if (result.error) return { error: result.error };
        const url = URL.createObjectURL(result.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'product-import-sample.xlsx';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { data: { downloaded: true } };
      },
    }),

    updateProduct: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/products/${id}`, method: 'PUT', body }),
      invalidatesTags: (result, error, { id }) => result ? [
        ...stockViewTags([id]),
        { type: 'Category', id: 'LIST' },
      ] : [],
    }),

    deleteProduct: builder.mutation({
      query: (id) => ({ url: `/products/${id}`, method: 'DELETE' }),
      invalidatesTags: (result, error, id) => error ? [] : [...stockViewTags([id]), { type: 'Category', id: 'LIST' }],
    }),

    toggleProductField: builder.mutation({
      query: ({ id, field }) => ({
        url: `/products/${id}/toggle/${field}`,
        method: 'PATCH',
      }),
      invalidatesTags: (result, error, { id, field }) => error ? [] : [
        ...stockViewTags([id]), ...(field === 'isActive' ? [{ type: 'Category', id: 'LIST' }] : []),
      ],
    }),

    updateVariantStock: builder.mutation({
      query: ({ productId, variantId, stock, operation = 'set' }) => ({
        url: `/products/${productId}/variants/${variantId}/stock`,
        method: 'PATCH',
        body: { stock, operation },
      }),
      invalidatesTags: (result, error, { productId }) => error ? [] : stockViewTags([productId]),
    }),

    getPublicProducts: builder.query({
      query: ({ slug, ...params }) => ({ url: `/storefront/${slug}/products`, params }),
      providesTags: (result, error, { slug }) => [{ type: 'Product', id: `sf-${slug}` }, { type: 'Product', id: 'PUBLIC' }],
    }),

    getPublicProduct: builder.query({
      query: ({ slug, productId }) => `/storefront/${slug}/products/${productId}`,
      providesTags: (result, error, { productId }) => [{ type: 'Product', id: productId }, { type: 'Product', id: 'PUBLIC' }],
    }),

    getCartProducts: builder.mutation({
      query: ({ slug, productIds }) => ({
        url: `/storefront/${slug}/cart/products`,
        method: 'POST',
        body: { productIds },
      }),
    }),

    uploadImage: builder.mutation({
      query: (formData) => ({
        url: '/upload/image',
        method: 'POST',
        body: formData,
      }),
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetProductsQuery,
  useGetProductQuery,
  useCreateProductMutation,
  useImportProductsMutation,
  useDownloadProductSampleMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useToggleProductFieldMutation,
  useUpdateVariantStockMutation,
  useGetPublicProductsQuery,
  useGetPublicProductQuery,
  useUploadImageMutation,
} = productApi;
