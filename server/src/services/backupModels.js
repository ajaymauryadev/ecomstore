import mongoose from 'mongoose';
import Store from '../models/Store.js';
import Plan from '../models/Plan.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Supplier from '../models/Supplier.js';
import PurchaseEntry from '../models/PurchaseEntry.js';
import StockLedger from '../models/StockLedger.js';
import UdharCustomer from '../models/UdharCustomer.js';
import UdharEntry from '../models/UdharEntry.js';
import Expense from '../models/Expense.js';
import StaffSalary from '../models/StaffSalary.js';
import Return from '../models/Return.js';
import DailyClosing from '../models/DailyClosing.js';
import PackingSession from '../models/PackingSession.js';
import StaffActivityLog from '../models/StaffActivityLog.js';
import Coupon from '../models/Coupon.js';
import CouponUsage from '../models/CouponUsage.js';
import Offer from '../models/Offer.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';

export const collections = {
  plans: Plan,
  users: User,
  categories: Category,
  products: Product,
  orders: Order,
  suppliers: Supplier,
  purchases: PurchaseEntry,
  stockLedger: StockLedger,
  udhar: UdharCustomer,
  udharEntries: UdharEntry,
  expenses: Expense,
  salaries: StaffSalary,
  returns: Return,
  dailyClosings: DailyClosing,
  packingSessions: PackingSession,
  staffActivityLogs: StaffActivityLog,
  coupons: Coupon,
  couponUsage: CouponUsage,
  offers: Offer,
  notifications: Notification,
  auditLogs: AuditLog,
};

export const archiveModels = { store: Store, ...collections };
export const { BSON, ObjectId } = mongoose.mongo;
export const isTenantId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
export const orderedBson = { promoteValues: false, sort: { _id: 1 } };

const ownerSecrets = /^(?:password(?:hash|salt)?|hashedpassword|token(?:hash|version)?|(?:access|refresh|reset|passwordreset|verification|guestaccess|session)token(?:hash)?|(?:jwt|cookie|client|api)?secret|apiKey|orderSubmission|authorization|cookie|session(?:id|secret)|pin(?:hash)?)$/i;

function redactOwnerSecrets(value) {
  if (Array.isArray(value)) {
    value.forEach(redactOwnerSecrets);
  } else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) {
      if (key === 'paymentSubmission' || ownerSecrets.test(key.replace(/[-_]/g, ''))) delete value[key];
      else redactOwnerSecrets(value[key]);
    }
  }
}

export function encodeDocument(doc, kind) {
  if (kind === 'owner') redactOwnerSecrets(doc);
  return BSON.EJSON.serialize(doc, { relaxed: kind === 'owner' });
}

export const decodeDocument = (doc) => BSON.EJSON.deserialize(doc, { relaxed: false });
