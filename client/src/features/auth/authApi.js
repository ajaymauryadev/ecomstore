import { baseApi } from '../../api/baseApi';
import { setCredentials, clearCredentials, selectSessionEpoch, updateUser } from './authSlice';
import { savedStorage, writePendingLogoutMarker } from '../../offline/storage';
import { savedDataStatus } from '../../offline/savedDataSlice';

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setCredentials(data.data));
        } catch { /* The mutation result carries the API error to the caller. */ }
      },
    }),

    register: builder.mutation({
      query: (body) => ({
        url: '/auth/register',
        method: 'POST',
        body,
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setCredentials(data.data));
        } catch { /* The mutation result carries the API error to the caller. */ }
      },
    }),

    logout: builder.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted({ requireServerConfirmation = false } = {}, { dispatch, getState, queryFulfilled }) {
        const epoch = selectSessionEpoch(getState());
        writePendingLogoutMarker(true);
        const remembered = savedStorage.put('identity', 'logoutPending', true).catch(() => {
          dispatch(savedDataStatus({ storageError: 'Sign-out could not be saved on this device. Connect online to finish signing out.' }));
        });
        try {
          await queryFulfilled;
          dispatch(savedDataStatus({ logoutPending: false }));
          writePendingLogoutMarker(false);
          void remembered.then(() => savedStorage.delete('identity', 'logoutPending')).catch(() => {});
        } catch (failure) {
          await remembered;
          const status = failure?.error?.status ?? failure?.status;
          if (requireServerConfirmation && [401, 403].includes(status)) {
            // An expired cookie already has no server session to revoke.
            dispatch(savedDataStatus({ logoutPending: false }));
            writePendingLogoutMarker(false);
            void savedStorage.delete('identity', 'logoutPending').catch(() => {});
          } else {
            dispatch(savedDataStatus({ logoutPending: true }));
            if (requireServerConfirmation) return;
          }
        }
        if (selectSessionEpoch(getState()) !== epoch) return;
        dispatch(clearCredentials());
      },
    }),

    refreshToken: builder.mutation({
      query: () => ({ url: '/auth/refresh', method: 'POST' }),
    }),

    getMe: builder.query({
      query: () => '/auth/me',
      providesTags: ['CurrentUser'],
      async onQueryStarted(_, { dispatch, getState, queryFulfilled }) {
        const epoch = selectSessionEpoch(getState());
        try {
          const { data } = await queryFulfilled;
          if (epoch === selectSessionEpoch(getState()) && data?.data?.user?._id === getState().auth.user?._id) {
            dispatch(updateUser(data.data.user));
          }
        } catch { /* Session recovery is handled by the base query. */ }
      },
    }),

    updatePassword: builder.mutation({
      query: (body) => ({ url: '/auth/update-password', method: 'PATCH', body }),
    }),
  }),
  overrideExisting: false,
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useRefreshTokenMutation,
  useGetMeQuery,
  useUpdatePasswordMutation,
} = authApi;
