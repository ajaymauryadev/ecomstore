import mongoose from 'mongoose';
import { ACCOUNT_PAYMENT_METHODS } from '../utils/paymentMethods.js';

const udharEntrySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'UdharCustomer', required: true, index: true },
  type: { type: String, enum: ['debit', 'credit'], required: true }, // debit=credit given, credit=payment received
  amount: { type: Number, required: true, min: Number.MIN_VALUE },
  method: { type: String, enum: ACCOUNT_PAYMENT_METHODS },
  description: { type: String, trim: true },
  referenceType: { type: String, enum: ['order', 'manual', 'pos_order'], default: 'manual' },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  balanceAfter: { type: Number, default: 0, min: 0 }, // running balance snapshot
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordedByName: { type: String, trim: true },
  recordedByRole: String,
  date: { type: Date, default: Date.now },
  remainingAmount: { type: Number, min: 0 },
  allocations: { type: [{
    debitEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'UdharEntry' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    orderNumber: String,
    amount: { type: Number, min: 0, required: true },
  }], default: undefined },
  allocationMode: { type: String, enum: ['oldest_first', 'bill', 'reconstructed', 'adjustment', 'reversal'] },
  targetOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  paymentSubmission: { type: new mongoose.Schema({ keyHash: String, requestHash: String }, { _id: false }), select: false },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'UdharEntry' },
  voidedAt: Date,
  voidReason: String,
}, {
  timestamps: true,
  toJSON: { transform(_doc, value) { delete value.paymentSubmission; } },
});

udharEntrySchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
udharEntrySchema.index({ tenantId: 1, customerId: 1, date: -1, createdAt: -1, _id: -1 });
udharEntrySchema.index({ tenantId: 1, date: -1 });
udharEntrySchema.index({ tenantId: 1, referenceId: 1, type: 1 });
udharEntrySchema.index({ tenantId: 1, customerId: 1, createdAt: 1, _id: 1 },
  { name: 'pending_udhar_lots', partialFilterExpression: { type: 'debit', remainingAmount: { $gt: 0 } } });
udharEntrySchema.index({ tenantId: 1, customerId: 1, 'allocations.orderId': 1, date: -1, _id: -1 });
udharEntrySchema.index({ tenantId: 1, 'paymentSubmission.keyHash': 1 },
  { unique: true, partialFilterExpression: { 'paymentSubmission.keyHash': { $exists: true } } });
udharEntrySchema.index({ tenantId: 1, reversalOf: 1 },
  { unique: true, partialFilterExpression: { reversalOf: { $exists: true } } });

export default mongoose.model('UdharEntry', udharEntrySchema);
