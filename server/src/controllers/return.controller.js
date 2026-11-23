import mongoose from 'mongoose';
import Return, { ACTIVE_RETURN_STATUSES, RETURN_TYPES } from '../models/Return.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import { applyPurchaseReturnCredit } from '../services/supplierAccounting.service.js';
import PurchaseEntry from '../models/PurchaseEntry.js';
import StockLedger from '../models/StockLedger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { assertPositiveInteger, fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { parsePagination } from '../utils/query.js';
import { calculateReturnAmounts, fulfilledQuantity } from '../utils/refundAmounts.js';

const processedCustomerReturns = (order, session) => Return.find({
  tenantId: order.tenantId,
  orderId: order._id,
  type: 'customer_return',
  status: 'processed',
}).select('items totalRefundAmount totalExchangeAmount netRefund').lean().session(session);

const exchangeValueMinor = (items) => items.reduce(
  (sum, item) => sum + toMinorUnits(item.unitPrice) * item.qty, 0);

const previousReturnedQuantities = async ({ tenantId, type, referenceFilter, session }) => {
  const rows = await Return.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), type, status: { $in: ACTIVE_RETURN_STATUSES }, ...referenceFilter } },
    { $unwind: '$items' },
    { $group: { _id: '$items.variantId', quantity: { $sum: '$items.qty' } } },
  ]).session(session);
  return new Map(rows.map((row) => [String(row._id), row.quantity]));
};

const claimReturnQuantity = async ({
  Model, documentId, tenantId, variantId, quantity, maximum, legacyClaimed, session,
}) => {
  await Model.updateOne(
    {
      _id: documentId,
      tenantId,
      items: { $elemMatch: { variantId, returnReservedQty: { $exists: false } } },
    },
    { $set: { 'items.$[item].returnReservedQty': legacyClaimed } },
    { arrayFilters: [{ 'item.variantId': variantId, 'item.returnReservedQty': { $exists: false } }], session }
  );
  const claimed = await Model.updateOne(
    {
      _id: documentId,
      tenantId,
      items: { $elemMatch: { variantId, returnReservedQty: { $lte: maximum - quantity } } },
    },
    { $inc: { 'items.$[item].returnReservedQty': quantity } },
    { arrayFilters: [{ 'item.variantId': variantId }], session }
  );
  if (claimed.modifiedCount !== 1) {
    throw new AppError('Return quantity exceeds the remaining returnable quantity.', 409);
  }
};

export const createReturn = asyncHandler(async (req, res, next) => {
  const { type, orderId, supplierId, purchaseEntryId, items = [], exchangeItems = [], ...rest } = req.body;
  if (!RETURN_TYPES.includes(type)) return next(new AppError('Invalid return type.', 400));
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return next(new AppError('A return must contain between 1 and 100 items.', 400));
  }

  const created = await runInTransaction(async (session) => {
    let orderNumber;
    let customerInfo;
    let supplierName;
    let normalizedItems;
    let normalizedExchanges = [];
    let refundMinor = 0;
    let exchangeMinor = 0;
    let netMinor = 0;

    if (type === 'customer_return') {
      if (!mongoose.isValidObjectId(orderId)) throw new AppError('A valid order is required.', 400);
      const order = await Order.findOne({ _id: orderId, tenantId: req.tenantId }).session(session);
      if (!order || !['delivered', 'partially_fulfilled'].includes(order.status)) {
        throw new AppError('Only fulfilled orders can be returned.', 409);
      }
      orderNumber = order.orderNumber;
      customerInfo = { name: order.customerInfo.name, phone: order.customerInfo.phone };
      const previouslyReturned = await previousReturnedQuantities({
        tenantId: req.tenantId,
        type,
        referenceFilter: { orderId: order._id },
        session,
      });
      const seen = new Set();
      normalizedItems = items.map((requested, index) => {
        const variantId = String(requested.variantId || '');
        if (!variantId || seen.has(variantId)) throw new AppError('Returned variants must be unique.', 400);
        seen.add(variantId);
        const orderItem = order.items.find((item) => String(item.variantId) === variantId);
        if (!orderItem || String(orderItem.productId) !== String(requested.productId)) {
          throw new AppError(`Return item ${index + 1} is not part of the order.`, 400);
        }
        const qty = assertPositiveInteger(requested.qty, `items[${index}].qty`, 1000);
        const fulfilled = fulfilledQuantity(orderItem);
        if (qty + (previouslyReturned.get(variantId) || 0) > fulfilled) {
          throw new AppError(`Return quantity exceeds the fulfilled quantity for ${orderItem.name}.`, 409);
        }
        const unitMinor = toMinorUnits(orderItem.price, 'return unit price');
        return {
          productId: orderItem.productId,
          variantId: orderItem.variantId,
          name: orderItem.name,
          variantName: orderItem.variantName,
          unit: orderItem.unit,
          qty,
          unitPrice: fromMinorUnits(unitMinor),
          reason: String(requested.reason || '').trim().slice(0, 300),
          condition: requested.condition,
          restockItem: Boolean(requested.restockItem),
        };
      });

      for (const item of normalizedItems) {
        const orderItem = order.items.find((candidate) =>
          String(candidate.variantId) === String(item.variantId));
        const fulfilled = fulfilledQuantity(orderItem);
        await claimReturnQuantity({
          Model: Order,
          documentId: order._id,
          tenantId: req.tenantId,
          variantId: item.variantId,
          quantity: item.qty,
          maximum: fulfilled,
          legacyClaimed: previouslyReturned.get(String(item.variantId)) || 0,
          session,
        });
      }

      if (exchangeItems.length > 100) throw new AppError('Too many exchange items.', 400);
      normalizedExchanges = [];
      for (let index = 0; index < exchangeItems.length; index += 1) {
        const requested = exchangeItems[index];
        const qty = assertPositiveInteger(requested.qty, `exchangeItems[${index}].qty`, 1000);
        const product = await Product.findOne({
          _id: requested.productId,
          tenantId: req.tenantId,
          isActive: true,
          variants: { $elemMatch: { _id: requested.variantId, isActive: true, stock: { $gte: qty } } },
        }).session(session);
        const variant = product?.variants.id(requested.variantId);
        if (!variant) throw new AppError('An exchange item is unavailable.', 409);
        const unitMinor = toMinorUnits(variant.offerPrice ?? variant.retailPrice, 'exchange price', { allowZero: false });
        normalizedExchanges.push({
          productId: product._id,
          variantId: variant._id,
          name: product.name,
          variantName: variant.name,
          qty,
          unitPrice: fromMinorUnits(unitMinor),
        });
      }
      exchangeMinor = exchangeValueMinor(normalizedExchanges);
      const processed = await processedCustomerReturns(order, session);
      const refund = calculateReturnAmounts(order, normalizedItems, processed, {
        refundMethod: rest.refundMethod,
        exchangeMinor,
      });
      refundMinor = refund.refundMinor;
      netMinor = refund.netMinor;
      normalizedItems.forEach((item, index) => { item.refundAmount = fromMinorUnits(refund.amounts[index]); });
    } else {
      if (!mongoose.isValidObjectId(supplierId) || !mongoose.isValidObjectId(purchaseEntryId)) {
        throw new AppError('Supplier and purchase entry are required for a purchase return.', 400);
      }
      const [supplier, purchase] = await Promise.all([
        Supplier.findOne({ _id: supplierId, tenantId: req.tenantId }).session(session),
        PurchaseEntry.findOne({ _id: purchaseEntryId, tenantId: req.tenantId, supplierId }).session(session),
      ]);
      if (!supplier || !purchase) throw new AppError('Supplier or purchase entry not found.', 404);
      supplierName = supplier.name;
      const previouslyReturned = await previousReturnedQuantities({
        tenantId: req.tenantId,
        type,
        referenceFilter: { purchaseEntryId: purchase._id },
        session,
      });
      const seen = new Set();
      normalizedItems = items.map((requested, index) => {
        const variantId = String(requested.variantId || '');
        if (!variantId || seen.has(variantId)) throw new AppError('Returned variants must be unique.', 400);
        seen.add(variantId);
        const purchased = purchase.items.find((item) => String(item.variantId) === variantId);
        if (!purchased || String(purchased.productId) !== String(requested.productId)) {
          throw new AppError(`Return item ${index + 1} is not part of the purchase.`, 400);
        }
        const qty = assertPositiveInteger(requested.qty, `items[${index}].qty`, 1000);
        if (qty + (previouslyReturned.get(variantId) || 0) > purchased.quantity) {
          throw new AppError(`Return quantity exceeds purchased quantity for ${purchased.productName}.`, 409);
        }
        const unitMinor = toMinorUnits(purchased.purchasePrice, 'purchase return price');
        return {
          productId: purchased.productId,
          variantId: purchased.variantId,
          name: purchased.productName,
          variantName: purchased.variantName,
          unit: purchased.unit,
          qty,
          unitPrice: fromMinorUnits(unitMinor),
          refundAmount: 0,
          reason: String(requested.reason || '').trim().slice(0, 300),
          condition: requested.condition,
          restockItem: false,
        };
      });

      for (const item of normalizedItems) {
        const purchased = purchase.items.find((candidate) =>
          String(candidate.variantId) === String(item.variantId));
        await claimReturnQuantity({
          Model: PurchaseEntry,
          documentId: purchase._id,
          tenantId: req.tenantId,
          variantId: item.variantId,
          quantity: item.qty,
          maximum: purchased.quantity,
          legacyClaimed: previouslyReturned.get(String(item.variantId)) || 0,
          session,
        });
      }
    }

    const valueMinor = normalizedItems.reduce((sum, item) => sum + toMinorUnits(item.unitPrice) * item.qty, 0);
    const [ret] = await Return.create([{
      tenantId: req.tenantId,
      type,
      orderId: type === 'customer_return' ? orderId : undefined,
      orderNumber,
      customerInfo,
      supplierId: type === 'purchase_return' ? supplierId : undefined,
      supplierName,
      purchaseEntryId: type === 'purchase_return' ? purchaseEntryId : undefined,
      items: normalizedItems,
      exchangeItems: normalizedExchanges,
      refundMethod: rest.refundMethod,
      adjustSupplierBalance: rest.adjustSupplierBalance !== false,
      notes: String(rest.notes || '').trim().slice(0, 500),
      createdBy: req.user._id,
      createdByName: req.user.name,
      totalRefundAmount: fromMinorUnits(refundMinor),
      totalExchangeAmount: fromMinorUnits(exchangeMinor),
      netRefund: fromMinorUnits(netMinor),
      totalValue: fromMinorUnits(valueMinor),
      reservationClaimed: true,
    }], { session });
    return ret;
  });

  await logAudit({
    tenantId: req.tenantId,
    action: 'return_created',
    user: req.user,
    resource: { type: 'Return', id: created._id, label: type.replace('_', ' ') },
    description: `${type.replace('_', ' ')} created`,
    req,
  });
  sendSuccess(res, { return: created }, 201);
});

export const processReturn = asyncHandler(async (req, res, next) => {
  const { action, rejectionReason } = req.body;
  if (!['approve', 'reject'].includes(action)) return next(new AppError('Action must be approve or reject.', 400));

  const processed = await runInTransaction(async (session) => {
    const ret = await Return.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!ret) throw new AppError('Return not found.', 404);
    if (ret.status === 'processed' && action === 'approve') return ret;
    if (ret.status === 'rejected' && action === 'reject') return ret;
    if (['processed', 'rejected'].includes(ret.status)) throw new AppError('Return is already finalized.', 409);
    if (action === 'reject') {
      if (ret.reservationClaimed) {
        const Model = ret.type === 'customer_return' ? Order : PurchaseEntry;
        const documentId = ret.type === 'customer_return' ? ret.orderId : ret.purchaseEntryId;
        for (const item of ret.items) {
          const released = await Model.updateOne(
            {
              _id: documentId,
              tenantId: req.tenantId,
              items: {
                $elemMatch: {
                  variantId: item.variantId,
                  returnReservedQty: { $gte: item.qty },
                },
              },
            },
            { $inc: { 'items.$[entry].returnReservedQty': -item.qty } },
            { arrayFilters: [{ 'entry.variantId': item.variantId }], session }
          );
          if (released.modifiedCount !== 1) {
            throw new AppError('Return reservation state is inconsistent.', 409);
          }
        }
        ret.reservationClaimed = false;
      }
      ret.status = 'rejected';
      ret.processedBy = req.user._id;
      ret.processedByName = req.user.name;
      ret.processedAt = new Date();
      const reason = String(rejectionReason || '').trim().slice(0, 300);
      if (reason) ret.notes = `${ret.notes ? `${ret.notes} | ` : ''}Rejected: ${reason}`;
      await ret.save({ session });
      return ret;
    }

    const ledgerRows = [];
    const applyStock = async (item, change, movementType, note) => {
      const product = await Product.findOne({
        _id: item.productId, tenantId: req.tenantId, 'variants._id': item.variantId,
      }).select('variants').session(session);
      const variant = product?.variants.id(item.variantId);
      if (!variant) throw new AppError('Return stock item no longer exists.', 409);
      const balanceBefore = variant.stock;
      const filter = { _id: item.productId, tenantId: req.tenantId, 'variants._id': item.variantId };
      if (change < 0) filter.variants = { $elemMatch: { _id: item.variantId, stock: { $gte: -change } } };
      const result = await Product.updateOne(
        filter,
        { $inc: { 'variants.$[variant].stock': change } },
        { arrayFilters: [{ 'variant._id': item.variantId }], session }
      );
      if (result.modifiedCount !== 1) throw new AppError('Insufficient stock to process return or exchange.', 409);
      ledgerRows.push({
        tenantId: req.tenantId,
        productId: item.productId,
        variantId: item.variantId,
        movementType,
        quantityChange: change,
        balanceBefore,
        balanceAfter: balanceBefore + change,
        referenceId: ret._id,
        referenceType: 'Return',
        reason: movementType === 'RETURN_IN' ? 'return_from_customer' : undefined,
        note,
        createdBy: req.user._id,
      });
      return variant;
    };

    if (ret.type === 'customer_return') {
      // Every approval writes the same order, so a conflicting transaction retries with fresh history.
      const order = await Order.findOneAndUpdate(
        { _id: ret.orderId, tenantId: req.tenantId, status: { $in: ['delivered', 'partially_fulfilled'] } },
        { $inc: { returnApprovalRevision: 1 } },
        { new: true, session }
      ).select('+returnApprovalRevision');
      if (!order) throw new AppError('Only fulfilled orders can be returned.', 409);
      const exchangeMinor = exchangeValueMinor(ret.exchangeItems);
      const processed = await processedCustomerReturns(order, session);
      const refund = calculateReturnAmounts(order, ret.items, processed, {
        refundMethod: ret.refundMethod,
        exchangeMinor,
      });
      ret.items.forEach((item, index) => { item.refundAmount = fromMinorUnits(refund.amounts[index]); });
      ret.totalRefundAmount = fromMinorUnits(refund.refundMinor);
      ret.totalExchangeAmount = fromMinorUnits(exchangeMinor);
      ret.netRefund = fromMinorUnits(refund.netMinor);
      ret.approvalSequence = order.returnApprovalRevision;
      for (const item of ret.items) {
        if (item.restockItem) await applyStock(item, item.qty, 'RETURN_IN', `Customer return ${ret.returnNumber}`);
      }
      for (const item of ret.exchangeItems) {
        const variant = await applyStock(item, -item.qty, 'ORDER_SOLD', `Exchange ${ret.returnNumber}`);
        item.unitCost = variant.purchasePrice ?? null;
      }
    } else {
      for (const item of ret.items) {
        await applyStock(item, -item.qty, 'PURCHASE_RETURN', `Purchase return ${ret.returnNumber}`);
      }
      if (ret.adjustSupplierBalance && ret.supplierId && ret.totalValue > 0) {
        await applyPurchaseReturnCredit({ returnEntry: ret, recordedBy: req.user._id, session });
      }
    }
    if (ledgerRows.length) await StockLedger.create(ledgerRows, { session, ordered: true });
    ret.status = 'processed';
    ret.processedAt = new Date();
    ret.processedBy = req.user._id;
    ret.processedByName = req.user.name;
    await ret.save({ session });
    return ret;
  });
  sendSuccess(res, { return: processed });
});

export const getReturns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { type, status, startDate, endDate } = req.query;
  const filter = { tenantId: req.tenantId };
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  const [returns, total] = await Promise.all([
    Return.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Return.countDocuments(filter),
  ]);
  sendPaginated(res, returns, total, page, limit);
});

export const getReturn = asyncHandler(async (req, res, next) => {
  const ret = await Return.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!ret) return next(new AppError('Return not found.', 404));
  sendSuccess(res, { return: ret });
});

export const getReturnStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = { tenantId: new mongoose.Types.ObjectId(req.tenantId), status: 'processed' };
  if (startDate || endDate) {
    filter.processedAt = {};
    if (startDate) filter.processedAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.processedAt.$lte = end;
    }
  }
  const stats = await Return.aggregate([
    { $match: filter },
    { $group: {
      _id: '$type',
      count: { $sum: 1 },
      totalRefund: { $sum: '$netRefund' },
      totalValue: { $sum: '$totalValue' },
    } },
  ]);
  sendSuccess(res, { stats });
});
