import { baseApi } from '../../api/baseApi';

export const dashboardApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDashboard: builder.query({
      query: () => '/dashboard',
      providesTags: [{ type: 'Dashboard', id: 'CURRENT' }],
    }),
  }),
});

export const { useGetDashboardQuery } = dashboardApi;
