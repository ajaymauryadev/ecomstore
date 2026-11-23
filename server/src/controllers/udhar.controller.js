import Order from '../models/Order.js';
import { createHash } from 'node:crypto';
import UdharCustomer from '../models/UdharCustomer.js';
import UdharEntry from '../models/UdharEntry.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { escapeRegex, parsePagination } from '../utils/query.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { recordUdharEntry } from '../services/udharLedger.service.js';
import { accountingTimestamp } from '../utils/accountingDay.js';
import { prepareCustomer, ensureCustomerAllocations, allocationPreview, applyAllocations, paymentSummary, billPaymentsPage } from '../services/udharAllocation.service.js';
import { cursorFilter, cursorMeta } from '../utils/cursor.js';
import { logAudit } from '../services/audit.service.js';

export const getCustomers = asyncHandler(async (req, res) => {
  const { search, hasBalance } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, $and: [{ $or: [{ isActive: true }, { balance: { $gt: 0 } }] }] };
  if (search) {
    const pattern = new RegExp(escapeRegex(String(search).trim().slice(0, 80)), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }];
  }
  if (hasBalance === 'true') filter.balance = { $gt: 0 };
  const [customers, total] = await Promise.all([
    UdharCustomer.find(filter).sort({ balance: -1, name: 1 }).skip(skip).limit(limit),
    UdharCustomer.countDocuments(filter),
  ]);
  sendPaginated(res, customers, total, page, limit);
});

export const getCustomerStats = asyncHandler(async (req, res) => {
  const [stats] = await UdharCustomer.aggregate([
    { $match: { tenantId: req.tenantId, $or: [{ isActive: true }, { balance: { $gt: 0 } }] } },
    { $group: {
      _id: null,
      totalCustomers: { $sum: 1 },
      totalDue: { $sum: '$balance' },
      customersWithDue: { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } },
      maxDue: { $max: '$balance' },
    } },
  ]);
  sendSuccess(res, stats ?? { totalCustomers: 0, totalDue: 0, customersWithDue: 0, maxDue: 0 });
});

export const createCustomer = asyncHandler(async (req, res, next) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const phone = String(req.body.phone || '').trim() || undefined;
  if (!name) return next(new AppError('Customer name is required.', 400));
  if (phone && !/^[6-9]\d{9}$/.test(phone)) return next(new AppError('Customer phone is invalid.', 400));
  if (phone && await UdharCustomer.exists({ tenantId: req.tenantId, phone, isActive: true })) {
    return next(new AppError('A customer with this phone already exists.', 409));
  }
  const customer = await UdharCustomer.create({
    tenantId: req.tenantId,
    name,
    phone,
    address: String(req.body.address || '').trim().slice(0, 500),
    notes: String(req.body.notes || '').trim().slice(0, 500),
  });
  sendSuccess(res, { customer }, 201);
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await runInTransaction(async (session) => {
    const customer = await UdharCustomer.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!customer) throw new AppError('Customer not found.', 404);
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 100);
      if (!name) throw new AppError('Customer name cannot be empty.', 400);
      customer.name = name;
    }
    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone || '').trim();
      if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new AppError('Customer phone is invalid.', 400);
      customer.phone = phone || undefined;
    }
    if (req.body.address !== undefined) customer.address = String(req.body.address || '').trim().slice(0, 500);
    if (req.body.notes !== undefined) customer.notes = String(req.body.notes || '').trim().slice(0, 500);
    if (req.body.isActive !== undefined) customer.isActive = Boolean(req.body.isActive);
    await customer.save({ session });
    return customer;
  });
  sendSuccess(res, { customer });
});

export const getCustomerLedger = asyncHandler(async (req, res, next) => {
  const customer = await prepareCustomer(req.tenantId, req.params.id);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 5, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, customerId: customer._id };
  const after = cursorFilter(req.query.cursor, ['date', 'createdAt', '_id']);
  const pageFilter = after ? { $and: [filter, after] } : filter;
  const [entries, total, [summary]] = await Promise.all([
    UdharEntry.find(pageFilter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(after ? 0 : skip).limit(limit + 1)
      .populate({ path: 'recordedBy', match: { tenantId: req.tenantId }, select: 'name role' }).lean(),
    UdharEntry.countDocuments(filter),
    UdharEntry.aggregate([
      { $match: filter },
      { $group: { _id: null,
        totalDebits: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'debit'] }, { $ne: [{ $ifNull: ['$allocationMode', ''] }, 'reversal'] }] }, '$amount', 0] } },
        totalCredits: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'credit'] }, { $eq: [{ $ifNull: ['$voidedAt', null] }, null] }] }, '$amount', 0] } },
      } },
    ]),
  ]);
  const paged = cursorMeta(entries, limit, ['date', 'createdAt', '_id']);
  const orderIds = paged.data.filter((entry) => ['order', 'pos_order'].includes(entry.referenceType) && entry.referenceId)
    .map((entry) => entry.referenceId);
  const orders = await Order.find({ tenantId: req.tenantId, _id: { $in: orderIds } })
    .select('orderNumber orderType saleType status paymentStatus createdAt paidAt receivedAmount settlement checkoutPayments udharAmount items.name items.variantName items.unit items.quantity items.fulfilledQty items.price items.total pricing.grandTotal').lean();
  const history = new Map();
  for (const order of orders) {
    const payments = await billPaymentsPage(req.tenantId, customer._id, order);
    history.set(String(order._id), { ...order, paymentSummary: { ...paymentSummary(order),
      payments: payments.data.filter((row) => !row.adjustment && !row.voidedAt),
      adjustments: payments.data.filter((row) => row.adjustment), paymentsMeta: payments.meta } });
  }
  const totalPages = Math.ceil(total / limit);
  sendSuccess(res, {
    customer,
    entries: paged.data.map((entry) => ({ ...entry, order: history.get(String(entry.referenceId)) || null })),
    summary: { totalDebits: fromMinorUnits(Math.round((summary?.totalDebits || 0) * 100)), totalCredits: fromMinorUnits(Math.round((summary?.totalCredits || 0) * 100)) },
    meta: { total, page, limit, totalPages, hasPrevPage: page > 1 || Boolean(after), ...paged.meta },
  });
});

const createLedgerEntry = async ({ req, type }) => {
  const amountMinor = toMinorUnits(req.body.amount, 'amount', { allowZero: false });
  const date = accountingTimestamp(req.body.date, req.storeTimeZone);
  const key = req.get('Idempotency-Key');
  if (key !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(key)) throw new AppError('Invalid Idempotency-Key header.', 400);
  const paymentSubmission = type === 'credit' && key ? {
    keyHash: createHash('sha256').update(key).digest('hex'),
    requestHash: createHash('sha256').update(JSON.stringify([String(req.user._id), req.params.id, req.body], (_, value) =>
      value && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.keys(value).sort().map((field) => [field, value[field]])) : value)).digest('hex'),
  } : undefined;
  const existingPayment = (session) => UdharEntry.findOne({ tenantId: req.tenantId,
    'paymentSubmission.keyHash': paymentSubmission.keyHash }).select('+paymentSubmission').session(session);
  const replay = async (entry, session) => {
    if (entry.paymentSubmission.requestHash !== paymentSubmission.requestHash) throw new AppError('This payment submission key was already used with different details.', 409);
    const customer = await UdharCustomer.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    return { customer, entry, replayed: true };
  };
  const work = async (session) => {
    if (paymentSubmission) {
      const existing = await existingPayment(session);
      if (existing) return replay(existing, session);
    }
    const customer = await UdharCustomer.findOne({
      _id: req.params.id, tenantId: req.tenantId, ...(type === 'debit' && { isActive: true }),
    }).session(session);
    if (!customer) throw new AppError('Customer not found.', 404);
    const entry = await recordUdharEntry({
      customer,
      type,
      amountMinor,
      method: type === 'credit' ? req.body.method ?? 'cash' : undefined,
      description: String(req.body.description || (type === 'debit' ? 'Credit sale' : 'Payment received'))
        .trim().slice(0, 300),
      referenceType: type === 'debit' ? req.body.referenceType : undefined,
      referenceId: type === 'debit' ? req.body.referenceId : undefined,
      actor: req.user,
      date,
      session,
      targetOrderId: type === 'credit' ? req.body.orderId : undefined,
      paymentSubmission,
    });
    return { customer, entry };
  };
  try { return await runInTransaction(work); }
  catch (error) {
    if (paymentSubmission && error.code === 11000 && error.keyPattern?.['paymentSubmission.keyHash']) {
      const entry = await existingPayment(null);
      if (entry) return replay(entry, null);
    }
    throw error;
  }
};

export const addDebit = asyncHandler(async (req, res) => {
  const result = await createLedgerEntry({ req, type: 'debit' });
  sendSuccess(res, result, 201);
});

export const addCredit = asyncHandler(async (req, res) => {
  const result = await createLedgerEntry({ req, type: 'credit' });
  if (!result.replayed) await logAudit({ tenantId: req.tenantId, action: 'udhar_payment_received', user: req.user,
    resource: { type: 'UdharEntry', id: result.entry._id }, description: `Received ${result.entry.amount} by ${result.entry.method}`, req });
  sendSuccess(res, result, result.replayed ? 200 : 201);
});

export const previewPayment = asyncHandler(async (req, res) => {
  const customer = await prepareCustomer(req.tenantId, req.params.id);
  const amount = toMinorUnits(req.query.amount, 'amount', { allowZero: false });
  const allocations = await allocationPreview(customer, amount, req.query.orderId);
  sendSuccess(res, { allocations, customerBalance: customer.balance });
});

export const getCustomerBills = asyncHandler(async (req, res) => {
  const customer = await prepareCustomer(req.tenantId, req.params.id);
  const { limit } = parsePagination(req.query, { defaultLimit: 5, maxLimit: 100 });
  const after = cursorFilter(req.query.cursor, ['createdAt', '_id']);
  const filter = { tenantId: req.tenantId, udharCustomerId: customer._id,
    ...(req.query.hasDue === 'true' && { 'settlement.pending': { $gt: 0 }, status: { $nin: ['cancelled', 'rejected'] } }),
    ...(after && { $and: [after] }) };
  const rows = await Order.find(filter).select('orderNumber udharCustomerId pricing items.name items.variantName items.quantity items.price items.total status paymentStatus checkoutPayments receivedAmount paidAt udharAmount settlement createdAt')
    .sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const result = cursorMeta(rows, limit, ['createdAt', '_id']);
  sendSuccess(res, { ...result, data: result.data.map((order) => ({ ...order, paymentSummary: paymentSummary(order) })) });
});

export const getBillPayments = asyncHandler(async (req, res) => {
  const customer = await prepareCustomer(req.tenantId, req.params.id);
  const order = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId, udharCustomerId: customer._id }).lean();
  if (!order) throw new AppError('Bill not found for this account.', 404);
  sendSuccess(res, { ...await billPaymentsPage(req.tenantId, customer._id, order, req.query), summary: paymentSummary(order) });
});

export const reversePayment = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async (session) => {
    const customer = await UdharCustomer.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!customer) throw new AppError('Customer not found.', 404);
    await ensureCustomerAllocations(customer, session);
    const payment = await UdharEntry.findOne({ _id: req.params.entryId, tenantId: req.tenantId, customerId: customer._id,
      type: 'credit', referenceType: 'manual' }).session(session);
    if (!payment) throw new AppError('Account payment not found.', 404);
    const existing = await UdharEntry.findOne({ tenantId: req.tenantId, reversalOf: payment._id }).session(session);
    if (existing) return { customer, entry: existing };
    const reason = req.body.reason.trim();
    await applyAllocations(customer, payment.allocations || [], { reverse: true, actor: req.user }, session);
    const nextBalance = toMinorUnits(customer.balance) + toMinorUnits(payment.amount);
    if (!Number.isSafeInteger(nextBalance)) throw new AppError('Customer balance exceeds the supported amount range.', 409);
    customer.balance = fromMinorUnits(nextBalance);
    await customer.save({ session });
    payment.voidedAt = new Date(); payment.voidReason = reason;
    await payment.save({ session });
    const [entry] = await UdharEntry.create([{ tenantId: req.tenantId, customerId: customer._id, type: 'debit',
      amount: payment.amount, balanceAfter: customer.balance, reversalOf: payment._id,
      allocationMode: 'reversal', allocations: payment.allocations, description: `Payment corrected: ${reason}`,
      recordedBy: req.user._id, recordedByName: req.user.name, recordedByRole: req.user.role }], { session });
    return { customer, entry };
  });
  await logAudit({ tenantId: req.tenantId, action: 'udhar_payment_reversed', user: req.user,
    resource: { type: 'UdharEntry', id: result.entry._id }, description: req.body.reason, req });
  sendSuccess(res, result);
});

export const getLegacyCreditBills = asyncHandler(async (req, res) => {
  if (!req.tenantId) throw new AppError('Tenant context required.', 403);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25, maxLimit: 100 });
  const [report] = await Order.aggregate([
    { $match: {
      tenantId: req.tenantId,
      orderType: 'counter',
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: { $nin: ['cancelled', 'rejected'] },
      udharCustomerId: null,
    } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $facet: {
      bills: [
        { $skip: skip },
        { $limit: limit },
        { $lookup: {
          from: UdharEntry.collection.name,
          localField: '_id',
          foreignField: 'referenceId',
          pipeline: [
            { $match: { tenantId: req.tenantId, type: 'debit', referenceType: { $in: ['pos_order', 'order'] } } },
            { $project: { _id: 1, customerId: 1, amount: 1 } },
          ],
          as: 'debits',
        } },
        { $project: {
          orderNumber: 1,
          status: 1,
          createdAt: 1,
          customerInfo: { name: '$customerInfo.name', phone: '$customerInfo.phone' },
          amount: '$pricing.grandTotal',
          debits: 1,
        } },
      ],
      count: [{ $count: 'total' }],
    } },
  ]);
  const bills = report.bills.map(({ debits, ...bill }) => ({
    ...bill,
    debits,
    reconciliation: debits.length === 0 ? 'missing_debit'
      : debits.length === 1 && Number.isFinite(bill.amount) && Number.isFinite(debits[0].amount)
          && Math.round(debits[0].amount * 100) === Math.round(bill.amount * 100)
        ? 'debit_found' : 'review_debits',
  }));
  sendPaginated(res, bills, report.count[0]?.total ?? 0, page, limit);
});

export const getAllDues = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, balance: { $gt: 0 } };
  const [customers, total] = await Promise.all([
    UdharCustomer.find(filter).sort({ balance: -1 }).skip(skip).limit(limit),
    UdharCustomer.countDocuments(filter),
  ]);
  sendPaginated(res, customers, total, page, limit);
});
