import Order from '../models/Order.js';
import Return from '../models/Return.js';
import PurchaseEntry from '../models/PurchaseEntry.js';
import Supplier from '../models/Supplier.js';
import Expense from '../models/Expense.js';
import UdharEntry from '../models/UdharEntry.js';
import UdharCustomer from '../models/UdharCustomer.js';
import StaffSalary from '../models/StaffSalary.js';
import User from '../models/User.js';
import { MANUAL_MOVEMENT_TYPES } from '../models/DailyClosing.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';

const channels = {
  cash: 'cash', counter: 'cash', cod: 'cash', cash_on_pickup: 'cash',
  upi: 'upi', upi_id: 'upi', upi_qr: 'upi',
  bank_transfer: 'bank', cheque: 'bank', gateway: 'other',
};
const movementTypes = ['sales', 'udharCollections', 'supplierPayments', 'refunds', 'expenses', 'salaries', 'otherReceived', 'otherPaid'];

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
  }).select('supplierId supplierName invoiceNumber createdAt legacyPaidAmount paidAmount paymentMethod accountEntries').session(session).lean();

  const paymentIds = new Set();
  const legacyInvoices = [];
  for (const invoice of purchases) {
    const payments = (invoice.accountEntries ?? []).filter((entry) => entry.type === 'payment');
    for (const payment of payments) {
      if (!withinDay(payment.postedAt, start, end)) continue;
      if (payment.referenceId) paymentIds.add(String(payment.referenceId));
      // A payment may be allocated over several invoices. Each row contains only its own portion.
      add('supplierPayments', payment.method, payment.amount, { id: invoice._id, supplierId: invoice.supplierId, party: invoice.supplierName,
        reference: invoice.invoiceNumber || payment.referenceId, date: payment.postedAt, actorId: payment.recordedBy, description: payment.note });
    }
    const legacyPaid = invoice.legacyPaidAmount ?? (payments.length ? 0 : invoice.paidAmount);
    if (legacyPaid > 0 && withinDay(invoice.createdAt, start, end)) {
      legacyInvoices.push({ id: invoice._id, party: invoice.supplierName, reference: invoice.invoiceNumber, date: invoice.createdAt, supplierId: invoice.supplierId, method: invoice.paymentMethod, amount: legacyPaid });
    }
  }

  const legacyHistory = { allocations: { $exists: false } };
  const suppliers = await Supplier.find({
    tenantId, paymentHistory: { $elemMatch: { ...legacyHistory, paidAt: range } },
  }).select('name paymentHistory').session(session).lean();
  for (const supplier of suppliers) {
    for (const payment of supplier.paymentHistory) {
      if (payment.allocations != null || paymentIds.has(String(payment._id))) continue;
      if (withinDay(payment.paidAt, start, end) && payment.method !== 'credit') {
        add('supplierPayments', payment.method, payment.amount, { supplierId: supplier._id, party: supplier.name, reference: payment._id, date: payment.paidAt, actorId: payment.recordedBy });
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
      add('supplierPayments', invoice.method, invoice.amount, invoice);
    }
  }
}

export async function computeClosingSummary(tenantId, { start, end }, session, manual = [], detail) {
  const range = { $gte: start, $lt: end };
  const totals = Object.fromEntries(['cash', 'upi', 'bank', 'other', 'unclassified'].map((channel) =>
    [channel, Object.fromEntries(movementTypes.map((type) => [type, 0]))]));
  const transactions = [];
  const includes = (type) => !detail || detail.types.includes(type);
  const add = (type, method, amount, entry) => {
    const channel = Object.hasOwn(channels, method) ? channels[method] : 'unclassified';
    const minor = toMinorUnits(amount ?? 0, type);
    if (type !== 'creditSales') totals[channel][type] += minor;
    const matchesChannel = !detail?.channel || detail.channel === channel ||
      (detail.channel === 'digital' && ['upi', 'bank', 'other'].includes(channel));
    if (detail && minor && matchesChannel && detail.types.includes(type)) {
      transactions.push({ type, method, ...entry, amount: fromMinorUnits(minor) });
    }
  };

  if (includes('sales')) {
    const receipts = await Order.find({
      tenantId, checkoutPayments: { $exists: false }, paymentMethod: { $ne: 'credit' },
      $or: [
        { paidAt: range, paymentStatus: { $in: ['paid', 'refunded'] } },
        { paidAt: range, paymentStatus: 'partial', receivedAmount: { $gt: 0 } },
        { paidAt: null, paymentStatus: { $in: ['paid', 'refunded'] }, $or: [
          { createdAt: range }, { deliveredAt: range }, { 'paymentProof.verifiedAt': range },
        ] },
      ],
    }).select('orderNumber customerInfo.name paidAt receivedAmount createdAt deliveredAt orderType paymentMethod paymentProof.verifiedAt pricing.grandTotal')
      .session(session).lean();
    for (const order of receipts) {
      if (withinDay(receiptDate(order), start, end)) {
        add('sales', order.paymentMethod, order.receivedAmount ?? order.pricing?.grandTotal, { id: order._id, reference: order.orderNumber, party: order.customerInfo?.name, date: receiptDate(order) });
      }
    }
    const splitReceipts = await Order.find({ tenantId, 'checkoutPayments.paidAt': range })
      .select('checkoutPayments orderNumber customerInfo.name').session(session).lean();
    for (const order of splitReceipts) {
      for (const payment of order.checkoutPayments) {
        if (withinDay(payment.paidAt, start, end)) add('sales', payment.method, payment.amount, { id: order._id, reference: order.orderNumber, party: order.customerInfo?.name, date: payment.paidAt });
      }
    }
  }

  const placed = { tenantId, createdAt: range, status: { $nin: ['cancelled', 'rejected'] } };
  const ordersCount = detail ? 0 : await Order.countDocuments(placed).session(session);
  const creditOrders = includes('creditSales') ? await Order.find({ ...placed, paymentMethod: 'credit' })
    .select('pricing.grandTotal receivedAmount orderNumber customerInfo.name createdAt').session(session).lean() : [];
  const creditMinor = creditOrders.reduce((sum, order) => sum + Math.max(0,
    toMinorUnits(order.pricing.grandTotal) - toMinorUnits(order.receivedAmount ?? 0)), 0);
  if (detail?.types.includes('creditSales')) for (const order of creditOrders) {
    add('creditSales', 'credit', Math.max(0, toMinorUnits(order.pricing.grandTotal) - toMinorUnits(order.receivedAmount ?? 0)) / 100,
      { id: order._id, reference: order.orderNumber, party: order.customerInfo?.name, date: order.createdAt });
  }

  if (includes('udharCollections')) {
    const collections = await UdharEntry.find({
      tenantId, date: range, type: 'credit', voidedAt: null, referenceType: { $nin: ['order', 'pos_order'] },
    }).select('method amount customerId date description recordedByName').session(session).lean();
    const customers = detail?.types.includes('udharCollections') && collections.length
      ? await UdharCustomer.find({ tenantId, _id: { $in: collections.map((entry) => entry.customerId) } }).select('name').session(session).lean() : [];
    const names = new Map(customers.map(({ _id, name }) => [String(_id), name]));
    for (const entry of collections) add('udharCollections', entry.method, entry.amount, { id: entry.customerId, reference: entry._id, party: names.get(String(entry.customerId)), date: entry.date, description: entry.description, actor: entry.recordedByName });
  }

  let returnsMinor = 0;
  if (includes('refunds')) {
    const returns = await Return.find({
      tenantId, type: 'customer_return', status: 'processed', processedAt: range,
      refundMethod: { $nin: ['exchange', 'no_refund'] },
    }).select('refundMethod netRefund orderId orderNumber customerName processedAt processedByName reason').session(session).lean();

    for (const ret of returns) {
      if (!(ret.netRefund > 0)) continue;
      returnsMinor += toMinorUnits(ret.netRefund);
      if (ret.refundMethod !== 'store_credit') add('refunds', ret.refundMethod, ret.netRefund, { id: ret.orderId, party: ret.customerName,
        reference: ret.orderNumber ?? ret._id, date: ret.processedAt, actor: ret.processedByName, description: ret.reason });
    }
  }

  if (includes('expenses')) {
    const expenses = await Expense.find({ tenantId, date: range, isActive: { $ne: false } })
      .select('method amount date name category paidTo description recordedByName').session(session).lean();
    for (const expense of expenses) add('expenses', expense.method, expense.amount, { id: expense._id, reference: expense._id, name: expense.name || expense.category, party: expense.paidTo, date: expense.date, description: expense.description, actor: expense.recordedByName });
  }

  if (includes('supplierPayments')) {
    await addSupplierPayments(tenantId, range, session, add);
    const supplierRows = transactions.filter((row) => row.type === 'supplierPayments');
    const actorIds = supplierRows.map((row) => row.actorId).filter(Boolean);
    const supplierIds = supplierRows.filter((row) => !row.party).map((row) => row.supplierId).filter(Boolean);
    const actors = actorIds.length ? await User.find({ tenantId, _id: { $in: actorIds } }).select('name').session(session).lean() : [];
    const suppliers = supplierIds.length ? await Supplier.find({ tenantId, _id: { $in: supplierIds } }).select('name').session(session).lean() : [];
    const actorNames = new Map(actors.map(({ _id, name }) => [String(_id), name]));
    const supplierNames = new Map(suppliers.map(({ _id, name }) => [String(_id), name]));
    for (const row of supplierRows) {
      row.actor = actorNames.get(String(row.actorId));
      row.party ||= supplierNames.get(String(row.supplierId));
      delete row.actorId;
    }
  }
  if (includes('salaries')) {
    const salaries = await StaffSalary.find({ tenantId, 'payments.paidAt': range }).select('staffId staffName monthYear payments').session(session).lean();
    for (const salary of salaries) for (const payment of salary.payments) {
      if (withinDay(payment.paidAt, start, end)) add('salaries', payment.method, payment.amount,
        { id: salary.staffId, month: salary.monthYear, name: payment.type, party: salary.staffName, date: payment.paidAt,
          reference: payment._id, description: payment.note, actor: payment.paidByName });
    }
  }

  for (const entry of manual) {
    const fields = { name: entry.type, party: entry.party, date: entry.recordedAt, actor: entry.recordedByName, description: entry.description, reference: entry.operationId };
    if (entry.type === 'external_sale') add('sales', entry.method, entry.amount, fields);
    else {
      add(MANUAL_MOVEMENT_TYPES[entry.type] === 'in' ? 'otherReceived' : 'otherPaid', entry.method, entry.amount, fields);
      if (entry.type === 'bank_deposit') add('otherReceived', 'bank_transfer', entry.amount, fields);
      if (entry.type === 'bank_withdrawal') add('otherPaid', 'bank_transfer', entry.amount, fields);
    }
  }

  const sum = (type) => Object.values(totals).reduce((total, row) => total + row[type], 0);
  const movements = Object.fromEntries(Object.entries(totals).map(([channel, row]) => {
    const inflow = row.sales + row.udharCollections + row.otherReceived;
    const outflow = row.supplierPayments + row.refunds + row.expenses + row.salaries + row.otherPaid;
    const values = { ...row, inflow, outflow, net: inflow - outflow };
    return [channel, Object.fromEntries(Object.entries(values).map(([key, amount]) => [key, fromMinorUnits(amount)]))];
  }));
  return {
    cashNetMinor: totals.cash.sales + totals.cash.udharCollections
      + totals.cash.otherReceived - totals.cash.supplierPayments - totals.cash.refunds - totals.cash.expenses - totals.cash.salaries - totals.cash.otherPaid,
    transactions,
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
