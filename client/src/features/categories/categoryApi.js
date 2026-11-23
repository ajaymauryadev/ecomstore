import { baseApi } from '../../api/baseApi';

const categoryLists = [{ type: 'Category', id: 'LIST' }, { type: 'Category', id: 'PUBLIC' }];

export const categoryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCategories: builder.query({
      query: () => '/categories',
      providesTags: (result) =>
        result?.data?.categories
          ? [
              ...result.data.categories.map(({ _id }) => ({ type: 'Category', id: _id })),
              { type: 'Category', id: 'LIST' },
            ]
          : [{ type: 'Category', id: 'LIST' }],
    }),

    createCategory: builder.mutation({
      query: (body) => ({ url: '/categories', method: 'POST', body }),
      invalidatesTags: categoryLists,
    }),

    updateCategory: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/categories/${id}`, method: 'PUT', body }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Category', id },
        ...categoryLists,
      ],
    }),

    deleteCategory: builder.mutation({
      query: (id) => ({ url: `/categories/${id}`, method: 'DELETE' }),
      invalidatesTags: categoryLists,
    }),

    reorderCategories: builder.mutation({
      query: (orders) => ({ url: '/categories/reorder', method: 'PATCH', body: { orders } }),
      invalidatesTags: categoryLists,
    }),

    getPublicCategories: builder.query({
      query: (slug) => `/storefront/${slug}/categories`,
      providesTags: [{ type: 'Category', id: 'PUBLIC' }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useReorderCategoriesMutation,
  useGetPublicCategoriesQuery,
} = categoryApi;
