import mongoose from 'mongoose';

const allocationSchema = new mongoose.Schema({
  purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseEntry', required: true },
  invoiceNumber: String,
  amount: { type: Number, required: true, min: 0.01 },
}, { _id: false });

const paymentHistorySchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  method: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'credit'], default: 'cash' },
  note: { type: String, trim: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidAt: Date,
  targetPurchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseEntry' },
  allocations: { type: [allocationSchema], default: undefined },
}, { timestamps: true });

const supplierSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  altPhone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  address: {
    line1: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  gstNumber: { type: String, trim: true, uppercase: true },
  companyName: { type: String, trim: true },
  bankDetails: {
    accountName: String,
    accountNumber: String,
    ifsc: String,
    bankName: String,
    upiId: String,
  },
  pendingAmount: { type: Number, default: 0 },
  totalPurchased: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  paymentHistory: [paymentHistorySchema],
  isActive: { type: Boolean, default: true },
  notes: { type: String, trim: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

supplierSchema.index({ tenantId: 1, name: 1 });
supplierSchema.index({ tenantId: 1, phone: 1 });
supplierSchema.index({ tenantId: 1, 'paymentHistory.paidAt': 1 });

supplierSchema.virtual('purchaseCount', {
  ref: 'PurchaseEntry',
  localField: '_id',
  foreignField: 'supplierId',
  count: true,
});

export default mongoose.model('Supplier', supplierSchema);
