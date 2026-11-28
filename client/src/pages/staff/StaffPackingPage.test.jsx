import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import authReducer, { setCredentials } from '../../features/auth/authSlice';
import savedDataReducer from '../../offline/savedDataSlice';
import { accountScope, savedStorage } from '../../offline/storage';
import { outboxMemory, saveIntent } from '../../offline/outbox';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { _id: 'packer', role: 'packer' } }) }));
let baseApi, StaffPackingPage, StaffOrdersPage, store, first;
const NativeRequest = globalThis.Request;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = (status = 'pending') => ({ _id: 'session', status: 'in_progress', orderNumber: 'ORD-1', items: [
  { _id: 'rusk', name: 'Rusk', status, requiredQty: 1, pickedQty: 0 },
] });
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'https://shop.test/api/v1');
  ({ baseApi } = await import('../../api/baseApi'));
  ({ default: StaffPackingPage } = await import('./StaffPackingPage'));
  ({ default: StaffOrdersPage } = await import('./StaffOrdersPage'));
});
beforeEach(async () => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input, options) { super(input, { ...options, signal: undefined }); }
  });
  for (const record of await savedStorage.all('outbox')) await savedStorage.delete('outbox', record.id);
  outboxMemory.clear();
  store = configureStore({ reducer: { auth: authReducer, savedData: savedDataReducer, api: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware) });
  store.dispatch(setCredentials({ user: { _id: 'packer', tenantId: 'shop', role: 'packer' }, accessToken: 'online' }));
  await store.dispatch(baseApi.util.upsertQueryData('getPackingSession', { orderId: 'order' }, { data: { session: session() } }));
  first = { id: 'first', account: accountScope(store.getState().auth), kind: 'packing', status: 'conflict', sequence: 1,
    error: 'The saved checklist differs from the current item.', errorCode: 'PACKING_ITEM_CHANGED', reconciliationVersion: 1,
    payload: { orderId: 'order', itemId: 'rusk', action: 'pick' } };
  await saveIntent(first);
  await saveIntent({ ...first, id: 'second', status: 'pending', sequence: 2, payload: { ...first.payload, action: 'pack' } });
});
afterEach(() => { cleanup(); store.dispatch(baseApi.util.resetApiState()); vi.unstubAllGlobals(); });
function showPage() {
  render(<Provider store={store}><MemoryRouter initialEntries={['/packing/order']}><Routes>
    <Route path="/packing/:orderId" element={<StaffPackingPage />} />
  </Routes></MemoryRouter></Provider>);
}

test('identifies a conflicting packed draft on its product card and clears dependent drafts using fresh server state', async () => {
  let finish;
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  showPage();
  expect(screen.getByText('Needs review')).toBeInTheDocument();
  expect(screen.getByText('Saved on this device: packed. Last confirmed: pending.')).toBeInTheDocument();
  expect(screen.getByText(/1 item\(s\) need review below/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Complete Packing' })).not.toBeInTheDocument();
  const clear = screen.getByRole('button', { name: /Use server status/ });
  fireEvent.click(clear);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(screen.getByRole('button', { name: 'Refreshing item…' })).toBeDisabled();
  expect(outboxMemory.size).toBe(2);
  await act(async () => { finish(response({ data: { session: session() } })); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pick' })).toBeEnabled());
  expect(outboxMemory.size).toBe(0);
  expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0].method).toBe('GET');
});

test('failed reconciliation keeps the conflict and both saved changes visible', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'Server unavailable' }, 503)));
  showPage();
  fireEvent.click(screen.getByRole('button', { name: /Use server status/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Use server status/ })).toBeEnabled());
  expect(screen.getByText('Needs review')).toBeInTheDocument();
  expect(outboxMemory.size).toBe(2);
});

test('an initial checklist download keeps the page heading and navigation visible', async () => {
  outboxMemory.clear();
  store.dispatch(baseApi.util.resetApiState());
  let finish;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
  showPage();
  expect(screen.getByRole('heading', { name: 'Pack order' })).toBeVisible();
  expect(screen.getByRole('status', { name: 'Loading packing checklist' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Complete Packing' })).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => { finish(response({ data: { session: session() } })); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pick' })).toBeEnabled());
});

test('packing cards stay mounted while filters and server data update', async () => {
  outboxMemory.clear();
  const order = { _id: 'order', orderNumber: 'ORD-1', status: 'packing', items: [], packingSession: { status: 'in_progress' } };
  await store.dispatch(baseApi.util.upsertQueryData('getMyPackingOrders', undefined, { data: { orders: [order] } }));
  render(<Provider store={store}><MemoryRouter><StaffOrdersPage /></MemoryRouter></Provider>);
  const card = screen.getByText('ORD-1').closest('article');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search packing orders' }), { target: { value: 'ORD' } });
  expect(screen.getByText('ORD-1').closest('article')).toBe(card);
  await act(async () => { await store.dispatch(baseApi.util.upsertQueryData('getMyPackingOrders', undefined, { data: { orders: [{ ...order, customerInfo: { name: 'Updated customer' } }] } })); });
  expect(screen.getByText('ORD-1').closest('article')).toBe(card);
  expect(screen.getByText(/Updated customer/)).toBeVisible();
});
