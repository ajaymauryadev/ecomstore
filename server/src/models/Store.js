import mongoose from 'mongoose';

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Store name is required'],
      trim: true,
      maxlength: [100, 'Store name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Store slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers and hyphens'],
      minlength: [3, 'Slug must be at least 3 characters'],
      maxlength: [50, 'Slug cannot exceed 50 characters'],
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    address: {
      street: String,
      city: { type: String, default: '' },
      state: String,
      pincode: String,
      country: { type: String, default: 'India' },
    },
    contact: {
      phone: String,
      email: String,
      whatsapp: String,
    },
    branding: {
      logo: String,
      banner: String,
      primaryColor: { type: String, default: '#f59e0b' },
      tagline: String,
    },
    settings: {
      currency: { type: String, default: 'INR' },
      timezone: { type: String, default: 'Asia/Kolkata' },
      taxRate: { type: Number, default: 5, min: 0, max: 100 },
      lowStockThreshold: { type: Number, default: 10, min: 0 },
      orderPrefix: { type: String, default: 'ORD' },
      allowCustomerOrders: { type: Boolean, default: true },
      requirePinForSales: { type: Boolean, default: false },
    },
    paymentSettings: {
      upiId: { type: String },
      upiName: { type: String },
      upiQrUrl: { type: String },
      bankAccount: { type: String },
      bankIfsc: { type: String },
      bankName: { type: String },
      bankAccountName: { type: String },
    },
    deliverySettings: {
      areas: [{
        name: { type: String },
        charge: { type: Number, default: 0, min: 0 },
        minOrder: { type: Number, default: 0, min: 0 },
      }],
      defaultCharge: { type: Number, default: 40, min: 0 },
      freeDeliveryAbove: { type: Number, default: 0, min: 0 },
      minOrderAmount: { type: Number, default: 0, min: 0 },
    },
    businessHours: {
      openTime: { type: String, default: '09:00' },
      closeTime: { type: String, default: '22:00' },
      pickupOpenTime: { type: String, default: '09:00' },
      pickupCloseTime: { type: String, default: '21:00' },
      closedDays: [{ type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }],
    },
    orderSettings: {
      isAcceptingOrders: { type: Boolean, default: true },
      autoAccept: { type: Boolean, default: false },
      allowGuest: { type: Boolean, default: true },
    },
    taxSettings: {
      enableGST: { type: Boolean, default: false },
      gstNumber: { type: String },
      cgstPercent: { type: Number, default: 0, min: 0, max: 100 },
      sgstPercent: { type: Number, default: 0, min: 0, max: 100 },
    },
    subscription: {
      plan: {
        type: String,
        enum: ['trial', 'basic', 'premium', 'enterprise', 'free', 'starter', 'pro'],
        default: 'trial',
      },
      planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
      startedAt: { type: Date, default: Date.now },
      expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      isActive: { type: Boolean, default: true },
      paymentRef: { type: String },
    },
    moduleSettings: {
      enabledModules: {
        type: [String],
        default: ['pos', 'inventory', 'purchases', 'suppliers', 'packing', 'returns', 'daily_closing', 'accounting', 'reports', 'storefront', 'coupons', 'offers'],
      },
    },
    limits: {
      maxProducts: { type: Number, default: 100, min: 1 },
      maxOrdersPerMonth: { type: Number, default: 500, min: 1 },
      maxStaff: { type: Number, default: 5, min: 1 },
      maxCustomers: { type: Number, default: 1000, min: 1 },
    },
    supportAccess: [{
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      adminName: { type: String },
      accessedAt: { type: Date, default: Date.now },
      reason: { type: String },
      ip: { type: String },
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
    staffCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    customerCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    categoryRevision: { type: Number, select: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

storeSchema.index({ ownerId: 1 });
storeSchema.index({ 'subscription.isActive': 1 });
storeSchema.index({ isActive: 1 });

storeSchema.pre('validate', function validateFinancialSettings(next) {
  const monetaryValues = [
    this.deliverySettings?.defaultCharge,
    this.deliverySettings?.freeDeliveryAbove,
    this.deliverySettings?.minOrderAmount,
    ...(this.deliverySettings?.areas || []).flatMap((area) => [area.charge, area.minOrder]),
  ];
  const percentages = [
    this.settings?.taxRate,
    this.taxSettings?.cgstPercent,
    this.taxSettings?.sgstPercent,
  ];
  if ([...monetaryValues, ...percentages].some((value) => value != null && !Number.isFinite(value))) {
    return next(new Error('Store monetary and tax settings must be finite numbers'));
  }
  if (Number(this.taxSettings?.cgstPercent || 0) + Number(this.taxSettings?.sgstPercent || 0) > 100) {
    return next(new Error('Combined GST percentage cannot exceed 100'));
  }
  next();
});

storeSchema.virtual('isSubscriptionValid').get(function () {
  return this.subscription.isActive && this.subscription.expiresAt > new Date();
});

const Store = mongoose.model('Store', storeSchema);
export default Store;
