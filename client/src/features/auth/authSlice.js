import { createSlice } from '@reduxjs/toolkit';

const scope = ({ user, store }) => JSON.stringify([
  user?._id ?? null, user?.role ?? null, user?.tenantId?._id ?? user?.tenantId ?? null,
  store?._id ?? store?.slug ?? null,
]);

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
  },
  reducers: {
    setCredentials: (state, action) => {
      const { user, store, accessToken } = action.payload;
      changeScope(state, () => {
        const sameAccount = scope({ user: state.user }) === scope({ user });
        state.user = user;
        if (store !== undefined || !sameAccount) state.store = store ?? null;
      });
      state.accessToken = accessToken;
      state.isInitialized = true;
    },
    clearCredentials: (state) => {
      state.user = null;
      state.store = null;
      state.accessToken = null;
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
      if (state.user) changeScope(state, () => { state.user = { ...state.user, ...action.payload }; });
    },
  },
});

export const { setCredentials, clearCredentials, setStore, setInitialized, updateUser } =
  authSlice.actions;

export const selectCurrentUser = (state) => state.auth.user;
export const selectCurrentStore = (state) => state.auth.store;
export const selectAccessToken = (state) => state.auth.accessToken;
export const selectIsAuthenticated = (state) => !!state.auth.user && !!state.auth.accessToken;
export const selectIsInitialized = (state) => state.auth.isInitialized;
export const selectUserRole = (state) => state.auth.user?.role;
export const selectSessionEpoch = (state) => state.auth.sessionEpoch ?? 0;

export default authSlice.reducer;
