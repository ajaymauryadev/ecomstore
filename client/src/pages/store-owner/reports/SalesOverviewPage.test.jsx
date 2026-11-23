import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import SalesOverviewPage from './SalesOverviewPage';

const reportApi = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ store: { settings: { timezone: 'Asia/Kolkata' } } }) }));
vi.mock('../../../features/reports/reportsApi', () => ({ useGetSalesOverviewQuery: reportApi }));

test('shows POS, delivery and Udhar sources separately and links receipts to their records', () => {
  reportApi.mockReturnValue({ currentData: { data: {
    summary: { sales: 480.6, received: 247.74, refunds: 25, netReceived: 222.74, outstandingUdhar: 40, creditSales: 50, orderCount: 6 },
    salesBySource: [{ key: 'pos', amount: 160.1 }, { key: 'delivery', amount: 320.5 }],
    receiptsBySource: [{ key: 'pos', amount: 130.1 }, { key: 'delivery', amount: 105.3 }, { key: 'udhar', amount: 12.34 }],
    receiptsByMethod: [{ key: 'cash', amount: 130.1 }], meta: { total: 2 },
    transactions: [
      { _id: 'receipt', source: 'pos', orderId: 'order', orderNumber: 'ORD-123', customerName: 'Mira', method: 'counter', amount: 130.1, receivedAt: '2026-11-22T06:00:00Z' },
      { _id: 'collection', source: 'udhar', customerId: 'customer', customerName: 'Ansh', method: 'cash', amount: 12.34, receivedAt: '2026-11-22T06:00:00Z' },
    ],
  } } });
  render(<MemoryRouter initialEntries={['/store/sales?startDate=2026-11-22&endDate=2026-11-22']}><SalesOverviewPage /></MemoryRouter>);
  const pos = screen.getByRole('heading', { name: 'POS / counter' }).closest('article');
  expect(within(pos).getByText('₹160.1')).toBeInTheDocument();
  expect(within(pos).getByText('₹130.1')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Online / delivery' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Udhar collections' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ORD-123' })).toHaveAttribute('href', '/store/orders?orderId=order');
  expect(screen.getByRole('link', { name: 'View ledger' })).toHaveAttribute('href', '/store/udhar?customerId=customer');
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-23' } });
  expect(screen.getByRole('alert')).toHaveTextContent('From date must be on or before To date.');
  expect(reportApi).toHaveBeenLastCalledWith(expect.anything(), { skip: true });
});
