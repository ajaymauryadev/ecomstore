import mongoose from 'mongoose';
import crypto from 'crypto';

export const RETURN_TYPES = ['customer_return', 'purchase_return'];
export const RETURN_STATUSES = ['pending', 'approved', 'rejected', 'processed'];
export const ACTIVE_RETURN_STATUSES = ['pending', 'approved', 'processed'];
export const REFUND_METHODS = ['cash', 'upi', 'store_credit', 'exchange', 'no_refund'];
export const ITEM_CONDITIONS = ['good', 'damaged', 'opened'];

const returnItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String, required: true },
  variantName: { type: String },
  unit: { type: String },
  qty: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, default: 0 },
  refundAmount: { type: Number, default: 0 },
  reason: { type: String, trim: true },
  condition: { type: String, enum: ITEM_CONDITIONS, default: 'good' },
  restockItem: { type: Boolean, default: true },
}, { _id: true });

const exchangeItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String },
  variantName: { type: String },
  qty: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, default: 0 },
  unitCost: { type: Number, min: 0, select: false },
}, { _id: true });

const returnSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  returnNumber: { type: String, index: true },
  type: { type: String, enum: RETURN_TYPES, required: true },
  status: { type: String, enum: RETURN_STATUSES, default: 'pending' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String, required: true },

  // Customer return
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  orderNumber: { type: String },
  customerInfo: {
    name: { type: String },
    phone: { type: String },
  },
  items: [returnItemSchema],
  refundMethod: { type: String, enum: REFUND_METHODS },
  totalRefundAmount: { type: Number, default: 0 },
  exchangeItems: [exchangeItemSchema],
  totalExchangeAmount: { type: Number, default: 0 },
  netRefund: { type: Number, default: 0 },

  // Purchase return
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplierName: { type: String },
  purchaseEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseEntry' },
  totalValue: { type: Number, default: 0 },
  adjustSupplierBalance: { type: Boolean, default: true },

  notes: { type: String, trim: true },
  processedAt: { type: Date },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  processedByName: { type: String },
  reservationClaimed: { type: Boolean, default: false },
  approvalSequence: Number,
}, {
  timestamps: true,
  toJSON: {
    transform(_document, value) {
      for (const item of value.exchangeItems ?? []) delete item.unitCost;
    },
  },
});

returnSchema.index({ tenantId: 1, createdAt: -1 });
returnSchema.index({ tenantId: 1, type: 1, status: 1 });
returnSchema.index({ tenantId: 1, orderId: 1, status: 1 });
returnSchema.index({ tenantId: 1, type: 1, status: 1, processedAt: 1 });

returnSchema.pre('save', function (next) {
  if (!this.isNew || this.returnNumber) return next();
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  this.returnNumber = `RET-${ds}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  next();
});

export default mongoose.model('Return', returnSchema);
