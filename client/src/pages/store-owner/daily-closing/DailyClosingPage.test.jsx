import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import DailyClosingPage from './DailyClosingPage';

const { summaryQuery } = vi.hoisted(() => ({ summaryQuery: vi.fn() }));

vi.mock('../../../features/dailyClosing/dailyClosingApi', () => ({
  useGetDailySummaryQuery: summaryQuery,
  useGetDailyTransactionsQuery: () => ({}),
  useGetDailyClosingsQuery: () => ({}),
  useSaveDailyClosingMutation: () => [vi.fn(), {}],
  useFinalizeDailyClosingMutation: () => [vi.fn(), {}],
  useCorrectDailyClosingMutation: () => [vi.fn(), {}],
}));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isStoreOwner: true }) }));

const view = () => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <DailyClosingPage />
  </MemoryRouter>
);
const queryResult = (closing) => ({ currentData: { data: { closing } }, refetch: vi.fn() });

test('shows the finalized drawer count read-only and offers the owner a correction', () => {
  summaryQuery.mockReturnValue(queryResult({
    _id: 'closing', status: 'closed', version: 2, closedByName: 'Owner',
    openingCash: 500, closingCash: 500, expectedClosingCash: 500, cashDifference: 0,
  }));
  render(view());
  expect(screen.getByLabelText(/physical count/i)).toHaveValue(500);
  expect(screen.getByLabelText(/physical count/i)).toHaveAttribute('readonly');
  expect(screen.queryByRole('button', { name: 'Save Draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Finalize Closing' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record Correction' })).toBeEnabled();
});

test('blocks saving local draft edits against a newer version until the saved draft is loaded', () => {
  const draft = { _id: 'draft', status: 'draft', version: 1, openingCash: 500, closingCash: 500 };
  summaryQuery.mockReturnValue(queryResult(draft));
  const { rerender } = render(view());
  fireEvent.change(screen.getByLabelText(/physical count/i), { target: { value: '20' } });
  expect(screen.getByRole('button', { name: 'Finalize Closing' })).toBeDisabled();

  summaryQuery.mockReturnValue(queryResult({ ...draft, version: 2, closingCash: 480, notes: 'Counted ₹20 short' }));
  rerender(view());
  expect(screen.getByLabelText(/physical count/i)).toHaveValue(20);
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Load Saved Draft' }));
  expect(screen.getByLabelText(/physical count/i)).toHaveValue(480);
  expect(screen.getByRole('button', { name: 'Finalize Closing' })).toBeEnabled();
});

test('waits for a real count and never reports extra cash against a negative drawer balance', () => {
  summaryQuery.mockReturnValue({ currentData: { data: { movements: { cash: { net: -200 } } } }, refetch: vi.fn() });
  render(view());
  expect(screen.getByText('Awaiting Cash Count')).toBeVisible();
  fireEvent.change(screen.getByLabelText(/when you opened/i), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText(/physical count/i), { target: { value: '0' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Expected cash is below zero');
  expect(screen.queryByText(/Extra Cash/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finalize Closing' })).toBeDisabled();
});
