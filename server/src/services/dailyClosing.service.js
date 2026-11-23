import Order from '../models/Order.js';
import Return from '../models/Return.js';
import PurchaseEntry from '../models/PurchaseEntry.js';
import Supplier from '../models/Supplier.js';
import Expense from '../models/Expense.js';
import UdharEntry from '../models/UdharEntry.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';

const channels = {
  cash: 'cash', counter: 'cash', cod: 'cash', cash_on_pickup: 'cash',
  upi: 'upi', upi_id: 'upi', upi_qr: 'upi',
  bank_transfer: 'bank', cheque: 'bank', gateway: 'other',
};
const movementTypes = ['sales', 'udharCollections', 'supplierPayments', 'refunds', 'expenses'];

const withinDay = (timestamp, start, end) => timestamp != null && timestamp >= start && timestamp < end;

function receiptDate(order) {
  if (order.paidAt) return order.paidAt;
  if (order.orderType === 'counter') return order.createdAt;
  return order.paymentProof?.verifiedAt ?? order.deliveredAt ?? order.createdAt;
}

async function addSupplierPayments(tenantId, range, session, add) {
  const { $gte: start, $lt: end } = range;
  const paymentEntry = { type: 'payment', postedAt: range };
  const purchases = await PurchaseEntry.find({
    tenantId,
    $or: [{ createdAt: range }, { accountEntries: { $elemMatch: paymentEntry } }],
  }).select('supplierId createdAt legacyPaidAmount paidAmount paymentMethod accountEntries').session(session).lean();

  const paymentIds = new Set();
  const legacyInvoices = [];
  for (const invoice of purchases) {
    const payments = (invoice.accountEntries ?? []).filter((entry) => entry.type === 'payment');
    for (const payment of payments) {
      if (!withinDay(payment.postedAt, start, end)) continue;
      if (payment.referenceId) paymentIds.add(String(payment.referenceId));
      // A payment may be allocated over several invoices. Each row contains only its own portion.
      add('supplierPayments', payment.method, payment.amount);
    }
    const legacyPaid = invoice.legacyPaidAmount ?? (payments.length ? 0 : invoice.paidAmount);
    if (legacyPaid > 0 && withinDay(invoice.createdAt, start, end)) {
      legacyInvoices.push({ supplierId: invoice.supplierId, method: invoice.paymentMethod, amount: legacyPaid });
    }
  }

  const legacyHistory = { allocations: { $exists: false } };
  const suppliers = await Supplier.find({
    tenantId, paymentHistory: { $elemMatch: { ...legacyHistory, paidAt: range } },
  }).select('paymentHistory').session(session).lean();
  for (const supplier of suppliers) {
    for (const payment of supplier.paymentHistory) {
      if (payment.allocations != null || paymentIds.has(String(payment._id))) continue;
      if (withinDay(payment.paidAt, start, end) && payment.method !== 'credit') {
        add('supplierPayments', payment.method, payment.amount);
      }
    }
  }
  const supplierIds = legacyInvoices.map(({ supplierId }) => supplierId).filter(Boolean);
  const suppliersWithLegacyHistory = supplierIds.length ? await Supplier.distinct('_id', {
    tenantId, _id: { $in: supplierIds }, paymentHistory: { $elemMatch: legacyHistory },
  }).session(session) : [];
  const historyIds = new Set(suppliersWithLegacyHistory.map(String));
  for (const invoice of legacyInvoices) {
    if (!historyIds.has(String(invoice.supplierId)) && invoice.method !== 'credit') {
      add('supplierPayments', invoice.method, invoice.amount);
    }
  }
}

export async function computeClosingSummary(tenantId, { start, end }, session) {
  const range = { $gte: start, $lt: end };
  const totals = Object.fromEntries(['cash', 'upi', 'bank', 'other', 'unclassified'].map((channel) =>
    [channel, Object.fromEntries(movementTypes.map((type) => [type, 0]))]));
  const add = (type, method, amount) => {
    const channel = Object.hasOwn(channels, method) ? channels[method] : 'unclassified';
    totals[channel][type] += toMinorUnits(amount ?? 0, type);
  };

  const receipts = await Order.find({
    tenantId, checkoutPayments: { $exists: false }, paymentMethod: { $ne: 'credit' },
    $or: [
      { paidAt: range },
      { paidAt: null, paymentStatus: { $in: ['paid', 'refunded'] }, $or: [
        { createdAt: range }, { deliveredAt: range }, { 'paymentProof.verifiedAt': range },
      ] },
    ],
  }).select('paidAt receivedAmount createdAt deliveredAt orderType paymentMethod paymentProof.verifiedAt pricing.grandTotal')
    .session(session).lean();
  for (const order of receipts) {
    if (withinDay(receiptDate(order), start, end)) {
      add('sales', order.paymentMethod, order.receivedAmount ?? order.pricing?.grandTotal);
    }
  }
  const splitReceipts = await Order.find({ tenantId, 'checkoutPayments.paidAt': range })
    .select('checkoutPayments').session(session).lean();
  for (const order of splitReceipts) {
    for (const payment of order.checkoutPayments) {
      if (withinDay(payment.paidAt, start, end)) add('sales', payment.method, payment.amount);
    }
  }

  const placed = { tenantId, createdAt: range, status: { $nin: ['cancelled', 'rejected'] } };
  const ordersCount = await Order.countDocuments(placed).session(session);
  const creditOrders = await Order.find({ ...placed, paymentMethod: 'credit' })
    .select('pricing.grandTotal receivedAmount').session(session).lean();
  const creditMinor = creditOrders.reduce((sum, order) => sum + Math.max(0,
    toMinorUnits(order.pricing.grandTotal) - toMinorUnits(order.receivedAmount ?? 0)), 0);

  const collections = await UdharEntry.find({
    tenantId, date: range, type: 'credit', voidedAt: null, referenceType: { $nin: ['order', 'pos_order'] },
  }).select('method amount').session(session).lean();
  for (const entry of collections) add('udharCollections', entry.method, entry.amount);

  const returns = await Return.find({
    tenantId, type: 'customer_return', status: 'processed', processedAt: range,
    refundMethod: { $nin: ['exchange', 'no_refund'] },
  }).select('refundMethod netRefund').session(session).lean();
  let returnsMinor = 0;
  for (const ret of returns) {
    if (!(ret.netRefund > 0)) continue;
    returnsMinor += toMinorUnits(ret.netRefund);
    if (ret.refundMethod !== 'store_credit') add('refunds', ret.refundMethod, ret.netRefund);
  }

  const expenses = await Expense.find({ tenantId, date: range, isActive: { $ne: false } })
    .select('method amount').session(session).lean();
  for (const expense of expenses) add('expenses', expense.method, expense.amount);
  await addSupplierPayments(tenantId, range, session, add);

  const sum = (type) => Object.values(totals).reduce((total, row) => total + row[type], 0);
  const movements = Object.fromEntries(Object.entries(totals).map(([channel, row]) => {
    const inflow = row.sales + row.udharCollections;
    const outflow = row.supplierPayments + row.refunds + row.expenses;
    const values = { ...row, inflow, outflow, net: inflow - outflow };
    return [channel, Object.fromEntries(Object.entries(values).map(([key, amount]) => [key, fromMinorUnits(amount)]))];
  }));
  return {
    cashNetMinor: totals.cash.sales + totals.cash.udharCollections
      - totals.cash.supplierPayments - totals.cash.refunds - totals.cash.expenses,
    summary: {
      cashSales: movements.cash.sales,
      upiSales: movements.upi.sales,
      onlineSales: fromMinorUnits(totals.bank.sales + totals.other.sales),
      creditSales: fromMinorUnits(creditMinor),
      totalSales: fromMinorUnits(sum('sales') + creditMinor),
      ordersCount,
      returnsTotal: fromMinorUnits(returnsMinor),
      supplierPayments: fromMinorUnits(sum('supplierPayments')),
      totalExpenses: fromMinorUnits(sum('expenses')),
      movements,
    },
  };
}
