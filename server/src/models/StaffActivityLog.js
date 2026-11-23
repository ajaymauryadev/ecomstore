import mongoose from 'mongoose';

export const STAFF_ACTIONS = [
  'packing_started',
  'item_picked',
  'item_packed',
  'item_missing',
  'replacement_suggested',
  'packing_completed',
  'packing_verified',
  'packing_rejected',
  'order_assigned',
  'status_updated',
  'delivery_started',
  'delivery_completed',
];

const staffActivityLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  staffName: { type: String, required: true },
  staffRole: String,

  action: { type: String, enum: STAFF_ACTIONS, required: true },

  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  orderNumber: { type: String },

  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  productName: { type: String },
  variantName: { type: String },

  qty: { type: Number },
  isHighValue: { type: Boolean, default: false },

  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
});

staffActivityLogSchema.index({ tenantId: 1, createdAt: -1 });
staffActivityLogSchema.index({ tenantId: 1, staffId: 1, createdAt: -1 });
staffActivityLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });
staffActivityLogSchema.index({ tenantId: 1, isHighValue: 1, action: 1 });

export default mongoose.model('StaffActivityLog', staffActivityLogSchema);
