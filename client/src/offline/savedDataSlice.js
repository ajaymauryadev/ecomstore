import { createSlice } from '@reduxjs/toolkit';

const slice = createSlice({
  name: 'savedData',
  initialState: { restoring: false, storageError: null, serverUnavailable: false, offline: false, shellReady: false, logoutPending: false },
  reducers: { savedDataStatus: (state, { payload }) => Object.assign(state, payload) },
});
export const { savedDataStatus } = slice.actions;
export const HYDRATE_SAVED_DATA = 'savedData/hydrate';
export default slice.reducer;
