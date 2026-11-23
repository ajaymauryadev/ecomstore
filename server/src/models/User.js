import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS } from '../constants/permissions.js';

const ROLES = ['super_admin', 'store_owner', 'staff', 'packer', 'delivery', 'customer'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [80, 'Name cannot exceed 80 characters'],
    },
    email: {
      type: String,
      unique: true,
      sparse: true, // allows multiple null for customers without email
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [10, 'Password must be at least 10 characters'],
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid Indian mobile number'],
    },
    role: {
      type: String,
      enum: ROLES,
      default: 'customer',
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      index: true,
    },
    permissions: {
      type: [{ type: String, enum: ALL_PERMISSIONS }],
      default: [],
    },
    avatar: String,
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: Date,
    passwordChangedAt: Date,
    tokenVersion: { type: Number, default: 0, min: 0, select: false },

    // Customer-specific fields
    savedAddresses: [{
      label: { type: String, default: 'Home' },
      line1: String,
      landmark: String,
      city: String,
      state: String,
      pincode: String,
      isDefault: { type: Boolean, default: false },
    }],
    favoriteProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.index({ tenantId: 1, role: 1 });
userSchema.index({ tenantId: 1, phone: 1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
    this.tokenVersion = Number(this.tokenVersion || 0) + 1;
  }
  next();
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function (jwtTimestamp) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > jwtTimestamp;
};

const User = mongoose.model('User', userSchema);
export default User;
