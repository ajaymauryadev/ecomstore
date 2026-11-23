import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import PurchaseForm from './PurchaseForm';

const { getProducts, refetch, createPurchase } = vi.hoisted(() => ({
  getProducts: vi.fn(),
  refetch: vi.fn(),
  createPurchase: vi.fn(),
}));

vi.mock('../../../features/products/productApi', () => ({ useGetProductsQuery: getProducts }));
vi.mock('../../../features/suppliers/supplierApi', () => ({ useGetSuppliersQuery: () => ({}) }));
vi.mock('../../../features/purchases/purchaseApi', () => ({
  useCreatePurchaseMutation: () => [createPurchase, {}],
  useGetPurchaseQuery: () => ({}),
  useRecordPurchasePaymentMutation: () => [vi.fn(), {}],
}));

const product = {
  _id: 'rice', name: 'Rice',
  variants: [
    { _id: 'small', name: '1 kg', unit: 'kg', stock: 0, purchasePrice: 60, retailPrice: 80, isActive: true },
    { _id: 'archived', name: 'Archived pack', unit: 'kg', stock: 10, retailPrice: 150, isActive: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Matches GET /products: the paginated data field is an array.
  getProducts.mockReturnValue({ currentData: { data: [product], meta: { total: 1 } }, refetch });
  createPurchase.mockReturnValue({ unwrap: async () => ({}) });
});

async function openPicker() {
  const user = userEvent.setup();
  render(<MemoryRouter><PurchaseForm /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: /click to select product/i }));
  return user;
}

test('selects an active out-of-stock variant from the paginated response and saves its IDs and prices', async () => {
  const user = await openPicker();
  const dialog = screen.getByRole('dialog', { name: 'Select Product' });
  expect(within(dialog).queryByText('No products found')).toBeNull();
  expect(within(dialog).queryByText(/Archived pack/)).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: /Rice.*1 kg/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: /Rice.*1 kg/ })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('0.00')).toHaveValue(60);
  expect(screen.getByPlaceholderText('optional')).toHaveValue(80);
  fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '2' } });
  await user.click(screen.getByRole('button', { name: /save purchase & update stock/i }));
  expect(createPurchase).toHaveBeenCalledWith(expect.objectContaining({
    items: [expect.objectContaining({ productId: 'rice', variantId: 'small', quantity: 2, purchasePrice: 60, sellingPrice: 80 })],
  }));
});

test('passes product search text to the query', async () => {
  const user = await openPicker();
  await user.type(screen.getByPlaceholderText('Search product...'), 'rice');
  await waitFor(() => expect(getProducts).toHaveBeenLastCalledWith({ search: 'rice', limit: 20, isActive: true }));
});

test('does not silently discard a selected purchase row with missing quantity', async () => {
  const user = await openPicker();
  await user.click(screen.getByRole('button', { name: /Rice.*1 kg/ }));
  await user.click(screen.getByRole('button', { name: /Add Row/ }));
  await user.click(screen.getByRole('button', { name: /click to select product/i }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Rice.*1 kg/ }));
  fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '' } });
  await user.click(screen.getByRole('button', { name: /save purchase & update stock/i }));
  expect(createPurchase).not.toHaveBeenCalled();
});

test('shows loading while products are being fetched instead of an empty result', async () => {
  getProducts.mockReturnValue({ isFetching: true, refetch });
  await openPicker();
  expect(screen.getByRole('status')).toHaveTextContent('Loading products...');
  expect(screen.queryByText('No products found')).toBeNull();
});

test('shows request failures and lets the user retry', async () => {
  getProducts.mockReturnValue({ isError: true, error: { data: { message: 'Please retry later' } }, refetch });
  const user = await openPicker();
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load products');
  expect(screen.queryByText('No products found')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

test.each([
  { reason: 'no products', products: [] },
  { reason: 'only inactive variants', products: [{ ...product, variants: [product.variants[1]] }] },
])('shows the empty state for $reason', async ({ products }) => {
  getProducts.mockReturnValue({ currentData: { data: products }, refetch });
  await openPicker();
  expect(screen.getByText('No products found')).toBeInTheDocument();
});
