import mongoose from 'mongoose';

export const OFFER_TYPES = ['combo', 'festival_pack', 'ration_pack', 'buy_x_get_y', 'wholesale', 'bulk'];

const offerSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  type: { type: String, enum: OFFER_TYPES, required: true },
  image: { type: String },

  // combo / festival_pack / ration_pack
  bundleItems: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String },
    variantName: { type: String },
    quantity: { type: Number, default: 1, min: 1 },
  }],
  bundlePrice: { type: Number, min: Number.MIN_VALUE },

  // buy_x_get_y
  buyQuantity: { type: Number, min: 1 },
  getQuantity: { type: Number, min: 1 },
  buyProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  buyVariantId: { type: mongoose.Schema.Types.ObjectId },
  getProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  getVariantId: { type: mongoose.Schema.Types.ObjectId },

  // wholesale / bulk — tiered pricing
  tiers: [{
    minQuantity: { type: Number, min: 1 },
    pricePerUnit: { type: Number, min: Number.MIN_VALUE },
    discountPercent: { type: Number, min: 0, max: 100 },
  }],
  targetProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  targetVariantId: { type: mongoose.Schema.Types.ObjectId },

  minOrderValue: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  startsAt: { type: Date },
  expiresAt: { type: Date },
  displayOrder: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('Offer', offerSchema);
