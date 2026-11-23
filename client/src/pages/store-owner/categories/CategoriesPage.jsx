import { useRef, useState } from 'react';
import { Plus, Edit2, Trash2, GripVertical, Tag } from 'lucide-react';
import {
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
} from '../../../features/categories/categoryApi';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';

const EMOJIS = ['📦', '🌾', '🥛', '🍿', '🧃', '🧹', '💊', '🥩', '🍳', '🧂', '🍬', '🧴', '🫙', '🥚', '🧁', '🫒', '🌿', '🥜', '🍚', '🧆'];

const EMPTY_FORM = { name: '', emoji: '📦', description: '', parentId: '', isActive: true };

function canUseParent(category, editingId, categoriesById) {
  if (category.parentStatus !== 'valid') return false;
  if (!editingId) return true;
  for (let current = category; current; current = categoriesById.get(current.parentId)) {
    if (current._id === editingId) return false;
  }
  return true;
}

function CategoryCard({ category, parent, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 hover:bg-navy-700/20 transition-colors border-b border-navy-700/40 last:border-0">
      <GripVertical size={16} className="text-navy-600 shrink-0 cursor-grab" />

      <div className="w-10 h-10 rounded-xl bg-navy-700/60 flex items-center justify-center text-xl shrink-0">
        {category.emoji}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200">{category.name}</p>
        {parent && <p className="text-xs text-slate-400 mt-0.5">Parent · {parent.name}</p>}
        {category.parentStatus === 'missing' && <p className="text-xs text-amber-400 mt-0.5">Missing category in parent hierarchy</p>}
        {category.parentStatus === 'cycle' && <p className="text-xs text-amber-400 mt-0.5">Cycle in parent hierarchy</p>}
        {category.description && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{category.description}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Badge variant={category.productCount > 0 ? 'info' : 'default'}>
          {category.productCount} product{category.productCount !== 1 ? 's' : ''}
        </Badge>
        <Badge status={category.isActive ? 'active' : 'inactive'} dot>
          {category.isActive ? 'Active' : 'Archived'}
        </Badge>
        <button
          onClick={() => onEdit(category)}
          aria-label={`Edit ${category.name}`}
          className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-400 hover:text-gold-400 transition-colors"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={() => onDelete(category._id)}
          aria-label={`Delete ${category.name}`}
          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const nameInput = useRef(null);

  const { data, isLoading } = useGetCategoriesQuery();
  const [createCategory, { isLoading: isCreating }] = useCreateCategoryMutation();
  const [updateCategory, { isLoading: isUpdating }] = useUpdateCategoryMutation();
  const [deleteCategory, { isLoading: isDeleting }] = useDeleteCategoryMutation();

  const categories = data?.data?.categories || [];
  const categoriesById = new Map(categories.map((category) => [category._id, category]));
  const availableParents = modalOpen
    ? categories.filter((category) => canUseParent(category, editing?._id, categoriesById))
    : [];
  const deleteTarget = categoriesById.get(deleteId);
  const isReferenced = deleteTarget?.childCount > 0 || deleteTarget?.productReferenceCount > 0;
  const isSaving = isCreating || isUpdating;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (cat) => {
    setEditing(cat);
    setForm({
      name: cat.name,
      emoji: cat.emoji || '📦',
      description: cat.description || '',
      parentId: cat.parentId ?? '',
      isActive: cat.isActive,
    });
    setModalOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (!form.name.trim()) return toast.error('Category name is required.');
    const { parentId, isActive, ...details } = form;
    try {
      if (editing) {
        await updateCategory({
          id: editing._id,
          ...details,
          ...(parentId !== (editing.parentId ?? '') && { parentId: parentId || null }),
          ...(isActive !== editing.isActive && { isActive }),
        }).unwrap();
        toast.success('Category updated!');
      } else {
        await createCategory({ ...details, parentId: parentId || null }).unwrap();
        toast.success('Category created!');
      }
      setModalOpen(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Save failed.');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCategory(deleteTarget._id).unwrap();
      toast.success('Category deleted.');
      setDeleteId(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Delete failed.');
    }
  };

  const handleArchive = async () => {
    try {
      await updateCategory({ id: deleteTarget._id, isActive: false }).unwrap();
      toast.success('Category archived.');
      setDeleteId(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Archive failed.');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="text-slate-400 text-sm mt-0.5">{categories.length} categories</p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={openCreate}>
          Add Category
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" className="text-gold-500" /></div>
      ) : categories.length === 0 ? (
        <div className="card p-12 text-center">
          <Tag size={40} strokeWidth={1} className="text-navy-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No categories yet</p>
          <p className="text-slate-500 text-sm mt-1">Create categories to organise your products</p>
          <Button size="sm" leftIcon={<Plus size={14} />} className="mt-4" onClick={openCreate}>
            Add First Category
          </Button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {categories.map((cat) => (
            <CategoryCard key={cat._id} category={cat} parent={categoriesById.get(cat.parentId)} onEdit={openEdit} onDelete={setDeleteId} />
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Category' : 'Add Category'}
        initialFocusRef={nameInput}
        size="sm"
      >
        <form className="space-y-4" onSubmit={handleSave}>
          <div>
            <p id="category-emoji-label" className="text-sm font-medium text-slate-300 mb-2">Emoji</p>
            <div role="group" aria-labelledby="category-emoji-label" className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={form.emoji === e}
                  onClick={() => setForm({ ...form, emoji: e })}
                  className={cn(
                    'w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all',
                    form.emoji === e
                      ? 'bg-gold-500/20 border-2 border-gold-500/50 scale-110'
                      : 'bg-navy-700 border-2 border-transparent hover:bg-navy-600'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <Input
            ref={nameInput}
            label="Category Name"
            name="name"
            maxLength={80}
            placeholder="e.g. Grains & Rice, Dairy, Snacks"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />

          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-300">
            Parent category
            <select
              value={form.parentId}
              onChange={(event) => setForm({ ...form, parentId: event.target.value })}
              className="input"
            >
              <option value="">Top level</option>
              {form.parentId && !availableParents.some((parent) => parent._id === form.parentId) && (
                <option value={form.parentId} disabled>Invalid parent</option>
              )}
              {availableParents.map((parent) => (
                <option key={parent._id} value={parent._id}>
                  {parent.name}{parent.isActive ? '' : ' (archived)'}
                </option>
              ))}
            </select>
          </label>
          {editing && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              Show category in storefront
            </label>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="category-description" className="text-sm font-medium text-slate-300">Description (optional)</label>
            <textarea
              id="category-description"
              name="description"
              maxLength={300}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short description..."
              rows={2}
              className="input resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" fullWidth onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" fullWidth isLoading={isSaving}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteId(null)} title={isReferenced ? 'Category in Use' : 'Delete Category'} size="sm">
        {isReferenced ? (
          <p className="text-slate-300 text-sm">
            Move any products and child categories linked to {deleteTarget.name} before deleting it.
            {' '}Archiving hides this category from the storefront and preserves its references.
          </p>
        ) : (
          <p className="text-slate-300 text-sm">Delete <strong className="text-slate-100">{deleteTarget?.name}</strong>?</p>
        )}
        <div className="flex gap-3 mt-4">
          <Button variant="secondary" fullWidth onClick={() => setDeleteId(null)}>Cancel</Button>
          {isReferenced ? deleteTarget.isActive && (
            <Button fullWidth isLoading={isUpdating} onClick={handleArchive}>Archive</Button>
          ) : (
            <Button variant="danger" fullWidth isLoading={isDeleting} onClick={handleDelete}>Delete</Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
