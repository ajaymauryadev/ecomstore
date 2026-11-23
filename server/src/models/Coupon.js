import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, trim: true },
  type: { type: String, enum: ['percent', 'flat'], required: true },
  value: { type: Number, required: true, min: Number.MIN_VALUE, validate: {
    validator(value) { return this.type !== 'percent' || value <= 100; },
    message: 'Percentage coupon value cannot exceed 100',
  } },
  maxDiscount: { type: Number, min: 0 },
  minOrderValue: { type: Number, default: 0, min: 0 },
  usageLimitTotal: { type: Number, min: 1 },
  usageLimitPerUser: { type: Number, default: 1, min: 1 },
  usedCount: { type: Number, default: 0, min: 0 },
  usedByCustomers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  applicableOrderTypes: [{
    type: String,
    enum: ['home_delivery', 'self_pickup', 'online', 'counter', 'wholesale'],
  }],
  applicableProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  applicableCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  applicableCustomerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true },
  expiresAt: { type: Date },
  startsAt: { type: Date },
}, { timestamps: true });

couponSchema.index({ tenantId: 1, code: 1 }, { unique: true });

couponSchema.virtual('isValid').get(function () {
  const now = new Date();
  if (!this.isActive) return false;
  if (this.expiresAt && this.expiresAt < now) return false;
  if (this.startsAt && this.startsAt > now) return false;
  if (this.usageLimitTotal && this.usedCount >= this.usageLimitTotal) return false;
  return true;
});

export default mongoose.model('Coupon', couponSchema);
