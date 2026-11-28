import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import SavedReadBoundary from './SavedReadBoundary';
import { useQueryReadState } from './ReadStateContext';

const failure = { currentData: undefined, isError: true, error: { status: 'FETCH_ERROR' }, refetch: vi.fn() };
const success = { currentData: { data: [] }, isError: false, refetch: failure.refetch };
function Page({ result }) {
  useQueryReadState(result);
  return <><h1>Orders</h1><input aria-label="Search orders" defaultValue="My saved search" /></>;
}

test('an offline miss leaves the page UI and inputs visible while explaining the missing download', () => {
  const { rerender } = render(<SavedReadBoundary><Page result={success} /></SavedReadBoundary>);
  const search = screen.getByRole('textbox', { name: 'Search orders' });
  rerender(<SavedReadBoundary><Page result={failure} /></SavedReadBoundary>);
  expect(screen.getByRole('heading', { name: 'Orders' })).toBeVisible();
  expect(search).toBeVisible();
  expect(search).toHaveValue('My saved search');
  expect(screen.getByText('This view is waiting for its first download')).toBeVisible();
  rerender(<SavedReadBoundary><Page result={success} /></SavedReadBoundary>);
  expect(screen.queryByText('This view is waiting for its first download')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Search orders' })).toBe(search);
});
