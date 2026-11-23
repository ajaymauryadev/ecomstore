import { baseApi } from '../../api/baseApi';
import { setStore } from '../auth/authSlice';

const storeApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMyStore: builder.query({
      query: () => '/stores/mine',
      providesTags: [{ type: 'Store', id: 'MY' }],
    }),
    updateMyStore: builder.mutation({
      query: (body) => ({ url: '/stores/mine', method: 'PATCH', body }),
      invalidatesTags: (result) => [
        { type: 'Store', id: 'MY' },
        ...(result?.data?.store?.slug ? [{ type: 'Store', id: `sf-${result.data.store.slug}` }] : []),
      ],
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          if (data?.data?.store) dispatch(setStore(data.data.store));
        } catch { /* The mutation result carries the API error to the caller. */ }
      },
    }),
    uploadPaymentQr: builder.mutation({
      query: (body) => ({ url: '/upload/image', method: 'POST', body }),
    }),
  }),
});

export const { useGetMyStoreQuery, useUpdateMyStoreMutation, useUploadPaymentQrMutation } = storeApi;
