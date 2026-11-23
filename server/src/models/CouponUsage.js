import mongoose from 'mongoose';

const couponUsageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
  customerKey: { type: String, required: true, select: false },
  count: { type: Number, required: true, default: 0, min: 0 },
  lastOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
}, { timestamps: true });

couponUsageSchema.index({ tenantId: 1, couponId: 1, customerKey: 1 }, { unique: true });

export default mongoose.model('CouponUsage', couponUsageSchema);
