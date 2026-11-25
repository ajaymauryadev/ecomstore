import mongoose from 'mongoose';

export const UNIT_VALUES = [
  'piece', 'sachet', 'strip', 'packet', 'pouch', 'stick', 'ladi',
  'dozen', 'half_dozen', 'box', 'carton', 'bundle', 'tray',
  'gram', '100g', '250g', '500g', 'kg', 'quintal',
  'bora', 'katta', 'sack', 'bag',
  'ml', 'liter',
];

const variantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Variant name is required'],
      trim: true,
      maxlength: [80, 'Variant name cannot exceed 80 characters'],
    },
    unit: {
      type: String,
      enum: { values: UNIT_VALUES, message: 'Invalid unit' },
      default: 'piece',
    },

    retailPrice: {
      type: Number,
      required: [true, 'Retail price is required'],
      min: [Number.MIN_VALUE, 'Retail price must be positive'],
    },
    wholesalePrice: { type: Number, min: Number.MIN_VALUE, default: null },
    offerPrice: { type: Number, min: Number.MIN_VALUE, default: null },
    purchasePrice: { type: Number, min: 0, default: null },

    stock: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'Stock must be a whole number' },
    },
    lowStockLimit: {
      type: Number,
      default: 5,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'Low stock limit must be a whole number' },
    },

    sku: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  {
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

variantSchema.pre('validate', function validatePrices(next) {
  const priceFields = ['retailPrice', 'wholesalePrice', 'offerPrice', 'purchasePrice'];
  if (priceFields.some((field) => this[field] != null && !Number.isFinite(this[field]))) {
    return next(new Error('Product prices must be finite numbers'));
  }
  if (this.offerPrice != null && this.offerPrice > this.retailPrice) {
    return next(new Error('Offer price cannot exceed retail price'));
  }
  if (this.wholesalePrice != null && this.wholesalePrice > this.retailPrice) {
    return next(new Error('Wholesale price cannot exceed retail price'));
  }
  next();
});

variantSchema.virtual('sellingPrice').get(function () {
  return this.offerPrice ?? this.retailPrice;
});

variantSchema.virtual('margin').get(function () {
  if (!this.purchasePrice || !this.retailPrice) return null;
  return parseFloat(
    (((this.retailPrice - this.purchasePrice) / this.retailPrice) * 100).toFixed(1)
  );
});

variantSchema.virtual('discount').get(function () {
  if (!this.offerPrice || this.offerPrice >= this.retailPrice) return null;
  return Math.round(((this.retailPrice - this.offerPrice) / this.retailPrice) * 100);
});

variantSchema.virtual('stockStatus').get(function () {
  if (this.stock <= 0) return 'out_of_stock';
  if (this.stock <= this.lowStockLimit) return 'low_stock';
  return 'in_stock';
});

const productSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    brand: { type: String, trim: true, maxlength: 100, default: '' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },

    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },

    images: [
      {
        url: { type: String, required: true },
        isMain: { type: Boolean, default: false },
        _id: false,
      },
    ],

    variants: {
      type: [variantSchema],
      validate: {
        validator: (v) => v.length > 0,
        message: 'Product must have at least one variant',
      },
    },

    isActive: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },

    tags: [{ type: String, trim: true, lowercase: true }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

productSchema.index({ tenantId: 1, isActive: 1, isOnline: 1 });
productSchema.index({ tenantId: 1, categoryId: 1 });
productSchema.index({ tenantId: 1, isFeatured: 1 });
productSchema.index({ tenantId: 1, name: 1 });
productSchema.index({ tenantId: 1, 'variants.sku': 1 });
// Equality fields precede the actual list sort so a page does not sort the
// entire tenant's catalog before returning its first 20–24 products.
productSchema.index({ tenantId: 1, updatedAt: -1 }, { name: 'catalog_recent' });
productSchema.index({ tenantId: 1, isActive: 1, name: 1 }, { name: 'catalog_counter' });
// Include the actual tie-breaker used by paginated product queries.
productSchema.index({ tenantId: 1, updatedAt: -1, _id: 1 }, { name: 'catalog_recent_page' });
productSchema.index({ tenantId: 1, isActive: 1, name: 1, _id: 1 }, { name: 'catalog_counter_page' });
productSchema.index(
  { tenantId: 1, isActive: 1, isOnline: 1, isFeatured: -1, updatedAt: -1, _id: 1 },
  { name: 'catalog_storefront' }
);

productSchema.virtual('priceRange').get(function () {
  const prices = this.variants
    .filter((v) => v.isActive)
    .map((v) => v.offerPrice ?? v.retailPrice);
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max, isSingle: min === max };
});

productSchema.virtual('mainImage').get(function () {
  if (!this.images?.length) return null;
  return this.images.find((i) => i.isMain)?.url ?? this.images[0]?.url;
});

productSchema.virtual('totalStock').get(function () {
  return this.variants.reduce((s, v) => s + (v.stock || 0), 0);
});

productSchema.virtual('stockStatus').get(function () {
  const active = this.variants.filter((v) => v.isActive);
  if (!active.length) return 'inactive';
  if (active.every((v) => v.stock <= 0)) return 'out_of_stock';
  if (active.some((v) => v.stock > 0 && v.stock <= v.lowStockLimit)) return 'low_stock';
  return 'in_stock';
});

const Product = mongoose.model('Product', productSchema);
export default Product;
