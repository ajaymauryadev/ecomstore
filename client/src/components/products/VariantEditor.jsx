import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, GripVertical, Tag } from 'lucide-react';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { UNIT_GROUPS } from '../../constants/units';
import { cn } from '../../utils/cn';

const EMPTY_VARIANT = () => ({
  _tempId: Math.random().toString(36).slice(2),
  name: '',
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
});

function MarginBadge({ retail, purchase }) {
  const r = parseFloat(retail);
  const p = parseFloat(purchase);
  if (!r || !p || r <= 0) return null;
  const margin = ((r - p) / r) * 100;
  const color = margin >= 20 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : margin >= 10 ? 'text-gold-400 bg-gold-500/10 border-gold-500/20'
    : 'text-red-400 bg-red-500/10 border-red-500/20';
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border', color)}>
      <Tag size={10} />
      {margin.toFixed(1)}% margin
    </span>
  );
}

function VariantCard({ variant, index, onChange, onRemove, canRemove }) {
  const [open, setOpen] = useState(true);

  const update = (field, value) => onChange({ ...variant, [field]: value });

  return (
    <div className={cn(
      'border rounded-2xl transition-all duration-200 overflow-hidden',
      open ? 'border-navy-600 bg-navy-800/50' : 'border-navy-700/60 bg-navy-800/30'
    )}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <GripVertical size={16} className="text-navy-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-200 truncate block">
            {variant.name || `Variant ${index + 1}`}
          </span>
          {!open && variant.retailPrice && (
            <span className="text-xs text-gold-400">₹{variant.retailPrice}</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {(!open || !variant.isActive) && (
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full border',
              variant.isActive
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-slate-500 bg-navy-700 border-navy-600'
            )}>
              {variant.isActive ? 'Active' : 'Archived'}
            </span>
          )}
          {canRemove && (
            <button
              type="button"
              aria-label="Remove unsaved variant"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
          {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-navy-700/40 pt-4">
          {/* Row 1: Name + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Variant Name"
              placeholder="e.g. 1kg, ₹1 Sachet, 250g"
              value={variant.name}
              onChange={(e) => update('name', e.target.value)}
              required
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-300">Unit <span className="text-gold-500">*</span></label>
              <select
                value={variant.unit}
                onChange={(e) => update('unit', e.target.value)}
                className="input"
              >
                {UNIT_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.units.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Prices */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Pricing</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Input
                label="Retail Price ₹"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={variant.retailPrice}
                onChange={(e) => update('retailPrice', e.target.value)}
                required
              />
              <Input
                label="Wholesale Price ₹"
                type="number"
                min="0"
                step="0.01"
                placeholder="Optional"
                value={variant.wholesalePrice}
                onChange={(e) => update('wholesalePrice', e.target.value)}
              />
              <Input
                label="Offer Price ₹"
                type="number"
                min="0"
                step="0.01"
                placeholder="Sale price"
                value={variant.offerPrice}
                onChange={(e) => update('offerPrice', e.target.value)}
                hint={variant.offerPrice && variant.retailPrice
                  ? `${Math.round(((variant.retailPrice - variant.offerPrice) / variant.retailPrice) * 100)}% off`
                  : undefined}
              />
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Purchase Price ₹"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Cost"
                  value={variant.purchasePrice}
                  onChange={(e) => update('purchasePrice', e.target.value)}
                />
                <MarginBadge retail={variant.retailPrice} purchase={variant.purchasePrice} />
              </div>
            </div>
          </div>

          {/* Row 3: Stock */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Stock</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={variant._id ? "Current Stock" : "Initial Stock"}
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={variant.stock}
                readOnly={Boolean(variant._id)}
                hint={variant._id ? 'Use Inventory to adjust stock.' : undefined}
                onChange={(e) => update('stock', Number(e.target.value))}
              />
              <Input
                label="Low Stock Alert"
                type="number"
                min="0"
                step="1"
                placeholder="5"
                value={variant.lowStockLimit}
                onChange={(e) => update('lowStockLimit', parseInt(e.target.value) || 0)}
                hint="Alert when stock drops below this"
              />
            </div>
          </div>

          {/* Row 4: SKU / Barcode */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="SKU"
              placeholder="Optional"
              value={variant.sku}
              onChange={(e) => update('sku', e.target.value)}
            />
            <Input
              label="Barcode"
              placeholder="Optional"
              value={variant.barcode}
              onChange={(e) => update('barcode', e.target.value)}
            />
          </div>

          {variant._id && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => update('isActive', !variant.isActive)}
            >
              {variant.isActive ? 'Archive variant' : 'Reactivate variant'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function VariantEditor({ variants = [], onChange }) {
  const addVariant = () => onChange([...variants, EMPTY_VARIANT()]);

  const updateVariant = (index, updated) => {
    const next = [...variants];
    next[index] = updated;
    onChange(next);
  };

  const removeVariant = (index) => {
    onChange(variants.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {variants.map((v, i) => (
        <VariantCard
          key={v._id || v._tempId || i}
          variant={v}
          index={i}
          onChange={(updated) => updateVariant(i, updated)}
          onRemove={() => removeVariant(i)}
          canRemove={!v._id && variants.length > 1}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        size="md"
        fullWidth
        leftIcon={<Plus size={16} />}
        onClick={addVariant}
        className="border-dashed border-navy-500 hover:border-gold-500/50 hover:text-gold-400"
      >
        Add Another Variant
      </Button>
    </div>
  );
}
