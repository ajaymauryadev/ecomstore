import Order from '../models/Order.js';
import UdharEntry from '../models/UdharEntry.js';
import UdharCustomer from '../models/UdharCustomer.js';
import Return from '../models/Return.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { parsePagination } from '../utils/query.js';
import { accountingDate, accountingDateFilter } from '../utils/accountingDay.js';
import { fromMinorUnits } from '../utils/money.js';
import { AppError } from '../utils/AppError.js';
import { cursorFilter, cursorMeta } from '../utils/cursor.js';

const source = { $switch: { branches: [
  { case: { $eq: ['$orderType', 'counter'] }, then: 'pos' },
  { case: { $in: ['$orderType', ['home_delivery', 'online']] }, then: 'delivery' },
  { case: { $eq: ['$orderType', 'self_pickup'] }, then: 'pickup' },
  { case: { $eq: ['$orderType', 'wholesale'] }, then: 'wholesale' },
], default: 'other' } };
const minor = (value) => ({ $toLong: { $round: [{ $multiply: [value, 100] }, 0] } });
const amountRows = (rows) => rows.map(({ _id, minor: value, ...row }) => ({ key: _id, amount: fromMinorUnits(Number(value)), ...row }));

export const getSalesOverview = asyncHandler(async (req, res) => {
  const today = accountingDate(undefined, req.storeTimeZone);
  const startDate = req.query.startDate || today;
  const endDate = req.query.endDate || startDate;
  const period = accountingDateFilter(startDate, endDate, req.storeTimeZone);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 5, maxLimit: 100 });
  const after = cursorFilter(req.query.cursor, ['receivedAt', 'receiptKey'], { stringId: true });
  if (period.$lt - period.$gte > 367 * 86400000) throw new AppError('Choose a sales period of up to one year.', 400);
  const tid = req.tenantId;
  const [sales, [receipts], [dues], refunds] = await Promise.all([
    Order.aggregate([
      { $match: { tenantId: tid, status: 'delivered', deliveredAt: period } },
      { $group: { _id: source, minor: { $sum: minor('$pricing.grandTotal') }, count: { $sum: 1 },
        creditMinor: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'credit'] }, minor({ $max: [0, { $subtract: ['$pricing.grandTotal', { $ifNull: ['$receivedAmount', 0] }] }] }), 0] } },
      } },
    ]),
    Order.aggregate([
      // Receipt dates follow Day Close, including historical paid orders without paidAt.
      { $match: { tenantId: tid, checkoutPayments: { $exists: false }, paymentMethod: { $ne: 'credit' }, $or: [
        { paidAt: period },
        { paidAt: null, paymentStatus: { $in: ['paid', 'refunded'] }, $or: [
          { createdAt: period }, { deliveredAt: period }, { 'paymentProof.verifiedAt': period },
        ] },
      ] } },
      { $set: { receivedAt: { $ifNull: ['$paidAt', { $cond: [
        { $eq: ['$orderType', 'counter'] }, '$createdAt',
        { $ifNull: ['$paymentProof.verifiedAt', '$deliveredAt', '$createdAt'] },
      ] }] } } },
      { $match: { receivedAt: period } },
      { $project: { orderId: '$_id', orderNumber: 1, customerName: '$customerInfo.name',
        receiptKey: { $concat: ['order:', { $toString: '$_id' }] },
        source, receivedAt: 1, method: '$paymentMethod',
        minor: minor({ $ifNull: ['$receivedAmount', '$pricing.grandTotal'] }),
      } },
      { $unionWith: { coll: Order.collection.name, pipeline: [
        { $match: { tenantId: tid, 'checkoutPayments.paidAt': period } },
        { $unwind: '$checkoutPayments' },
        { $match: { 'checkoutPayments.paidAt': period } },
        { $project: { orderId: '$_id', orderNumber: 1, customerName: '$customerInfo.name', source,
          receiptKey: { $concat: ['checkout:', { $toString: '$_id' }, ':', '$checkoutPayments.method'] },
          receivedAt: '$checkoutPayments.paidAt', method: '$checkoutPayments.method', minor: minor('$checkoutPayments.amount') } },
      ] } },
      { $unionWith: { coll: UdharEntry.collection.name, pipeline: [
        { $match: { tenantId: tid, date: period, type: 'credit', voidedAt: null, referenceType: { $nin: ['order', 'pos_order'] } } },
        { $lookup: { from: UdharCustomer.collection.name, localField: 'customerId', foreignField: '_id',
          pipeline: [{ $match: { tenantId: tid } }, { $project: { name: 1 } }], as: 'customer' } },
        { $project: { customerId: 1, customerName: { $first: '$customer.name' }, source: { $literal: 'udhar' },
          receiptKey: { $concat: ['ledger:', { $toString: '$_id' }] }, allocations: 1,
          receivedAt: '$date', method: { $ifNull: ['$method', 'unclassified'] },
          minor: minor('$amount'), recordedByName: 1, description: 1,
        } },
      ] } },
      { $set: { method: { $switch: { branches: [
        { case: { $in: ['$method', ['counter', 'cod', 'cash_on_pickup', 'cash']] }, then: 'cash' },
        { case: { $in: ['$method', ['upi', 'upi_id', 'upi_qr']] }, then: 'upi' },
      ], default: '$method' } } } },
      { $facet: {
        totals: [{ $group: { _id: null, minor: { $sum: '$minor' }, count: { $sum: 1 } } }],
        bySource: [{ $group: { _id: '$source', minor: { $sum: '$minor' }, count: { $sum: 1 } } }],
        byMethod: [{ $group: { _id: { $ifNull: ['$method', 'unclassified'] }, minor: { $sum: '$minor' }, count: { $sum: 1 } } }],
        transactions: [...(after ? [{ $match: after }] : []), { $sort: { receivedAt: -1, receiptKey: -1 } }, { $skip: after ? 0 : skip }, { $limit: limit + 1 }],
      } },
    ]),
    UdharCustomer.aggregate([
      { $match: { tenantId: tid, balance: { $gt: 0 } } },
      { $group: { _id: null, minor: { $sum: minor('$balance') } } },
    ]),
    Return.aggregate([
      { $match: { tenantId: tid, type: 'customer_return', status: 'processed', processedAt: period,
        refundMethod: { $in: ['cash', 'upi'] }, netRefund: { $gt: 0 } } },
      { $group: { _id: null, minor: { $sum: minor('$netRefund') } } },
    ]),
  ]);
  const salesMinor = sales.reduce((sum, row) => sum + Number(row.minor), 0);
  const receiptMinor = Number(receipts.totals[0]?.minor || 0);
  const refundMinor = Number(refunds[0]?.minor || 0);
  const total = receipts.totals[0]?.count || 0;
  const paged = cursorMeta(receipts.transactions, limit, ['receivedAt', 'receiptKey']);
  sendSuccess(res, {
    startDate, endDate,
    summary: {
      sales: fromMinorUnits(salesMinor), received: fromMinorUnits(receiptMinor),
      refunds: fromMinorUnits(refundMinor), netReceived: fromMinorUnits(receiptMinor - refundMinor),
      outstandingUdhar: fromMinorUnits(Number(dues?.minor || 0)),
      creditSales: fromMinorUnits(sales.reduce((sum, row) => sum + Number(row.creditMinor), 0)),
      orderCount: sales.reduce((sum, row) => sum + row.count, 0),
    },
    salesBySource: amountRows(sales.map(({ creditMinor, ...row }) => row)),
    receiptsBySource: amountRows(receipts.bySource), receiptsByMethod: amountRows(receipts.byMethod),
    transactions: paged.data.map(({ minor: value, ...row }) => ({ ...row, amount: fromMinorUnits(Number(value)) })),
    meta: { total, page, totalPages: Math.ceil(total / limit), hasPrevPage: page > 1 || Boolean(after), ...paged.meta },
  });
});
