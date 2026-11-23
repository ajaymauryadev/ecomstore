import mongoose from 'mongoose';

export const MOVEMENT_TYPES = [
  'PURCHASE_IN',
  'ORDER_RESERVED',
  'ORDER_SOLD',
  'ORDER_CANCEL_RESTORE',
  'DAMAGE_OUT',
  'ADJUSTMENT_ADD',
  'ADJUSTMENT_REMOVE',
  'RETURN_IN',
  'PURCHASE_RETURN',
];

export const ADJUSTMENT_REASONS = [
  'damaged',
  'expired',
  'theft_loss',
  'counting_mismatch',
  'free_sample',
  'manual_correction',
  'return_from_customer',
  'supplier_extra_stock',
  'broken_packet',
];

export const ADJUSTMENT_REASON_LABELS = {
  damaged: 'Damaged',
  expired: 'Expired',
  theft_loss: 'Theft / Loss',
  counting_mismatch: 'Counting Mismatch',
  free_sample: 'Free Sample',
  manual_correction: 'Manual Correction',
  return_from_customer: 'Return from Customer',
  supplier_extra_stock: 'Supplier Extra Stock',
  broken_packet: 'Broken / Fata Packet',
};

const stockLedgerSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  movementType: { type: String, enum: MOVEMENT_TYPES, required: true },
  quantityChange: { type: Number, required: true }, // positive = in, negative = out
  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId }, // PurchaseEntry / Order / etc.
  referenceType: { type: String, enum: ['PurchaseEntry', 'Order', 'StockAdjustment', 'Manual', 'Return'] },
  reason: { type: String, enum: ADJUSTMENT_REASONS },
  note: { type: String, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

stockLedgerSchema.index({ tenantId: 1, productId: 1, variantId: 1, createdAt: -1 });
stockLedgerSchema.index({ tenantId: 1, movementType: 1, createdAt: -1 });
stockLedgerSchema.index({ referenceId: 1, referenceType: 1 });

export default mongoose.model('StockLedger', stockLedgerSchema);
