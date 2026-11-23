import mongoose from 'mongoose';

export const PLAN_NAMES = ['trial', 'basic', 'premium', 'enterprise'];

export const ALL_MODULES = [
  'pos', 'inventory', 'purchases', 'suppliers',
  'packing', 'returns', 'daily_closing',
  'accounting', 'reports', 'storefront',
  'coupons', 'offers',
];

const planSchema = new mongoose.Schema({
  name: { type: String, enum: PLAN_NAMES, required: true, unique: true },
  displayName: { type: String, required: true },
  description: { type: String },
  price: { type: Number, default: 0, min: 0 },
  billingCycle: { type: String, enum: ['monthly', 'yearly', 'lifetime'], default: 'monthly' },
  trialDays: { type: Number, default: 0, min: 0 },
  durationDays: { type: Number, default: 30, min: 1 },

  limits: {
    maxProducts: { type: Number, default: 100 },
    maxOrdersPerMonth: { type: Number, default: 500 },
    maxStaff: { type: Number, default: 3 },
    maxStorageGB: { type: Number, default: 1 },
    maxCustomers: { type: Number, default: 500 },
  },

  modules: {
    type: [String],
    enum: ALL_MODULES,
    default: ['pos', 'inventory', 'storefront'],
  },

  isActive: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  color: { type: String, default: '#f59e0b' },
  badge: { type: String },
}, { timestamps: true });

export default mongoose.model('Plan', planSchema);
