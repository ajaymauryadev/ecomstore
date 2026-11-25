import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import UdharPage from './UdharPage';

const api = vi.hoisted(() => ({ ledger: vi.fn(), customers: vi.fn(), create: vi.fn() }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'store_owner' }, store: {} }) }));
vi.mock('../../../features/udhar/udharApi', () => ({
  useGetUdharCustomersQuery: api.customers,
  useGetCustomerLedgerQuery: api.ledger,
  useGetUdharStatsQuery: () => ({ data: { data: { totalCustomers: 1, totalDue: 130 } } }),
  useGetLegacyCreditBillsQuery: () => ({}),
  useCreateUdharCustomerMutation: () => [api.create, {}],
  useAddUdharDebitMutation: () => [vi.fn(), {}],
  useAddUdharCreditMutation: () => [vi.fn(), {}],
  useGetCustomerBillsQuery: () => ({}),
}));

test('opens a customer ledger with purchased items, recorder and history pagination', () => {
  const id = '123456789012345678901234';
  const customer = { _id: id, name: 'Mira Sharma', phone: '9876543210', balance: 130, creditLimit: 5000 };
  api.customers.mockReturnValue({ data: { data: [customer], meta: { totalPages: 2, hasNextPage: true } } });
  api.ledger.mockReturnValue({ currentData: { data: {
    customer, summary: { totalDebits: 180, totalCredits: 50 }, meta: { total: 22, totalPages: 2, hasNextPage: true, nextCursor: 'next-history' },
    entries: [{ _id: 'entry', type: 'debit', amount: 180, balanceAfter: 180, recordedByName: 'Counter Staff', recordedByRole: 'staff',
      date: '2026-11-22T06:00:00Z', createdAt: '2026-11-22T06:00:00Z', description: 'POS bill', referenceType: 'pos_order',
      order: { _id: 'bill', orderNumber: 'ORD-123', createdAt: '2026-11-22T06:00:00Z', orderType: 'counter', status: 'delivered', pricing: { grandTotal: 180 }, items: [{ name: 'Rice', variantName: '1 kg', unit: 'kg', quantity: 2, price: 90, total: 180 }] },
    }],
  } } });
  render(<MemoryRouter initialEntries={['/store/udhar?customerId=' + id]}><UdharPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Account history' }));
  expect(screen.getByText('Recorded by Counter Staff (staff)')).toBeInTheDocument();
  expect(screen.getByText('Rice')).toBeInTheDocument();
  expect(screen.getByText(/2 kg ×/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open order' })).toHaveAttribute('href', '/store/orders?orderId=bill');
  fireEvent.click(screen.getByRole('button', { name: 'Next entries' }));
  expect(api.ledger).toHaveBeenLastCalledWith({ id, page: 2, cursor: 'next-history', limit: expect.any(Number) }, { skip: false });
  fireEvent.click(screen.getByRole('button', { name: 'Next accounts' }));
  expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
});

test('prefills a new account phone number when opened from POS', () => {
  api.customers.mockReturnValue({ data: { data: [] } });
  api.ledger.mockReturnValue({});
  render(<MemoryRouter initialEntries={['/store/udhar?phone=9876543210']}><UdharPage /></MemoryRouter>);
  expect(screen.getByRole('dialog', { name: 'Add Udhar customer' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('10-digit mobile')).toHaveValue('9876543210');
});

test('opens a new account form from a name search without a credit limit', () => {
  api.customers.mockReturnValue({ data: { data: [] } });
  api.ledger.mockReturnValue({});
  render(<MemoryRouter initialEntries={['/store/udhar?new=1&name=Ajay']}><UdharPage /></MemoryRouter>);
  expect(screen.getByRole('dialog', { name: 'Add Udhar customer' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Ajay');
  expect(screen.queryByLabelText(/Credit Limit/)).toBeNull();
});

test('submits an address and shows it on the selected customer', async () => {
  const address = '12 Market Road\nPune 411001';
  const customer = { _id: '123456789012345678901234', name: 'Address Buyer', address, balance: 0 };
  api.customers.mockReturnValue({ data: { data: [] } });
  api.ledger.mockReturnValue({});
  api.create.mockReturnValue({ unwrap: () => Promise.resolve({ data: { customer } }) });
  render(<MemoryRouter initialEntries={['/store/udhar?new=1']}><UdharPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: customer.name } });
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '  ' + address + '  ' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Customer', exact: true }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith({ name: customer.name, address, phone: undefined, notes: undefined }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('12 Market Road Pune 411001')).toBeInTheDocument();
});
