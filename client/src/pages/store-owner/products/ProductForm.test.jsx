import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import ProductForm from './ProductForm';

const { getProduct, reloadProduct, updateProduct, createProduct } = vi.hoisted(() => ({
  getProduct: vi.fn(),
  reloadProduct: vi.fn(),
  updateProduct: vi.fn(),
  createProduct: vi.fn(),
}));

vi.mock('../../../features/products/productApi', () => ({
  useGetProductQuery: getProduct,
  useCreateProductMutation: () => [createProduct, {}],
  useUpdateProductMutation: () => [updateProduct, {}],
  useUploadImageMutation: () => [vi.fn(), {}],
}));

vi.mock('../../../features/categories/categoryApi', () => ({
  useGetCategoriesQuery: () => ({}),
}));

test('keeps saved variant IDs and the draft revision until a stale edit is explicitly reloaded', async () => {
  const user = userEvent.setup();
  const initial = {
    revision: 'first-revision',
    product: {
      name: 'Rice',
      variants: [
        { _id: 'small', name: '1 kg', unit: 'kg', retailPrice: 100, stock: 10, isActive: true },
        { _id: 'large', name: '2 kg', unit: 'kg', retailPrice: 180, stock: 8, isActive: true },
      ],
    },
  };
  const updated = {
    revision: 'new-revision',
    product: {
      ...initial.product,
      variants: [
        initial.product.variants[0],
        { ...initial.product.variants[1], stock: 5 },
      ],
    },
  };
  getProduct.mockReturnValue({ currentData: { data: initial }, refetch: reloadProduct });
  reloadProduct.mockReturnValue({ unwrap: async () => ({ data: updated }) });
  updateProduct.mockReturnValue({
    unwrap: async () => { throw { status: 409, data: { message: 'This product changed while you were editing.' } }; },
  });

  const view = () => (
    <MemoryRouter initialEntries={['/store/products/rice/edit']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/store/products/:id/edit" element={<ProductForm />} />
      </Routes>
    </MemoryRouter>
  );
  const { rerender } = render(view());

  expect(screen.queryByRole('button', { name: /remove/ })).toBeNull();
  const stockFields = screen.getAllByLabelText('Current Stock');
  expect(stockFields[1]).toHaveValue(8);
  expect(stockFields[1]).toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: 'Rice draft' } });
  await user.click(screen.getAllByRole('button', { name: 'Archive variant' })[1]);

  getProduct.mockReturnValue({ currentData: { data: updated }, refetch: reloadProduct });
  rerender(view());
  // Rerender the same route with fresh query data while keeping the editor mounted.
  expect(screen.getByLabelText(/product name/i)).toHaveValue('Rice draft');

  await user.click(screen.getByRole('button', { name: /^update$/i }));
  const payload = updateProduct.mock.calls[0][0];
  expect(payload).toMatchObject({
    revision: 'first-revision',
    variants: [{ _id: 'small', isActive: true }, { _id: 'large', isActive: false }],
  });
  expect(payload.variants.every((variant) => !Object.hasOwn(variant, 'stock'))).toBe(true);
  expect(await screen.findByRole('alert')).toHaveTextContent('This product changed while you were editing.');
  expect(screen.getByLabelText(/product name/i)).toHaveValue('Rice draft');
  expect(screen.getByRole('button', { name: /^update$/i })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: /reload product and discard edits/i }));
  await waitFor(() => expect(screen.getByLabelText(/product name/i)).toHaveValue('Rice'));
  expect(screen.getAllByLabelText('Current Stock')[1]).toHaveValue(5);
  expect(screen.getAllByRole('button', { name: 'Archive variant' })).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('creates a product with just its name and selling price, using safe defaults', async () => {
  getProduct.mockReturnValue({});
  createProduct.mockReturnValue({ unwrap: async () => ({}) });
  render(<MemoryRouter initialEntries={['/store/products/new']}>
    <Routes>
      <Route path="/store/products/new" element={<ProductForm />} />
      <Route path="/store/products" element={<p>Samaan saved</p>} />
    </Routes>
  </MemoryRouter>);
  expect(screen.getByLabelText('Brand')).toBeInTheDocument();
  expect(screen.getByText('Product Images')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Product Name/), { target: { value: 'Cheeni' } });
  fireEvent.change(screen.getByLabelText(/Retail Price/), { target: { value: '45' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save Product' })[0]);
  await waitFor(() => expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Cheeni', categoryId: null,
    variants: [expect.objectContaining({ name: '1 piece', retailPrice: 45, unit: 'piece', stock: 0 })],
  })));
  expect(await screen.findByText('Samaan saved')).toBeInTheDocument();
});
