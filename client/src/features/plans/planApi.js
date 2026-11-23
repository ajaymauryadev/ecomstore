import { baseApi } from '../../api/baseApi';

const planApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPlans: builder.query({
      query: () => '/plans',
      providesTags: [{ type: 'Plan', id: 'LIST' }],
    }),
    createPlan: builder.mutation({
      query: (body) => ({ url: '/plans', method: 'POST', body }),
      invalidatesTags: [{ type: 'Plan', id: 'LIST' }],
    }),
    updatePlan: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/plans/${id}`, method: 'PUT', body }),
      invalidatesTags: [{ type: 'Plan', id: 'LIST' }],
    }),
    deletePlan: builder.mutation({
      query: (id) => ({ url: `/plans/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Plan', id: 'LIST' }],
    }),
    seedPlans: builder.mutation({
      query: () => ({ url: '/plans/seed', method: 'POST' }),
      invalidatesTags: [{ type: 'Plan', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetPlansQuery,
  useCreatePlanMutation,
  useUpdatePlanMutation,
  useDeletePlanMutation,
  useSeedPlansMutation,
} = planApi;
