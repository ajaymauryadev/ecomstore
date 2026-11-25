import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import POSPage from './POSPage';

const { createOrder, getProducts, getAccounts } = vi.hoisted(() => ({ createOrder: vi.fn(), getProducts: vi.fn(), getAccounts: vi.fn() }));
vi.mock('../../../hooks/useNextPagePrefetch', () => ({ useNextPagePrefetch: vi.fn() }));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ store: { _id: 'shop' }, user: { _id: 'cashier' } }),
}));
vi.mock('../../../features/pos/posApi', () => ({
  useCreatePOSOrderMutation: () => [createOrder, {}],
  useGetPOSUdharCustomersQuery: getAccounts,
}));
vi.mock('../../../features/products/productApi', () => ({
  useGetProductsQuery: getProducts,
}));

const rice = {
      _id: 'rice', name: 'Rice',
      variants: [{ _id: 'pack', name: '1 kg', unit: 'kg', barcode: '8901234', retailPrice: 100, stock: 10, isActive: true }],
};
beforeEach(() => {
  vi.clearAllMocks();
  getAccounts.mockReturnValue({ currentData: { data: [{ _id: 'account', name: 'Ajay', phone: '9876543210', balance: 20 }] } });
  getProducts.mockReturnValue({ currentData: { data: [rice] } });
  createOrder.mockReturnValue({ unwrap: async () => ({ data: { order: { orderNumber: 'ORD-001' } } }) });
});

test('keeps the cashier bill intact during a 429 countdown and retries the same bill once', async () => {
  vi.useFakeTimers();
  try {
    createOrder.mockReturnValueOnce({
      unwrap: async () => { throw { status: 429, data: { retryAt: Date.now() + 3000 } }; },
    }).mockReturnValueOnce({
      unwrap: async () => ({ data: { order: { orderNumber: 'ORD-001' } } }),
    });
    render(<POSPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Rice' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    fireEvent.click(screen.getByRole('button', { name: /Rice/ }));
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Test Buyer' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Collect Payment/ })));

    expect(screen.getByRole('status')).toHaveTextContent('The bill draft is intact');
    expect(screen.getByText('Bill Items (1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Customer name')).toHaveValue('Test Buyer');
    expect(screen.getByLabelText('Customer name')).toBeDisabled();
    const waiting = screen.getByRole('button', { name: 'Retry bill in 3s' });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    expect(createOrder).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(3000));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry original bill' })));
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][0]).toEqual(createOrder.mock.calls[0][0]);
    expect(screen.getByRole('dialog', { name: 'Bill Generated' })).toHaveTextContent('ORD-001');
  } finally {
    vi.useRealTimers();
  }
});

test('adds packs directly, keeps search, and bills a cash customer without any form', async () => {
  render(<POSPage />);
  expect(screen.getByLabelText('Customer name')).toHaveValue('');
  expect(screen.getByLabelText('Phone number')).not.toBeRequired();
  expect(screen.getByRole('button', { name: 'Instant Sale' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Rice' } });
  fireEvent.click(screen.getByRole('button', { name: /Rice 1 kg/ }));
  expect(screen.getByRole('searchbox')).toHaveValue('Rice');
  expect(screen.getByLabelText(/^Quantity of Rice/)).toHaveValue(1);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Collect Payment/ })));
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
    items: [expect.objectContaining({ productId: 'rice', variantId: 'pack', qty: 1 })],
    paymentMethod: 'counter', saleType: 'instant',
  }));
  expect(createOrder.mock.calls[0][0]).not.toHaveProperty('customerName');
  expect(createOrder.mock.calls[0][0]).not.toHaveProperty('customerPhone');
});

test('rapid repeated taps stay on one line and cannot exceed available stock', () => {
  render(<POSPage />);
  const add = screen.getByRole('button', { name: /Rice 1 kg/ });
  act(() => { for (let i = 0; i < 15; i += 1) fireEvent.click(add); });
  expect(screen.getByText('Bill Items (1)')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Quantity of Rice/)).toHaveValue(10);
  expect(screen.getByRole('button', { name: 'Increase quantity of Rice 1 kg' })).toBeDisabled();
});

test('shows each pack without a modal and disables empty packs', () => {
  getProducts.mockReturnValue({ currentData: { data: [{ ...rice, variants: [
    ...rice.variants, { ...rice.variants[0], _id: 'empty', name: '5 kg', stock: 0 },
    { ...rice.variants[0], _id: 'large', name: '10 kg', stock: 3 },
  ] }] } });
  render(<POSPage />);
  expect(screen.getByRole('button', { name: /Rice 5 kg/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Rice 10 kg/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText(/^Quantity of Rice/)).toHaveValue(1);
});

test('cached matches remain clickable during remote fetching and unrelated stale matches disappear', () => {
  getProducts.mockImplementation((params) => params.search !== undefined
    ? { isFetching: true } : { currentData: { data: [rice] } });
  render(<POSPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Rice' } });
  fireEvent.click(screen.getByRole('button', { name: /Rice 1 kg/ }));
  expect(screen.getByLabelText(/^Quantity of Rice/)).toHaveValue(1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Soap' } });
  expect(screen.queryByRole('button', { name: /^Rice 1 kg/ })).toBeNull();
});

test('queues scanner Enter until search settles and adds the exact barcode once', async () => {
  vi.useFakeTimers();
  try {
    render(<POSPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '8901234' } });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(screen.queryByLabelText(/^Quantity of Rice/)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByLabelText(/^Quantity of Rice/)).toHaveValue(1);
    expect(screen.getByRole('searchbox')).toHaveValue('');
  } finally { vi.useRealTimers(); }
});

test('direct quantity entry is clamped and Udhar offers customer selection', () => {
  render(<POSPage />);
  fireEvent.click(screen.getByRole('button', { name: /Rice 1 kg/ }));
  const qty = screen.getByLabelText(/^Quantity of Rice/);
  fireEvent.change(qty, { target: { value: '999' } });
  fireEvent.blur(qty);
  expect(screen.getByLabelText(/^Quantity of Rice/)).toHaveValue(10);
  fireEvent.click(screen.getByRole('button', { name: 'Udhar', exact: true }));
  expect(screen.getByLabelText(/Select Udhar account/)).toBeRequired();
  expect(screen.getByLabelText(/Search customer by name or phone/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Customer name')).toBeNull();
});

test('saves cash and UPI portions against a selected account and adds only the remainder to Udhar', async () => {
  render(<POSPage />);
  fireEvent.click(screen.getByRole('button', { name: /Rice 1 kg/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Udhar', exact: true }));
  fireEvent.change(screen.getByLabelText(/Cash received/), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText(/UPI received/), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText(/Select Udhar account/), { target: { value: 'account' } });
  expect(screen.getByText('Due after this bill: ₹70.00')).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Create Udhar Bill/ })));
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
    paymentMethod: 'credit', udharCustomerId: 'account', payments: { cash: 20, upi: 30 }, customerPhone: '9876543210',
  }));
});

test('requires an account for pending Udhar and blocks an overpaid bill', async () => {
  render(<POSPage />);
  fireEvent.click(screen.getByRole('button', { name: /Rice 1 kg/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Split', exact: true }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Create Udhar Bill/ })));
  expect(screen.getByRole('alert')).toHaveTextContent('Select a customer account');
  fireEvent.change(screen.getByLabelText(/Cash received/), { target: { value: '101' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Collect Payment/ })));
  expect(createOrder).not.toHaveBeenCalled();
  expect(screen.getAllByRole('alert').some((element) => element.textContent.includes('cannot exceed'))).toBe(true);
});

test('accepts fully paid cash plus UPI without requiring an Udhar account', async () => {
  render(<POSPage />);
  fireEvent.click(screen.getByRole('button', { name: /Rice 1 kg/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Split', exact: true }));
  fireEvent.change(screen.getByLabelText(/Cash received/), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText(/UPI received/), { target: { value: '60' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Collect Payment/ })));
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'counter', payments: { cash: 40, upi: 60 } }));
  expect(createOrder.mock.calls[0][0]).not.toHaveProperty('udharCustomerId');
});
