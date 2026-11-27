import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { baseApi } from '../api/baseApi';
import authReducer, { selectSessionEpoch } from '../features/auth/authSlice';
import cartReducer from '../features/cart/cartSlice';
import { cartDraftMiddleware } from '../features/cart/cartDraftMiddleware';
import savedDataReducer from '../offline/savedDataSlice';
import { savedDataMiddleware } from '../offline/savedData';

const reducers = combineReducers({
  [baseApi.reducerPath]: baseApi.reducer,
  auth: authReducer,
  cart: cartReducer,
  savedData: savedDataReducer,
});

export function sessionReducer(state, action) {
  const next = reducers(state, action);
  if (!state || selectSessionEpoch(state) === selectSessionEpoch(next)) return next;
  return { ...next, [baseApi.reducerPath]: baseApi.reducer(undefined, baseApi.util.resetApiState()) };
}

export const sessionCacheMiddleware = ({ dispatch, getState }) => (next) => (action) => {
  const epoch = selectSessionEpoch(getState());
  const result = next(action);
  if (selectSessionEpoch(getState()) !== epoch) dispatch(baseApi.util.resetApiState());
  return result;
};

export const store = configureStore({
  reducer: sessionReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [baseApi.util.resetApiState.type],
      },
    }).concat(sessionCacheMiddleware, savedDataMiddleware, cartDraftMiddleware, baseApi.middleware),
  devTools: import.meta.env.DEV,
});

setupListeners(store.dispatch);
