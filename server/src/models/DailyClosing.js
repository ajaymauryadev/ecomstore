import mongoose from 'mongoose';

export const EXPENSE_CATEGORIES = ['rent', 'salary', 'utilities', 'petty_cash', 'supplier_payment', 'other'];

const expenseSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: Number.MIN_VALUE },
  category: { type: String, enum: EXPENSE_CATEGORIES, default: 'other' },
}, { _id: true });

const movementSchema = new mongoose.Schema({
  sales: Number,
  udharCollections: Number,
  supplierPayments: Number,
  refunds: Number,
  expenses: Number,
  inflow: Number,
  outflow: Number,
  net: Number,
}, { _id: false });

const snapshotFields = {
  cashSales: { type: Number, default: 0 },
  upiSales: { type: Number, default: 0 },
  onlineSales: { type: Number, default: 0 },
  creditSales: { type: Number, default: 0 },
  totalSales: { type: Number, default: 0 },
  ordersCount: { type: Number, default: 0 },
  returnsTotal: { type: Number, default: 0 },
  supplierPayments: { type: Number, default: 0 },
  movements: {
    cash: movementSchema,
    upi: movementSchema,
    bank: movementSchema,
    other: movementSchema,
    unclassified: movementSchema,
  },

  // Physical cash counts and legacy notes on manually entered expenses
  openingCash: { type: Number, default: 0 },
  closingCash: { type: Number, default: 0 },
  expenses: [expenseSchema],
  totalExpenses: { type: Number, default: 0 },

  expectedClosingCash: { type: Number, default: 0 },
  cashDifference: { type: Number, default: 0 },
  notes: { type: String, trim: true },
};

const closingSnapshotSchema = new mongoose.Schema(snapshotFields, { _id: false });
const correctionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true },
  correctedAt: { type: Date, required: true },
  previous: { type: closingSnapshotSchema, required: true },
  revised: { type: closingSnapshotSchema, required: true },
});

const dailyClosingSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  date: { type: Date, required: true },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  closedByName: { type: String, required: true },
  closedAt: Date,
  status: { type: String, enum: ['draft', 'closed'], default: 'closed' },
  version: { type: Number, default: 0 },
  finalizedFromVersion: Number,
  corrections: [correctionSchema],
  ...snapshotFields,
}, { timestamps: true });

dailyClosingSchema.index({ tenantId: 1, date: -1 }, { unique: true });

export function closingSnapshot(record) {
  const value = record.toObject();
  return Object.fromEntries(Object.keys(snapshotFields).map((field) => [field, value[field]]));
}

export default mongoose.model('DailyClosing', dailyClosingSchema);
