import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import authReducer from '../../../features/auth/authSlice';
import UnauthorizedPage from '../UnauthorizedPage';

function renderPage(user, accessToken = user ? 'test-token' : null) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { user, store: null, accessToken, isInitialized: true } },
  });
  render(<Provider store={store}><MemoryRouter initialEntries={['/unauthorized']}><Routes>
    <Route path="/unauthorized" element={<UnauthorizedPage />} />
    <Route path="/login" element={<p>Sign-in page</p>} />
    <Route path="/staff/dashboard" element={<p>Staff dashboard</p>} />
    <Route path="/store/dashboard" element={<p>Owner dashboard</p>} />
  </Routes></MemoryRouter></Provider>);
}

test.each([null, { role: 'staff' }])('takes a signed-out visitor to login: %j', async (user) => {
  renderPage(user, null);
  expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Access denied' })).not.toBeInTheDocument();
});

test.each([
  ['staff', 'Staff dashboard'], ['packer', 'Staff dashboard'],
  ['delivery', 'Staff dashboard'], ['store_owner', 'Owner dashboard'],
])('provides a working recovery link for %s', async (role, destination) => {
  renderPage({ role });
  expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Back to dashboard' }));
  expect(await screen.findByText(destination)).toBeInTheDocument();
});
