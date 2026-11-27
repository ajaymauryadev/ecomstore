import mongoose from 'mongoose';
import { actorSnapshotSchema } from './ActorSnapshot.js';

export const PACKING_SESSION_STATUSES = ['in_progress', 'completed', 'verified', 'rejected'];

export const ITEM_PACKING_STATUSES = ['pending', 'picked', 'packed', 'missing'];

export const HIGH_VALUE_KEYWORDS = [
  'almond', 'badam', 'cashew', 'kaju', 'khajoor', 'dates', 'khajur',
  'ghee', 'oil', 'tel', 'saffron', 'kesar', 'zafran',
  'pistachio', 'pista', 'walnut', 'akhrot',
  'raisin', 'kishmish', 'munakka',
  'dry fruit', 'dryfruit', 'mixed nut',
  'cardamom', 'elaichi', 'clove', 'laung',
  'masala', 'spice', 'garam masala',
  'silver', 'gold', 'premium',
];

export function isHighValue(productName) {
  const lc = productName.toLowerCase();
  return HIGH_VALUE_KEYWORDS.some((kw) => lc.includes(kw));
}

const packingItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true },
  variantName: { type: String },
  unit: { type: String },
  image: { type: String },
  requiredQty: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isSafeInteger, message: 'Required quantity must be a whole number' },
  },
  pickedQty: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'Picked quantity must be a whole number' },
  },
  mrp: { type: Number },
  price: { type: Number },
  isHighValue: { type: Boolean, default: false },
  status: { type: String, enum: ITEM_PACKING_STATUSES, default: 'pending' },
  missingReason: { type: String },
  replacementProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  replacementVariantId: { type: mongoose.Schema.Types.ObjectId },
  replacementNote: { type: String },
  pickedAt: { type: Date },
  packedAt: { type: Date },
  markedMissingAt: { type: Date },
  pickedBy: actorSnapshotSchema,
  packedBy: actorSnapshotSchema,
  markedMissingBy: actorSnapshotSchema,
}, { _id: true });

const packingSessionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  orderNumber: { type: String },

  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  staffName: { type: String, required: true },
  staffRole: String,
  completedBy: actorSnapshotSchema,

  items: [packingItemSchema],
  operationReceipts: { type: [{
    operationId: String, payloadHash: String,
    recordedAt: Date, confirmedAt: Date,
    userId: mongoose.Schema.Types.ObjectId,
  }], select: false, default: [] },

  status: { type: String, enum: PACKING_SESSION_STATUSES, default: 'in_progress' },

  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  verifiedAt: { type: Date },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifierName: { type: String },
  verifierRole: String,
  rejectionReason: { type: String },

  staffNotes: { type: String },
  adminNotes: { type: String },

  // Computed on completion
  totalRequired: { type: Number, default: 0 },
  totalPacked: { type: Number, default: 0 },
  totalMissing: { type: Number, default: 0 },
  highValueMissingCount: { type: Number, default: 0 },
}, {
  timestamps: true,
  toJSON: { virtuals: true, transform: (_doc, value) => { delete value.operationReceipts; return value; } },
});

packingSessionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
packingSessionSchema.index({ tenantId: 1, staffId: 1, createdAt: -1 });
packingSessionSchema.index({ orderId: 1 }, { unique: true });

export default mongoose.model('PackingSession', packingSessionSchema);
