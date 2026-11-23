import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'new_order', 'payment_submitted', 'order_cancelled', 'low_stock',
  'stock_mismatch', 'item_missing', 'staff_issue', 'supplier_due', 'customer_due',
  'order_assigned', 'urgent_packing', 'missing_item_update',
  'order_accepted', 'payment_verified', 'packing_started',
  'ready_for_pickup', 'out_for_delivery', 'delivered', 'payment_rejected',
  'packing_completed', 'packing_verified', 'packing_rejected',
];

const notificationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  role: { type: String, enum: ['admin', 'staff', 'customer'], required: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
}, { timestamps: true });

notificationSchema.index({ tenantId: 1, role: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1 });

export default mongoose.model('Notification', notificationSchema);
