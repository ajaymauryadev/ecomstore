import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: [80, 'Category name cannot exceed 80 characters'],
    },
    description: { type: String, trim: true, maxlength: 300 },
    image: String,
    emoji: { type: String, default: '📦' },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

categorySchema.index({ tenantId: 1, sortOrder: 1 });
categorySchema.index({ tenantId: 1, isActive: 1 });
categorySchema.index({ tenantId: 1, parentId: 1 });

const Category = mongoose.model('Category', categorySchema);
export default Category;
