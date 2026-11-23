import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import CategoriesPage from './CategoriesPage';

const { getCategories, updateCategory, deleteCategory } = vi.hoisted(() => ({
  getCategories: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

vi.mock('../../../features/categories/categoryApi', () => ({
  useGetCategoriesQuery: getCategories,
  useCreateCategoryMutation: () => [vi.fn(), {}],
  useUpdateCategoryMutation: () => [updateCategory, {}],
  useDeleteCategoryMutation: () => [deleteCategory, {}],
}));

const category = (id, name, fields = {}) => ({
  _id: id, name, parentId: null, parentStatus: 'valid',
  isActive: true, childCount: 0, productCount: 0, productReferenceCount: 0,
  ...fields,
});

const renderCategories = (categories) => {
  getCategories.mockReturnValue({ data: { data: { categories } } });
  render(<CategoriesPage />);
};

beforeEach(() => {
  vi.clearAllMocks();
  updateCategory.mockReturnValue({ unwrap: async () => ({}) });
});

test('offers archive for a parent in use and sends only the visibility change', async () => {
  const user = userEvent.setup();
  renderCategories([
    category('parent', 'Pantry', { childCount: 1 }),
    category('child', 'Rice', { parentId: 'parent' }),
  ]);

  await user.click(screen.getByRole('button', { name: 'Delete Pantry' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Category in Use' }));
  expect(dialog.queryByRole('button', { name: 'Delete' })).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Archive' }));
  expect(updateCategory).toHaveBeenCalledWith({ id: 'parent', isActive: false });
  expect(deleteCategory).not.toHaveBeenCalled();
});

test('shows a legacy orphan and offers a valid parent or top level for explicit repair', async () => {
  const user = userEvent.setup();
  renderCategories([
    category('orphan', 'Rice', { parentId: 'missing', parentStatus: 'missing', childCount: 1 }),
    category('descendant', 'Basmati', { parentId: 'orphan', parentStatus: 'missing' }),
    category('parent', 'Pantry'),
  ]);

  expect(screen.getAllByText('Missing category in parent hierarchy')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Edit Rice' }));
  const picker = screen.getByRole('combobox', { name: 'Parent category' });
  expect(picker).toHaveValue('missing');
  expect(within(picker).queryByRole('option', { name: 'Basmati' })).toBeNull();
  expect(within(picker).getByRole('option', { name: 'Top level' })).toBeEnabled();
  await user.selectOptions(picker, 'parent');
  await user.click(screen.getByRole('button', { name: 'Update' }));
  expect(updateCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'orphan', parentId: 'parent' }));
});
