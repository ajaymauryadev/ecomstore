import Order from '../models/Order.js';
import UdharEntry from '../models/UdharEntry.js';
import UdharCustomer from '../models/UdharCustomer.js';
import { AppError } from '../utils/AppError.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { cursorFilter, cursorMeta } from '../utils/cursor.js';
import { recordOrderAction } from '../utils/orderAttribution.js';

const linked = (entry) => ['order', 'pos_order'].includes(entry.referenceType) && entry.referenceId;
const initialPaidMinor = (order) => (order.checkoutPayments || []).reduce((sum, row) => sum + toMinorUnits(row.amount), 0);

export function paymentSummary(order) {
  const initial = order.checkoutPayments ? initialPaidMinor(order)
    : order.paymentMethod !== 'credit' && ['paid', 'refunded'].includes(order.paymentStatus)
      ? toMinorUnits(order.receivedAmount ?? order.pricing?.grandTotal ?? 0) : 0;
  const collected = toMinorUnits(order.settlement?.collected || 0);
  const closed = ['cancelled', 'rejected'].includes(order.status);
  const pending = order.settlement?.pending ?? (closed ? 0 : order.paymentMethod === 'credit'
    ? order.udharAmount ?? fromMinorUnits(Math.max(0, toMinorUnits(order.pricing?.grandTotal || 0) - initial))
    : fromMinorUnits(Math.max(0, toMinorUnits(order.pricing?.grandTotal || 0) - initial - collected)));
  return { initialPaid: fromMinorUnits(initial), totalPaid: fromMinorUnits(initial + collected),
    originalUdhar: order.udharAmount ?? (order.paymentMethod === 'credit' ? order.pricing?.grandTotal : 0),
    pending: pending || 0, collected: fromMinorUnits(collected), adjusted: order.settlement?.adjusted || 0,
    clearedAt: order.settlement?.clearedAt || (order.paymentStatus === 'paid' ? order.paidAt : null),
    state: closed ? 'closed'
      : pending > 0 ? (initial + collected > 0 ? 'partial' : 'unpaid') : 'paid' };
}

function setSettlementStatus(order) {
  if (['cancelled', 'rejected'].includes(order.status)) return;
  const summary = paymentSummary(order);
  order.paymentStatus = summary.state === 'paid' ? 'paid' : summary.state === 'partial' ? 'partial' : 'pending';
  if (summary.state === 'paid') order.paidAt = order.settlement.clearedAt;
  else order.paidAt = undefined;
}

async function changeOrder(orderId, customer, { pending = 0, collected = 0, adjusted = 0, date, actor }, session) {
  if (!orderId) return;
  const order = await Order.findOne({ _id: orderId, tenantId: customer.tenantId }).session(session);
  if (!order || (order.udharCustomerId && String(order.udharCustomerId) !== String(customer._id))) {
    throw new AppError('The bill linked to this account needs reconciliation.', 409);
  }
  order.udharCustomerId = customer._id;
  const previous = order.settlement || {};
  const next = toMinorUnits(previous.pending || 0) + pending;
  const nextCollected = toMinorUnits(previous.collected || 0) + collected;
  if (next < 0 || nextCollected < 0 || !Number.isSafeInteger(next + nextCollected)) {
    throw new AppError('Bill balance changed. Refresh before recording this payment.', 409);
  }
  order.settlement = { pending: fromMinorUnits(next), collected: fromMinorUnits(nextCollected),
    adjusted: fromMinorUnits(Math.round((previous.adjusted || 0) * 100) + adjusted), version: 1,
    lastPaymentAt: collected > 0 ? date : previous.lastPaymentAt,
    clearedAt: next === 0 ? previous.clearedAt || date : undefined };
  setSettlementStatus(order);
  if (actor && collected) recordOrderAction(order, actor, collected > 0 ? 'payment_received' : 'payment_reversed',
    `${collected > 0 ? 'Payment received' : 'Payment corrected'}: ₹${fromMinorUnits(Math.abs(collected))}. Pending: ₹${order.settlement.pending}`);
  await order.save({ session });
}

// A one-time transactional backfill preserves the original ledger and freezes
// historical oldest-first allocations. Normal reads use these persisted links.
export async function ensureCustomerAllocations(customer, session) {
  if (customer.allocationVersion === 1) return;
  const entries = await UdharEntry.find({ tenantId: customer.tenantId, customerId: customer._id })
    .sort({ createdAt: 1, _id: 1 }).session(session).lean();
  const net = entries.reduce((sum, row) => sum + (row.type === 'debit' ? 1 : -1) * toMinorUnits(row.amount), 0);
  const opening = toMinorUnits(customer.balance) - net;
  if (opening < 0) throw new AppError('This account balance differs from its ledger. Reconcile it before allocating payments.', 409);
  const lots = opening > 0 ? [{ remaining: opening, opening: true }] : [];
  const changes = [];
  const states = new Map();
  const getState = (id) => {
    const key = String(id);
    if (!states.has(key)) states.set(key, { pending: 0, collected: 0, adjusted: 0 });
    return states.get(key);
  };
  for (const entry of entries) {
    const amount = toMinorUnits(entry.amount);
    if (entry.type === 'debit') {
      lots.push({ entry, remaining: amount, orderId: linked(entry) ? entry.referenceId : null });
      if (linked(entry)) getState(entry.referenceId).pending += amount;
    } else {
      const adjustment = Boolean(linked(entry));
      const targetId = entry.targetOrderId || (adjustment ? entry.referenceId : null);
      let remaining = amount;
      const allocations = [];
      for (const lot of lots) {
        if (targetId && String(lot.orderId) !== String(targetId)) continue;
        const part = Math.min(remaining, lot.remaining);
        if (!part) continue;
        lot.remaining -= part;
        remaining -= part;
        allocations.push({ debitEntryId: lot.entry?._id, orderId: lot.orderId || undefined, amount: fromMinorUnits(part) });
        if (lot.orderId) {
          const state = getState(lot.orderId);
          state.pending -= part;
          if (adjustment) state.adjusted += part;
          else { state.collected += part; state.lastPaymentAt = entry.date || entry.createdAt; }
          if (!state.pending) state.clearedAt = entry.date || entry.createdAt;
        }
        if (!remaining) break;
      }
      if (remaining) throw new AppError('An older ledger entry cannot be allocated safely. Account reconciliation is required.', 409);
      changes.push({ updateOne: { filter: { _id: entry._id, tenantId: customer.tenantId },
        update: { $set: { allocations, allocationMode: adjustment ? 'adjustment' : entry.targetOrderId ? 'bill' : 'reconstructed' } } } });
    }
  }
  const orderIds = [...states.keys()];
  const orders = await Order.find({ tenantId: customer.tenantId, _id: { $in: orderIds } }).session(session);
  const orderMap = new Map(orders.map((order) => [String(order._id), order]));
  for (const lot of lots) {
    if (!lot.entry) continue;
    changes.push({ updateOne: { filter: { _id: lot.entry._id, tenantId: customer.tenantId },
      update: { $set: { remainingAmount: fromMinorUnits(lot.remaining) } } } });
  }
  for (const change of changes) {
    for (const allocation of change.updateOne.update.$set.allocations || []) {
      if (allocation.orderId) allocation.orderNumber = orderMap.get(String(allocation.orderId))?.orderNumber;
    }
  }
  if (changes.length) await UdharEntry.bulkWrite(changes, { session, timestamps: false });
  for (const [id, state] of states) {
    const order = orderMap.get(id);
    // Missing historical bills remain visible as ledger entries, without fabricated item data.
    if (!order) continue;
    if (order.udharCustomerId && String(order.udharCustomerId) !== String(customer._id)) {
      throw new AppError('An older bill is linked to another account. Reconcile it before continuing.', 409);
    }
    order.udharCustomerId = customer._id;
    order.settlement = { pending: fromMinorUnits(state.pending), collected: fromMinorUnits(state.collected),
      adjusted: fromMinorUnits(state.adjusted), version: 1, lastPaymentAt: state.lastPaymentAt,
      clearedAt: state.pending === 0 ? state.clearedAt : undefined };
    setSettlementStatus(order);
    await order.save({ session });
  }
  customer.openingPending = fromMinorUnits(lots.find((lot) => lot.opening)?.remaining || 0);
  customer.allocationVersion = 1;
  await customer.save({ session });
}

export async function prepareCustomer(tenantId, id) {
  const customer = await UdharCustomer.findOne({ tenantId, _id: id });
  if (!customer) throw new AppError('Customer not found.', 404);
  if (customer.allocationVersion === 1) return customer;
  return runInTransaction(async (session) => {
    const current = await UdharCustomer.findOne({ tenantId, _id: id }).session(session);
    if (!current) throw new AppError('Customer not found.', 404);
    await ensureCustomerAllocations(current, session);
    return current;
  });
}

export async function allocationPreview(customer, amountMinor, orderId, session = null, { allowClosed = false } = {}) {
  if (orderId) {
    const order = await Order.findOne({ _id: orderId, tenantId: customer.tenantId, udharCustomerId: customer._id }).session(session);
    if (!order || (!allowClosed && ['cancelled', 'rejected'].includes(order.status))) throw new AppError('Choose an active bill from this customer account.', 404);
    if (toMinorUnits(order.settlement?.pending || 0) < amountMinor) throw new AppError('Payment cannot exceed this bill’s pending amount.', 409);
  } else if (toMinorUnits(customer.balance) < amountMinor) throw new AppError('Payment cannot exceed the outstanding balance.', 409);
  let remaining = amountMinor;
  const allocations = [];
  if (!orderId && customer.openingPending > 0) {
    const amount = Math.min(remaining, toMinorUnits(customer.openingPending));
    allocations.push({ amount: fromMinorUnits(amount) });
    remaining -= amount;
  }
  if (remaining) {
    const cursor = UdharEntry.find({ tenantId: customer.tenantId, customerId: customer._id,
      type: 'debit', remainingAmount: { $gt: 0 }, ...(orderId && { referenceId: orderId, referenceType: { $in: ['order', 'pos_order'] } }) })
      .sort({ createdAt: 1, _id: 1 }).session(session).cursor();
    try {
      for await (const lot of cursor) {
        const amount = Math.min(remaining, toMinorUnits(lot.remainingAmount));
        allocations.push({ debitEntryId: lot._id, orderId: linked(lot) ? lot.referenceId : undefined, amount: fromMinorUnits(amount) });
        remaining -= amount;
        if (!remaining) break;
      }
    } finally { await cursor.close(); }
  }
  if (remaining) throw new AppError('Pending bills differ from the account balance. Reconcile the account before collecting.', 409);
  const ids = allocations.map((row) => row.orderId).filter(Boolean);
  const orders = await Order.find({ tenantId: customer.tenantId, _id: { $in: ids } }).select('orderNumber').session(session).lean();
  const labels = new Map(orders.map((row) => [String(row._id), row.orderNumber]));
  return allocations.map((row) => ({ ...row, orderNumber: labels.get(String(row.orderId)) }));
}

export async function applyAllocations(customer, allocations, { adjustment = false, reverse = false, date = new Date(), actor } = {}, session) {
  const orderDeltas = new Map();
  for (const allocation of allocations) {
    const minor = toMinorUnits(allocation.amount);
    const delta = reverse ? minor : -minor;
    if (allocation.debitEntryId) {
      const lot = await UdharEntry.findOne({ _id: allocation.debitEntryId, tenantId: customer.tenantId, customerId: customer._id }).session(session);
      if (!lot || (!reverse && toMinorUnits(lot.remainingAmount) < minor)) throw new AppError('Bill balance changed. Refresh and try again.', 409);
      lot.remainingAmount = fromMinorUnits(toMinorUnits(lot.remainingAmount) + delta);
      await lot.save({ session });
    } else customer.openingPending = fromMinorUnits(toMinorUnits(customer.openingPending || 0) + delta);
    if (allocation.orderId) orderDeltas.set(String(allocation.orderId), (orderDeltas.get(String(allocation.orderId)) || 0) + delta);
  }
  for (const [id, delta] of orderDeltas) await changeOrder(id, customer, {
    pending: delta, collected: adjustment ? 0 : -delta, adjusted: adjustment ? -delta : 0, date, actor,
  }, session);
}

export async function postDebitLot(customer, entry, session) {
  if (linked(entry)) await changeOrder(entry.referenceId, customer, {
    pending: toMinorUnits(entry.amount), date: entry.date || entry.createdAt,
  }, session);
}

export async function billPaymentsPage(tenantId, customerId, order, query = {}) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 5));
  const filter = cursorFilter(query.cursor, ['paidAt', 'receiptKey'], { stringId: true });
  const rows = await UdharEntry.aggregate([
    { $match: { tenantId, customerId, type: 'credit', 'allocations.orderId': order._id } },
    { $unwind: '$allocations' }, { $match: { 'allocations.orderId': order._id } },
    { $group: { _id: '$_id', amount: { $sum: '$allocations.amount' }, receiptAmount: { $first: '$amount' }, method: { $first: '$method' },
      date: { $first: '$date' }, recordedByName: { $first: '$recordedByName' }, allocationMode: { $first: '$allocationMode' },
      voidedAt: { $first: '$voidedAt' }, voidReason: { $first: '$voidReason' } } },
    { $project: { _id: 1, receiptKey: { $concat: ['ledger:', { $toString: '$_id' }] },
      entryId: '$_id', amount: 1, receiptAmount: 1, method: 1, paidAt: '$date', recordedByName: 1,
      atCheckout: { $literal: false }, adjustment: { $eq: ['$allocationMode', 'adjustment'] },
      reconstructed: { $eq: ['$allocationMode', 'reconstructed'] }, voidedAt: 1, voidReason: 1 } },
    { $unionWith: { coll: Order.collection.name, pipeline: [
      { $match: { tenantId, _id: order._id } }, { $unwind: '$checkoutPayments' },
      { $project: { receiptKey: { $concat: ['checkout:', { $toString: '$_id' }, ':', '$checkoutPayments.method'] },
        amount: '$checkoutPayments.amount', receiptAmount: '$checkoutPayments.amount', method: '$checkoutPayments.method',
        paidAt: '$checkoutPayments.paidAt', atCheckout: { $literal: true } } },
    ] } },
    { $unionWith: { coll: Order.collection.name, pipeline: [
      { $match: { tenantId, _id: order._id, checkoutPayments: { $exists: false }, paymentMethod: { $ne: 'credit' }, paymentStatus: { $in: ['paid', 'refunded'] } } },
      { $project: { receiptKey: { $concat: ['original:', { $toString: '$_id' }] },
        amount: { $ifNull: ['$receivedAmount', '$pricing.grandTotal'] }, receiptAmount: { $ifNull: ['$receivedAmount', '$pricing.grandTotal'] },
        method: { $switch: { branches: [
          { case: { $in: ['$paymentMethod', ['counter', 'cod', 'cash_on_pickup']] }, then: 'cash' },
          { case: { $in: ['$paymentMethod', ['upi_id', 'upi_qr']] }, then: 'upi' },
        ], default: '$paymentMethod' } },
        paidAt: { $ifNull: ['$paidAt', '$paymentProof.verifiedAt', '$deliveredAt', '$createdAt'] }, legacy: { $literal: true } } },
    ] } },
    ...(filter ? [{ $match: filter }] : []),
    { $sort: { paidAt: -1, receiptKey: -1 } }, { $limit: limit + 1 },
  ]);
  return cursorMeta(rows, limit, ['paidAt', 'receiptKey']);
}
