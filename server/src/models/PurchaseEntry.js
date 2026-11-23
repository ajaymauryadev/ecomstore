import mongoose from 'mongoose';
import { setInvoiceAmounts } from '../utils/invoiceAmounts.js';

export const VEHICLE_TYPES = ['truck', 'pickup', 'tempo', 'cart', 'other'];
export const PAYMENT_STATUSES = ['PAID', 'UNPAID', 'PARTIAL'];

const purchaseItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  productName: { type: String }, // snapshot at purchase time
  variantName: { type: String },
  unit: { type: String },
  quantity: { type: Number, required: true, min: 1 },
  purchasePrice: { type: Number, required: true, min: Number.MIN_VALUE },
  sellingPrice: { type: Number, min: 0 }, // optional selling price override
  totalCost: { type: Number }, // quantity * purchasePrice (computed before save)
  ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockLedger' },
  returnReservedQty: { type: Number, default: 0, min: 0 },
}, { _id: true });

purchaseItemSchema.pre('save', function () {
  this.totalCost = +(this.quantity * this.purchasePrice).toFixed(2);
});

const accountEntrySchema = new mongoose.Schema({
  type: { type: String, enum: ['payment', 'return_credit'], required: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  method: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'cheque'] },
  note: String,
  postedAt: { type: Date, required: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const purchaseEntrySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplierName: { type: String, trim: true }, // snapshot / walk-in supplier name
  invoiceNumber: { type: String, trim: true },
  purchaseDate: { type: Date, default: Date.now },
  vehicleType: { type: String, enum: VEHICLE_TYPES, default: 'other' },
  vehicleNumber: { type: String, trim: true },
  items: { type: [purchaseItemSchema], required: true },
  totalAmount: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  legacyPaidAmount: Number,
  accountEntries: [accountEntrySchema],
  pendingAmount: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'UNPAID' },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'credit'], default: 'cash' },
  note: { type: String, trim: true },
  isStockUpdated: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

purchaseEntrySchema.index({ tenantId: 1, purchaseDate: -1 });
purchaseEntrySchema.index({ tenantId: 1, supplierId: 1, purchaseDate: 1, _id: 1 });
purchaseEntrySchema.index({ tenantId: 1, paymentStatus: 1 });
purchaseEntrySchema.index({ tenantId: 1, 'accountEntries.postedAt': 1 });

// Compute totals before validate
purchaseEntrySchema.pre('validate', function () {
  if (this.items?.length) {
    this.totalAmount = +this.items.reduce((sum, item) => sum + (item.quantity * item.purchasePrice), 0).toFixed(2);
  }
  setInvoiceAmounts(this);
});

export default mongoose.model('PurchaseEntry', purchaseEntrySchema);
