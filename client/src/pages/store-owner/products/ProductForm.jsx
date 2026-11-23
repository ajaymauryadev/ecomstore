import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import {
  useCreateProductMutation,
  useUploadImageMutation,
  useUpdateProductMutation,
  useGetProductQuery,
} from '../../../features/products/productApi';
import { useGetCategoriesQuery } from '../../../features/categories/categoryApi';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import VariantEditor from '../../../components/products/VariantEditor';
import ImageUploader from '../../../components/products/ImageUploader';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';

const EMPTY_PRODUCT = () => ({
  name: '',
  brand: '',
  categoryId: '',
  description: '',
  images: [],
  variants: [
    {
      _tempId: Math.random().toString(36).slice(2),
      name: '1 piece',
      unit: 'piece',
      retailPrice: '',
      wholesalePrice: '',
      offerPrice: '',
      purchasePrice: '',
      stock: 0,
      lowStockLimit: 5,
      sku: '',
      barcode: '',
      isActive: true,
    },
  ],
  isActive: true,
  isOnline: true,
  isFeatured: false,
  tags: '',
});

function Section({ title, children, className }) {
  return (
    <div className={cn('card p-5 space-y-4', className)}>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</h3>
      {children}
    </div>
  );
}

function Toggle({ label, description, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          value ? 'bg-gold-500' : 'bg-navy-600'
        )}
      >
        <span className={cn(
          'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
          value ? 'translate-x-5.5' : 'translate-x-0.5'
        )} style={{ transform: value ? 'translateX(1.375rem)' : 'translateX(0.125rem)' }} />
      </button>
    </label>
  );
}

function formFromProduct({ product, revision }) {
  return {
    revision,
    name: product.name || '',
    brand: product.brand || '',
    categoryId: product.categoryId?._id || product.categoryId || '',
    description: product.description || '',
    images: product.images || [],
    variants: product.variants.map((variant) => ({
      ...variant,
      retailPrice: variant.retailPrice ?? '',
      wholesalePrice: variant.wholesalePrice ?? '',
      offerPrice: variant.offerPrice ?? '',
      purchasePrice: variant.purchasePrice ?? '',
    })),
    isActive: product.isActive ?? true,
    isOnline: product.isOnline ?? true,
    isFeatured: product.isFeatured ?? false,
    tags: (product.tags || []).join(', '),
  };
}

export default function ProductForm() {
  const { id } = useParams();
  const { currentData, isFetching, error, refetch } = useGetProductQuery(id, { skip: !id });

  if (id && !currentData?.data?.product) {
    if (isFetching) return <p role="status" className="py-16 text-center text-slate-400">Loading product...</p>;
    return (
      <div className="py-16 text-center space-y-3">
        <p role="alert" className="text-red-400">{error?.data?.message || 'Could not load the product.'}</p>
        <Button type="button" onClick={refetch}>Try again</Button>
      </div>
    );
  }

  return <ProductEditor key={id ?? 'new'} id={id} initialData={currentData?.data} reloadProduct={refetch} />;
}

function ProductEditor({ id, initialData, reloadProduct }) {
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(() => isEdit ? formFromProduct(initialData) : EMPTY_PRODUCT());
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState('');
  const [isReloading, setIsReloading] = useState(false);
  const { data: catData } = useGetCategoriesQuery();
  const [createProduct, { isLoading: isCreating }] = useCreateProductMutation();
  const [updateProduct, { isLoading: isUpdating }] = useUpdateProductMutation();

  const categories = catData?.data?.categories || [];
  const [uploadImage, { isLoading: isUploading }] = useUploadImageMutation();
  const isSaving = isCreating || isUpdating;

  const reloadAfterConflict = async () => {
    setIsReloading(true);
    try {
      const { data } = await reloadProduct().unwrap();
      setForm(formFromProduct(data));
      setErrors({});
      setConflict('');
    } catch (err) {
      toast.error(err?.data?.message || 'Could not reload the product.');
    } finally {
      setIsReloading(false);
    }
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Product name is required';
    if (!form.variants.length) e.variants = 'At least one variant is required';
    form.variants.forEach((v, i) => {
      if (!v.name?.trim()) e[`variant_${i}_name`] = 'Variant name required';
      if (!Number.isFinite(Number(v.retailPrice)) || Number(v.retailPrice) <= 0) e[`variant_${i}_price`] = 'Enter a valid selling price greater than zero.';
      if (!v._id && (!Number.isInteger(Number(v.stock)) || Number(v.stock) < 0)) e[`variant_${i}_stock`] = 'Enter stock as a whole number, zero or more.';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildPayload = () => ({
    ...(isEdit && { revision: form.revision }),
    name: form.name.trim(),
    brand: form.brand.trim(),
    categoryId: form.categoryId || null,
    description: form.description.trim(),
    images: form.images,
    variants: form.variants.map((v) => ({
      ...(v._id && { _id: v._id }),
      name: v.name,
      unit: v.unit,
      retailPrice: parseFloat(v.retailPrice),
      wholesalePrice: v.wholesalePrice ? parseFloat(v.wholesalePrice) : null,
      offerPrice: v.offerPrice ? parseFloat(v.offerPrice) : null,
      purchasePrice: v.purchasePrice ? parseFloat(v.purchasePrice) : null,
      ...(!v._id && { stock: Number(v.stock) }),
      lowStockLimit: v.lowStockLimit ?? 5,
      sku: v.sku || '',
      barcode: v.barcode || '',
      isActive: v.isActive,
    })),
    isActive: form.isActive,
    isOnline: form.isOnline,
    isFeatured: form.isFeatured,
    tags: form.tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSaving || isUploading || conflict) return;
    if (!validate()) {
      toast.error('Please fix the errors below.');
      return;
    }

    try {
      const payload = buildPayload();
      if (isEdit) {
        const { data } = await updateProduct({ id, ...payload }).unwrap();
        setForm(formFromProduct(data));
        toast.success('Product updated successfully!');
      } else {
        await createProduct(payload).unwrap();
        toast.success('Product created successfully!');
        navigate('/store/products');
      }
    } catch (err) {
      const msg = err?.data?.message || 'Save failed. Please try again.';
      if (isEdit && err?.status === 409) {
        setConflict(msg);
        return;
      }
      toast.error(msg);
      if (err?.data?.errors) {
        const apiErrors = {};
        err.data.errors.forEach((e) => { apiErrors[e.field] = e.message; });
        setErrors(apiErrors);
      }
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/store/products')}
            className="p-2 rounded-xl hover:bg-navy-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-100">
              {isEdit ? 'Edit Product' : 'Add Product'}
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {isEdit ? 'Update product details and variants' : 'Enter the name, price and stock. Other details are optional.'}
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={handleSubmit}
          isLoading={isSaving}
          disabled={isSaving || isUploading || Boolean(conflict)}
          leftIcon={<Save size={16} />}
          size="md"
        >
          {isEdit ? 'Update' : 'Save Product'}
        </Button>
      </div>

      {conflict && (
        <div className="card mb-5 p-4 space-y-3">
          <p role="alert" className="text-amber-300">{conflict}</p>
          <Button type="button" variant="secondary" isLoading={isReloading} onClick={reloadAfterConflict}>
            Reload product and discard edits
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="space-y-5" disabled={isSaving || isReloading}>
          {/* Basic Info */}
          <Section title="Basic Information">
            <Input
              label="Product Name"
              placeholder="e.g. Aashirvaad Atta, Amul Butter"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              error={errors.name}
              required
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Brand"
                placeholder="e.g. Amul, Nestlé"
                value={form.brand}
                onChange={(e) => updateField('brand', e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-300">Category</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => updateField('categoryId', e.target.value)}
                  className="input"
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c._id} value={c._id}>{c.emoji} {c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-300">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Optional product description..."
                rows={3}
                className="input resize-none"
              />
            </div>

            <Input
              label="Tags"
              placeholder="Comma separated: dairy, fresh, organic"
              value={form.tags}
              onChange={(e) => updateField('tags', e.target.value)}
              hint="Helps with search"
            />
          </Section>

          {/* Images */}
          <Section title="Product Images">
            <ImageUploader
              images={form.images}
              uploadImage={uploadImage}
              uploading={isUploading}
              onChange={(images) => updateField('images', images)}
            />
          </Section>

          {/* Variants */}
          <Section title="Pricing & Variants">
            {errors.variants && (
              <p className="text-red-400 text-xs">{errors.variants}</p>
            )}
            <VariantEditor
              variants={form.variants}
              onChange={(variants) => updateField('variants', variants)}
            />
          </Section>

          {/* Settings */}
          <Section title="Product Settings">
            <div className="space-y-1 divide-y divide-navy-700/60">
              <Toggle
                label="Active Product"
                description="Inactive products are hidden from POS and orders"
                value={form.isActive}
                onChange={(v) => updateField('isActive', v)}
              />
              <div className="pt-1">
                <Toggle
                  label="Visible Online"
                  description="Show on customer-facing storefront"
                  value={form.isOnline}
                  onChange={(v) => updateField('isOnline', v)}
                />
              </div>
              <div className="pt-1">
                <Toggle
                  label="Featured Product"
                  description="Shown prominently on storefront homepage"
                  value={form.isFeatured}
                  onChange={(v) => updateField('isFeatured', v)}
                />
              </div>
            </div>
          </Section>

          {Object.values(errors).some(Boolean) && <p role="alert" className="workspace-feedback text-sm">{Object.values(errors).filter(Boolean).join(' · ')}</p>}
          {/* Bottom save */}
          <div className="flex gap-3 pb-8">
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => navigate('/store/products')}
            >
              Cancel
            </Button>
            <Button type="submit" fullWidth isLoading={isSaving} disabled={isSaving || isUploading || Boolean(conflict)} leftIcon={<Save size={16} />}>
              {isEdit ? 'Update Product' : 'Save Product'}
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
