import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import authReducer from '../../../features/auth/authSlice';
import ProtectedRoute from '../ProtectedRoute';
import { PERMISSIONS } from '../../../constants/permissions';

const renderBoundary = (user, requiredPermissions) => {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { user, store: null, accessToken: 'test-token', isInitialized: true } },
  });
  return render(<Provider store={store}><MemoryRouter initialEntries={['/protected']}><Routes>
    <Route path="/protected" element={<ProtectedRoute requiredPermissions={requiredPermissions}><p>Protected content</p></ProtectedRoute>} />
    <Route path="/unauthorized" element={<p>Unauthorized route</p>} />
  </Routes></MemoryRouter></Provider>);
};

describe('ProtectedRoute', () => {
  test('keeps permission management with the owner even when an employee carries a disallowed permission', async () => {
    renderBoundary({ role: 'packer', permissions: [PERMISSIONS.STAFF_MANAGE] }, [PERMISSIONS.STAFF_MANAGE]);
    expect(await screen.findByText('Unauthorized route')).toBeInTheDocument();
  });

  test('allows an employee to use extra shop duties granted by the owner', async () => {
    renderBoundary({ role: 'packer', permissions: [PERMISSIONS.DELIVERY_VIEW] }, [PERMISSIONS.DELIVERY_VIEW]);
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  test('allows owner access through the same permission model', async () => {
    renderBoundary({ role: 'store_owner', permissions: [] }, [PERMISSIONS.SETTINGS_VIEW]);
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });
});
