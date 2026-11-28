import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import ReturnsPage from './ReturnsPage';
import { PERMISSIONS } from '../../../constants/permissions';

const api = vi.hoisted(() => ({ stats: vi.fn(), user: { role: 'staff' } }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: api.user, store: { slug: 'test' } }) }));
vi.mock('../../../offline/useSavedViewState', () => ({ useSavedViewState: (_key, initial) => useState(initial) }));
vi.mock('../../../features/returns/returnsApi', () => ({
  useGetReturnStatsQuery: api.stats,
  useGetReturnsQuery: () => ({ data: { data: [{ _id: 'return', returnNumber: 'RET-1', status: 'pending', items: [] }] }, refetch: vi.fn() }),
  useCreateReturnMutation: () => [vi.fn(), {}],
  useProcessReturnMutation: () => [vi.fn(), {}],
}));

test.each([
  [{ role: 'staff' }, false, true],
  [{ role: 'packer', permissions: [PERMISSIONS.RETURNS_VIEW] }, false, false],
  [{ role: 'staff', permissions: [PERMISSIONS.RETURNS_PROCESS] }, true, true],
  [{ role: 'store_owner' }, true, true],
])('restricts returns statistics and actions for %j', (user, canProcess, canCreate) => {
  api.user = user;
  api.stats.mockReturnValue({ data: { data: { stats: [] } } });
  render(<ReturnsPage />);
  expect(api.stats).toHaveBeenLastCalledWith({}, { skip: !canProcess });
  expect(Boolean(screen.queryByText('Customer Returns (processed)'))).toBe(canProcess);
  expect(Boolean(screen.queryByRole('button', { name: 'New Return' }))).toBe(canCreate);
  fireEvent.click(screen.getByRole('button', { name: 'Expand RET-1' }));
  expect(Boolean(screen.queryByRole('button', { name: 'Process & Approve' }))).toBe(canProcess);
  expect(Boolean(screen.queryByRole('button', { name: 'Reject' }))).toBe(canProcess);
});
