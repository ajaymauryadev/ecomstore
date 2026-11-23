import mongoose from 'mongoose';
import crypto from 'crypto';
import { stripOrderItemCosts } from '../utils/orderResponse.js';
import { actorSnapshotSchema } from './ActorSnapshot.js';

export const ORDER_STATUSES = [
  'pending',
  'payment_pending',
  'payment_submitted',
  'payment_verified',
  'accepted',
  'packing',
  'packed',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'rejected',
  'partially_fulfilled',
];

export const ORDER_TYPES = ['home_delivery', 'self_pickup', 'online', 'counter', 'wholesale'];

export const PAYMENT_METHODS = [
  'upi_qr',
  'upi_id',
  'cash_on_pickup',
  'cod',
  'gateway',
  'bank_transfer',
  'counter',
  'credit',
];

export const PAYMENT_STATUSES = ['pending', 'partial', 'submitted', 'paid', 'failed', 'refunded'];

const refundBasisSchema = new mongoose.Schema({
  quantity: Number,
  itemDiscountMinor: Number,
  billDiscountMinor: Number,
  couponDiscountMinor: Number,
  taxMinor: Number,
  eligibleMinor: Number,
}, { _id: false });

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String, required: true },
  variantName: { type: String },
  unit: { type: String },
  image: { type: String },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isSafeInteger, message: 'Quantity must be a whole number' },
  },
  mrp: { type: Number, required: true, min: Number.MIN_VALUE },
  price: { type: Number, required: true, min: Number.MIN_VALUE },
  unitCost: { type: Number, min: 0, select: false },
  total: { type: Number, min: 0 },
  fulfilledQty: {
    type: Number,
    default: null,
    min: 0,
    validate: {
      validator(value) {
        return value == null || (Number.isSafeInteger(value) && value <= this.quantity);
      },
      message: 'Fulfilled quantity is invalid',
    },
  },
  restoredQty: { type: Number, default: 0, min: 0 },
  returnReservedQty: { type: Number, default: 0, min: 0 },
  couponEligible: Boolean,
  refundBasis: refundBasisSchema,
}, { _id: true });

const timelineSchema = new mongoose.Schema({
  action: String,
  performedBy: actorSnapshotSchema,
  assignee: actorSnapshotSchema,
  previousAssignee: actorSnapshotSchema,
  status: { type: String },
  message: { type: String },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const paymentProofSchema = new mongoose.Schema({
  screenshotUrl: { type: String },
  screenshotFile: { type: String, select: false },
  utrNumber: { type: String },
  notes: { type: String },
  submittedAt: { type: Date },
  verifiedAt: { type: Date },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedReason: { type: String },
}, { _id: false });

const orderSubmissionSchema = new mongoose.Schema({
  keyHash: { type: String, required: true },
  requestHash: { type: String, required: true },
  guestSeed: String,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  udharCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: 'UdharCustomer' },
  guestAccessTokenHash: { type: String, select: false },
  guestAccessTokenCreatedAt: { type: Date },
  orderNumber: { type: String, index: true },
  orderSubmission: { type: orderSubmissionSchema, select: false },

  orderType: { type: String, enum: ORDER_TYPES, required: true },
  saleType: { type: String, enum: ['instant', 'parcha'] },
  deliveryArea: { type: String, trim: true },

  items: { type: [orderItemSchema], required: true },
  returnApprovalRevision: { type: Number, select: false },

  customerInfo: {
    name: { type: String, required: true },
    phone: {
      type: String,
      required() {
        return this.orderType !== 'counter' || !['counter', 'upi_id'].includes(this.paymentMethod);
      },
    },
    email: { type: String },
    address: {
      line1: { type: String },
      landmark: { type: String },
      city: { type: String },
      state: { type: String },
      pincode: { type: String },
    },
    gstNumber: { type: String },
  },

  pricing: {
    subtotal: { type: Number, default: 0, min: 0 },
    couponDiscount: { type: Number, default: 0, min: 0 },
    deliveryCharge: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
  },

  couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
  couponCode: { type: String },

  status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
  paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
  paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cod' },
  paidAt: Date,
  receivedAmount: { type: Number, min: 0 },
  // Checkout receipts are immutable; later Udhar collections live in the ledger.
  checkoutPayments: { type: [{
    method: { type: String, enum: ['cash', 'upi'], required: true },
    amount: { type: Number, min: Number.MIN_VALUE, required: true },
    paidAt: { type: Date, required: true },
  }], default: undefined },
  udharAmount: { type: Number, min: 0 },
  settlement: {
    pending: { type: Number, min: 0 },
    collected: { type: Number, min: 0, default: 0 },
    adjusted: { type: Number, default: 0 },
    clearedAt: Date,
    lastPaymentAt: Date,
    version: Number,
  },

  paymentProof: paymentProofSchema,

  note: { type: String, trim: true },
  cancelReason: { type: String },
  cancelledBy: { type: String, enum: ['customer', 'store', 'system'] },

  estimatedDelivery: { type: Date },
  preparedAt: { type: Date },
  deliveredAt: { type: Date },

  timeline: [timelineSchema],

  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deliveryAssignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  fulfillment: {
    packingAssignedTo: actorSnapshotSchema,
    packingAssignedBy: actorSnapshotSchema,
    deliveryAssignedTo: actorSnapshotSchema,
    deliveryAssignedBy: actorSnapshotSchema,
    packingStartedBy: actorSnapshotSchema,
    packingCompletedBy: actorSnapshotSchema,
    packingVerifiedBy: actorSnapshotSchema,
    dispatchedBy: actorSnapshotSchema,
    deliveryStartedBy: actorSnapshotSchema,
    deliveredBy: actorSnapshotSchema,
  },
  stockReservationState: {
    type: String,
    enum: ['none', 'reserved', 'consumed', 'restored'],
    default: 'none',
  },
  stockRestoredAt: { type: Date },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(_document, value) {
      delete value.orderSubmission;
      stripOrderItemCosts(value);
    },
  },
});

orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, orderType: 1 });
orderSchema.index({ tenantId: 1, paymentStatus: 1 });
orderSchema.index({ tenantId: 1, paidAt: 1 });
orderSchema.index({ tenantId: 1, status: 1, deliveredAt: 1 });
orderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });
orderSchema.index(
  { tenantId: 1, 'orderSubmission.keyHash': 1 },
  { unique: true, partialFilterExpression: { 'orderSubmission.keyHash': { $exists: true } } }
);
orderSchema.index({ tenantId: 1, deliveryAssignedTo: 1, status: 1 });
orderSchema.index({ tenantId: 1, assignedTo: 1, status: 1, createdAt: -1, _id: -1 });
orderSchema.index({ tenantId: 1, udharCustomerId: 1, createdAt: -1, _id: -1 });
orderSchema.index({ tenantId: 1, udharCustomerId: 1, createdAt: -1, _id: -1 },
  { name: 'pending_customer_bills', partialFilterExpression: { 'settlement.pending': { $gt: 0 } } });
orderSchema.index({ tenantId: 1, 'checkoutPayments.paidAt': -1 });
orderSchema.index({ tenantId: 1, createdAt: -1, _id: -1 });

orderSchema.methods.recordPayment = function (paidAt) {
  if (this.paymentStatus === 'paid') return;
  this.paymentStatus = 'paid';
  this.paidAt = paidAt;
  this.receivedAmount = this.pricing.grandTotal;
};

orderSchema.pre('save', async function (next) {
  if (!this.isNew) return next();

  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  this.orderNumber = `ORD-${dateStr}-${random}`;

  this.timeline.unshift({ status: this.status, message: 'Order placed', timestamp: new Date() });
  next();
});

orderSchema.pre('validate', function validateMoney(next) {
  if (this.isNew) {
    for (const item of this.items || []) {
      item.total = Number((item.price * item.quantity).toFixed(2));
    }
  }
  const amounts = this.pricing
    ? ['subtotal', 'couponDiscount', 'deliveryCharge', 'tax', 'grandTotal']
      .map((field) => this.pricing[field])
    : [];
  const itemAmounts = (this.items || []).flatMap((item) => [item.mrp, item.price, item.total]);
  if ([...amounts, ...itemAmounts].some((value) => value != null && !Number.isFinite(value))) {
    return next(new Error('Order monetary values must be finite numbers'));
  }
  next();
});

export default mongoose.model('Order', orderSchema);
