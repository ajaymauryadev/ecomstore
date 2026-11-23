import { useState } from 'react';
import { Plus, Minus, AlertTriangle } from 'lucide-react';
import { useAdjustStockMutation } from '../../features/inventory/inventoryApi';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

const REASONS = [
  { value: 'damaged', label: 'Damaged', icon: '🔴', type: 'remove' },
  { value: 'expired', label: 'Expired', icon: '⏰', type: 'remove' },
  { value: 'theft_loss', label: 'Theft / Loss', icon: '🚨', type: 'remove' },
  { value: 'counting_mismatch', label: 'Counting Mismatch', icon: '📊', type: 'both' },
  { value: 'free_sample', label: 'Free Sample', icon: '🎁', type: 'remove' },
  { value: 'manual_correction', label: 'Manual Correction', icon: '✏️', type: 'both' },
  { value: 'return_from_customer', label: 'Return from Customer', icon: '↩️', type: 'add' },
  { value: 'supplier_extra_stock', label: 'Supplier Extra Stock', icon: '📦', type: 'add' },
  { value: 'broken_packet', label: 'Broken / Fata Packet', icon: '💔', type: 'remove' },
];

export default function StockAdjustmentModal({ isOpen, onClose, product, variant }) {
  const [adjustmentType, setAdjustmentType] = useState('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [adjustStock, { isLoading }] = useAdjustStockMutation();

  const currentStock = variant?.stock ?? 0;
  const filteredReasons = REASONS.filter(
    (r) => r.type === 'both' || r.type === adjustmentType
  );

  const reset = () => {
    setQuantity('');
    setReason('');
    setNote('');
    setAdjustmentType('add');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!quantity || Number(quantity) <= 0) return toast.error('Enter a valid quantity');
    if (!reason) return toast.error('Select a reason');

    try {
      const result = await adjustStock({
        productId: product._id,
        variantId: variant._id,
        adjustmentType,
        quantity: Number(quantity),
        reason,
        note,
      }).unwrap();

      toast.success(result.message || 'Stock adjusted!');
      handleClose();
    } catch (err) {
      toast.error(err?.data?.message || 'Adjustment failed');
    }
  };

  const newStock = quantity
    ? adjustmentType === 'add'
      ? currentStock + Number(quantity)
      : Math.max(0, currentStock - Number(quantity))
    : null;

  if (!product || !variant) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Stock Adjustment" size="sm">
      <div className="space-y-4">
        {/* Product info */}
        <div className="bg-navy-900 rounded-xl p-3 border border-navy-700/60">
          <p className="text-sm font-semibold text-slate-100">{product.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{variant.name} · Current stock: <span className="text-gold-400 font-bold">{currentStock}</span></p>
        </div>

        {/* Add / Remove toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setAdjustmentType('add'); setReason(''); }}
            className={cn(
              'flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all',
              adjustmentType === 'add'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'bg-navy-800 border-navy-700 text-slate-400 hover:border-navy-600'
            )}
          >
            <Plus size={15} /> Add Stock
          </button>
          <button
            type="button"
            onClick={() => { setAdjustmentType('remove'); setReason(''); }}
            className={cn(
              'flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all',
              adjustmentType === 'remove'
                ? 'bg-red-500/15 border-red-500/40 text-red-400'
                : 'bg-navy-800 border-navy-700 text-slate-400 hover:border-navy-600'
            )}
          >
            <Minus size={15} /> Remove
          </button>
        </div>

        {/* Quantity */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1.5">Quantity</label>
          <input
            type="number"
            min="1"
            max={adjustmentType === 'remove' ? currentStock : undefined}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Enter quantity"
            className="input w-full"
          />
          {newStock !== null && (
            <p className="text-xs text-slate-400 mt-1">
              Stock will change: {currentStock} →{' '}
              <span className={cn(
                'font-bold',
                newStock <= 0 ? 'text-red-400' :
                newStock <= (variant.lowStockLimit || 5) ? 'text-amber-400' : 'text-emerald-400'
              )}>
                {newStock}
              </span>
            </p>
          )}
        </div>

        {/* Reason */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">Reason</label>
          <div className="grid grid-cols-1 gap-1.5">
            {filteredReasons.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setReason(r.value)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm text-left transition-all',
                  reason === r.value
                    ? 'bg-gold-500/10 border-gold-500/40 text-gold-400'
                    : 'bg-navy-800 border-navy-700/60 text-slate-400 hover:border-navy-600 hover:text-slate-300'
                )}
              >
                <span>{r.icon}</span>
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1.5">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any additional notes..."
            rows={2}
            className="input resize-none w-full"
          />
        </div>

        {/* Warn if removing all */}
        {adjustmentType === 'remove' && Number(quantity) >= currentStock && currentStock > 0 && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            <p className="text-xs text-amber-300">This will set stock to zero (out of stock).</p>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" fullWidth onClick={handleClose}>Cancel</Button>
          <Button
            fullWidth
            isLoading={isLoading}
            onClick={handleSubmit}
            variant={adjustmentType === 'remove' ? 'danger' : 'primary'}
          >
            {adjustmentType === 'add' ? 'Add Stock' : 'Remove Stock'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
