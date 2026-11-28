import mongoose from 'mongoose';
import { ACCOUNT_PAYMENT_METHODS } from '../utils/paymentMethods.js';

export const EXPENSE_CATEGORIES = [
  'rent', 'electricity', 'transport', 'packaging',
  'staff_salary', 'damage_loss', 'maintenance', 'marketing', 'other',
];

const expenseSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
  amount: { type: Number, required: true, min: Number.MIN_VALUE },
  method: { type: String, enum: ACCOUNT_PAYMENT_METHODS },
  description: { type: String, trim: true },
  name: { type: String, trim: true },
  paidTo: { type: String, trim: true },
  operationId: String,
  date: { type: Date, required: true, default: Date.now },
  receiptUrl: { type: String, trim: true, default: null },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordedByName: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
});

expenseSchema.index({ tenantId: 1, date: -1 });
expenseSchema.index({ tenantId: 1, category: 1 });
expenseSchema.index({ tenantId: 1, operationId: 1 }, { unique: true, partialFilterExpression: { operationId: { $type: 'string' } } });

export default mongoose.model('Expense', expenseSchema);
