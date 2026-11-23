import mongoose from 'mongoose';

const udharCustomerSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  address: { type: String, trim: true, maxlength: 500, default: '' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  balance: { type: Number, default: 0, min: 0 }, // positive = customer owes us
  allocationVersion: { type: Number, default: 0 },
  openingPending: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  notes: { type: String, trim: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

udharCustomerSchema.index({ tenantId: 1, phone: 1 });
udharCustomerSchema.index({ tenantId: 1, name: 1 });
udharCustomerSchema.index({ tenantId: 1, balance: -1, name: 1, _id: 1 });

export default mongoose.model('UdharCustomer', udharCustomerSchema);
