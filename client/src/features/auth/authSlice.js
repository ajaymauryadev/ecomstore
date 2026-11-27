import { createSlice } from '@reduxjs/toolkit';
import { accountScope, OFFLINE_ACCESS_MS } from '../../offline/storage';

const scope = accountScope;

function changeScope(state, update) {
  const previous = scope(state);
  update();
  if (previous !== scope(state)) state.sessionEpoch = (state.sessionEpoch ?? 0) + 1;
}

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    store: null,
    accessToken: null,
    isInitialized: false,
    sessionEpoch: 0,
    offlineSession: false,
    verifiedAt: null,
  },
  reducers: {
    setCredentials: (state, action) => {
      const { user, store, accessToken } = action.payload;
      changeScope(state, () => {
        const sameAccount = state.user?._id === user?._id &&
          (state.user?.tenantId?._id ?? state.user?.tenantId) === (user?.tenantId?._id ?? user?.tenantId);
        state.user = user;
        if (store !== undefined || !sameAccount) state.store = store ?? null;
      });
      state.accessToken = accessToken;
      state.offlineSession = false;
      state.verifiedAt = Date.now();
      state.isInitialized = true;
    },
    restoreOfflineIdentity: (state, { payload }) => {
      changeScope(state, () => { state.user = payload.user; state.store = payload.store; });
      state.accessToken = null;
      state.offlineSession = true;
      state.verifiedAt = payload.verifiedAt;
    },
    clearCredentials: (state) => {
      state.user = null;
      state.store = null;
      state.accessToken = null;
      state.offlineSession = false;
      state.verifiedAt = null;
      state.isInitialized = true;
      state.sessionEpoch = (state.sessionEpoch ?? 0) + 1;
    },
    setStore: (state, action) => {
      changeScope(state, () => { state.store = action.payload; });
    },
    setInitialized: (state) => {
      state.isInitialized = true;
    },
    updateUser: (state, action) => {
      if (state.user) {
        changeScope(state, () => { state.user = { ...state.user, ...action.payload }; });
        state.verifiedAt = Date.now();
      }
    },
  },
});

export const { setCredentials, clearCredentials, setStore, setInitialized, updateUser, restoreOfflineIdentity } =
  authSlice.actions;

export const selectCurrentUser = (state) => state.auth.user;
export const selectCurrentStore = (state) => state.auth.store;
export const selectAccessToken = (state) => state.auth.accessToken;
export const selectIsAuthenticated = (state) => !!state.auth.user && (!!state.auth.accessToken || state.auth.offlineSession) &&
  (state.auth.verifiedAt == null || Date.now() - state.auth.verifiedAt < OFFLINE_ACCESS_MS);
export const selectIsInitialized = (state) => state.auth.isInitialized || state.auth.offlineSession;
export const selectUserRole = (state) => state.auth.user?.role;
export const selectSessionEpoch = (state) => state.auth.sessionEpoch ?? 0;

export default authSlice.reducer;
