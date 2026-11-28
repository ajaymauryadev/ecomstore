import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const statsQuery = vi.hoisted(() => vi.fn());
vi.mock('../../features/superAdmin/superAdminApi', () => ({ useGetSystemStatsQuery: statsQuery }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { name: 'Admin' } }) }));

beforeEach(() => statsQuery.mockReset());

it('shows unavailable metrics instead of fabricated zeros after an initial failure', () => {
  statsQuery.mockReturnValue({ isError: true, isLoading: false, refetch: vi.fn() });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'System Overview' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('System statistics are unavailable');
  expect(screen.getByText('Recent stores unavailable')).toBeInTheDocument();
  expect(screen.getByText('Plan data unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(4);
});

it('preserves a confirmed zero from the response', () => {
  statsQuery.mockReturnValue({ data: { data: { totalStores: 0, activeStores: 0, totalUsers: 0, expiringThisWeek: 0, recentStores: [], planDistribution: [] } }, isLoading: false });
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(screen.getAllByText('0')).toHaveLength(4);
  expect(screen.getByText('No stores yet')).toBeInTheDocument();
});
