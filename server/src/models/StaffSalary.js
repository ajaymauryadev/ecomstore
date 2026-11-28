import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: Number.MIN_VALUE },
  type: { type: String, enum: ['advance', 'salary', 'bonus'], default: 'salary' },
  method: { type: String, enum: ['cash', 'upi', 'bank_transfer'], default: 'cash' },
  note: { type: String, trim: true },
  paidAt: { type: Date, default: Date.now },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidByName: { type: String },
  operationId: String,
}, { _id: true });

const staffSalarySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  staffName: { type: String, required: true, trim: true },
  staffPhone: { type: String, trim: true },
  monthYear: { type: String, required: true }, // YYYY-MM
  monthlySalary: { type: Number, required: true, min: Number.MIN_VALUE },
  advancePaid: { type: Number, default: 0, min: 0 },
  totalPaid: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  payments: [paymentSchema],
  notes: { type: String, trim: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

staffSalarySchema.virtual('dueAmount').get(function () {
  return Math.max(0, this.monthlySalary - this.totalPaid);
});

staffSalarySchema.index({ tenantId: 1, monthYear: -1 });
staffSalarySchema.index({ tenantId: 1, 'payments.paidAt': 1 });
staffSalarySchema.index({ tenantId: 1, staffId: 1, monthYear: -1 });
staffSalarySchema.index({ tenantId: 1, staffId: 1, monthYear: 1 }, { unique: true });

export default mongoose.model('StaffSalary', staffSalarySchema);
