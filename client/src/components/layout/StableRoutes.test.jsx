import { lazy } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { Link, MemoryRouter, Outlet, Route } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import authReducer, { clearCredentials } from '../../features/auth/authSlice';
import savedDataReducer, { savedDataStatus } from '../../offline/savedDataSlice';
import ProtectedRoute from '../shared/ProtectedRoute';
import StableRoutes from './StableRoutes';
import RouteContent from './RouteContent';

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}));

function mount() {
  let release;
  const SlowPage = lazy(() => new Promise((resolve) => { release = () => resolve({ default: () => <h1>Second page</h1> }); }));
  const store = configureStore({
    reducer: { auth: authReducer, savedData: savedDataReducer },
    preloadedState: { auth: { user: { role: 'store_owner' }, accessToken: 'test', isInitialized: true, sessionEpoch: 0 } },
  });
  function Layout() {
    return <><header>Workspace navigation</header><RouteContent><Outlet /></RouteContent></>;
  }
  render(<Provider store={store}><MemoryRouter initialEntries={['/first']}><StableRoutes>
    <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
      <Route path="/first" element={<><h1>Saved first page</h1><input aria-label="Draft" defaultValue="Saved draft" /><Link to="/second">Second</Link></>} />
      <Route path="/second" element={<SlowPage />} />
    </Route>
    <Route path="/login" element={<h1>Sign in</h1>} />
  </StableRoutes></MemoryRouter></Provider>);
  return { store, release: () => release() };
}

test('keeps the current UI, draft and shell until a delayed route chunk is ready', async () => {
  const { release } = mount();
  const shell = screen.getByText('Workspace navigation');
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Still editing' } });
  fireEvent.click(screen.getByRole('link', { name: 'Second' }));
  expect(screen.getByRole('heading', { name: 'Saved first page' })).toBeVisible();
  expect(draft).toHaveValue('Still editing');
  expect(screen.queryByLabelText('Loading page')).not.toBeInTheDocument();
  await act(async () => release());
  expect(await screen.findByRole('heading', { name: 'Second page' })).toBeVisible();
  expect(screen.getByText('Workspace navigation')).toBe(shell);
});

test('retaining a slow route never keeps private content after sign-out', async () => {
  const { store, release } = mount();
  fireEvent.click(screen.getByRole('link', { name: 'Second' }));
  act(() => store.dispatch(clearCredentials()));
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Saved first page' })).not.toBeInTheDocument();
  await act(async () => release());
  expect(screen.queryByRole('heading', { name: 'Second page' })).not.toBeInTheDocument();
});

test('restoring an account snapshot keeps the workspace shell mounted', () => {
  const { store } = mount();
  const shell = screen.getByText('Workspace navigation');
  act(() => store.dispatch(savedDataStatus({ restoring: true })));
  expect(screen.getByText('Workspace navigation')).toBe(shell);
  expect(screen.getByRole('status', { name: 'Restoring saved view' })).toBeVisible();
  act(() => store.dispatch(savedDataStatus({ restoring: false })));
  expect(screen.getByText('Workspace navigation')).toBe(shell);
  expect(screen.getByRole('heading', { name: 'Saved first page' })).toBeVisible();
});
