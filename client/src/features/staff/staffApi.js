import { baseApi } from '../../api/baseApi';

export const staffApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getStaff: builder.query({
      query: (params) => ({ url: '/users/staff', params }),
      providesTags: (result) => [
        { type: 'Staff', id: 'LIST' },
        ...(result?.data || []).map((user) => ({ type: 'Staff', id: user._id })),
      ],
    }),
    createStaff: builder.mutation({
      query: (body) => ({ url: '/users/staff', method: 'POST', body }),
      invalidatesTags: [{ type: 'Staff', id: 'LIST' }, { type: 'Dashboard', id: 'CURRENT' }],
    }),
    updateStaff: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/users/staff/${id}`, method: 'PATCH', body }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Staff', id }, { type: 'Staff', id: 'LIST' }, { type: 'Dashboard', id: 'CURRENT' },
      ],
    }),
    deactivateStaff: builder.mutation({
      query: (id) => ({ url: `/users/staff/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Staff', id: 'LIST' }, { type: 'Dashboard', id: 'CURRENT' }],
    }),
  }),
});

export const {
  useGetStaffQuery,
  useCreateStaffMutation,
  useUpdateStaffMutation,
  useDeactivateStaffMutation,
} = staffApi;
