import mongoose from 'mongoose';

export const AUDIT_ACTIONS = [
  'product_created', 'product_updated', 'product_deleted', 'price_changed',
  'stock_adjusted', 'purchase_added',
  'order_created', 'order_packed', 'order_delivered', 'order_cancelled',
  'payment_verified', 'payment_rejected',
  'salary_paid', 'expense_added', 'expense_updated', 'expense_archived',
  'daily_closing_corrected',
  'return_created', 'return_processed',
  'pos_bill_created',
  'udhar_payment_received',
  'udhar_payment_reversed',
  'staff_action', 'admin_login',
  'coupon_created', 'offer_created',
  'store_updated',
  'plan_changed',
];

const auditLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },
  action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
  performedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    role: { type: String },
  },
  resource: {
    type: { type: String },
    id: { type: mongoose.Schema.Types.ObjectId },
    label: { type: String },
  },
  changes: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String },
  description: { type: String },
}, { timestamps: true });

auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ 'performedBy.userId': 1 });

export default mongoose.model('AuditLog', auditLogSchema);
