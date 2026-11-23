import mongoose from 'mongoose';
import PurchaseEntry from '../models/PurchaseEntry.js';
import Product from '../models/Product.js';
import StockLedger from '../models/StockLedger.js';
import Supplier from '../models/Supplier.js';
import { AppError } from '../utils/AppError.js';
import { emitToTenant } from '../config/socket.js';
import { logAudit } from '../services/audit.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { PAYMENT_METHODS, postSupplierPayment, recordPurchaseOpening } from '../services/supplierAccounting.service.js';
import { assertPositiveInteger, fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { escapeRegex, parsePagination } from '../utils/query.js';

/* ─── Helper: update stock + create ledger entry ──── */
async function applyPurchaseStock(items, tenantId, userId, purchaseId, session) {
  const ledgerEntries = [];

  for (const item of items) {
    const product = await Product.findOne({ _id: item.productId, tenantId }).session(session);
    if (!product) throw new AppError(`Product ${item.productId} not found`, 404);

    const variant = product.variants.id(item.variantId);
    if (!variant) throw new AppError(`Variant ${item.variantId} not found in product`, 404);

    const balanceBefore = variant.stock;
    const newStock = balanceBefore + item.quantity;

    // Update selling price if provided
    if (item.sellingPrice) {
      variant.retailPrice = item.sellingPrice;
    }

    variant.stock = newStock;
    await product.save({ session });

    const ledger = await StockLedger.create([{
      tenantId,
      productId: item.productId,
      variantId: item.variantId,
      movementType: 'PURCHASE_IN',
      quantityChange: +item.quantity,
      balanceBefore,
      balanceAfter: newStock,
      referenceId: purchaseId,
      referenceType: 'PurchaseEntry',
      note: item.note || '',
      createdBy: userId,
    }], { session });

    item.ledgerEntryId = ledger[0]._id;

    // Snapshot product/variant names
    item.productName = product.name;
    item.variantName = variant.name;
    item.unit = variant.unit;

    ledgerEntries.push({ product, variant, newStock });
  }

  return ledgerEntries;
}

/* ─── Create purchase entry ───────────────────────── */
export const createPurchase = async (req, res, next) => {
  try {
    const {
      supplierId, supplierName, invoiceNumber, purchaseDate,
      vehicleType, vehicleNumber, items, paidAmount = 0,
      paymentMethod = 'cash', note,
    } = req.body;
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      throw new AppError('A purchase must contain between 1 and 100 items.', 400);
    }
    if (!['cash', 'upi', 'bank_transfer', 'cheque', 'credit'].includes(paymentMethod)) {
      throw new AppError('Invalid purchase payment method.', 400);
    }
    const seen = new Set();
    const normalizedItems = items.map((item, index) => {
      if (!mongoose.isValidObjectId(item.productId) || !mongoose.isValidObjectId(item.variantId)) {
        throw new AppError(`Purchase item ${index + 1} is invalid.`, 400);
      }
      const key = `${item.productId}:${item.variantId}`;
      if (seen.has(key)) throw new AppError('Purchase variants must be unique.', 400);
      seen.add(key);
      const quantity = assertPositiveInteger(item.quantity, `items[${index}].quantity`, 1_000_000);
      const purchasePrice = fromMinorUnits(toMinorUnits(item.purchasePrice, 'purchase price', { allowZero: false }));
      const sellingPrice = item.sellingPrice == null
        ? undefined
        : fromMinorUnits(toMinorUnits(item.sellingPrice, 'selling price', { allowZero: false }));
      return { ...item, quantity, purchasePrice, sellingPrice };
    });
    const expectedTotalMinor = normalizedItems.reduce(
      (sum, item) => sum + toMinorUnits(item.purchasePrice, 'purchase price') * item.quantity,
      0
    );
    const paidMinor = toMinorUnits(paidAmount, 'paid amount');
    if (!Number.isSafeInteger(expectedTotalMinor) || expectedTotalMinor <= 0) {
      throw new AppError('Purchase total is outside the supported range.', 400);
    }
    if (paidMinor > expectedTotalMinor) throw new AppError('Paid amount exceeds purchase total.', 400);
    if (paidMinor > 0 && !PAYMENT_METHODS.includes(paymentMethod)) {
      throw new AppError('Choose the actual payment method for any amount paid.', 400);
    }

    const transactionResult = await runInTransaction(async (session) => {
      const supplier = supplierId
        ? await Supplier.findOne({ _id: supplierId, tenantId: req.tenantId }).session(session) : null;
      if (supplierId && !supplier) throw new AppError('Supplier not found.', 404);
      const [purchase] = await PurchaseEntry.create([{
        tenantId: req.tenantId,
        supplierId,
        supplierName: String(supplierName || '').trim().slice(0, 120),
        invoiceNumber: String(invoiceNumber || '').trim().slice(0, 100),
        purchaseDate,
        vehicleType,
        vehicleNumber: String(vehicleNumber || '').trim().slice(0, 40),
        items: normalizedItems,
        legacyPaidAmount: 0,
        paymentMethod,
        note: String(note || '').trim().slice(0, 500),
        createdBy: req.user._id,
        isStockUpdated: false,
      }], { session });
      const stockUpdates = await applyPurchaseStock(
        purchase.items, req.tenantId, req.user._id, purchase._id, session
      );
      purchase.isStockUpdated = true;
      purchase.markModified('items');
      await purchase.save({ session });
      await recordPurchaseOpening({ purchase, supplier, paidMinor, method: paymentMethod, recordedBy: req.user._id, session });
      return { purchase, stockUpdates };
    });

    for (const { product, variant, newStock } of transactionResult.stockUpdates) {
      if (newStock <= variant.lowStockLimit) {
        emitToTenant(req.tenantId.toString(), 'stock:low', {
          productId: product._id,
          productName: product.name,
          variantId: variant._id,
          variantName: variant.name,
          stock: newStock,
          lowStockLimit: variant.lowStockLimit,
        });
      }
    }
    const populated = await PurchaseEntry.findById(transactionResult.purchase._id)
      .populate('supplierId', 'name phone')
      .populate('createdBy', 'name');
    await logAudit({
      tenantId: req.tenantId,
      action: 'purchase_added',
      user: req.user,
      resource: { type: 'PurchaseEntry', id: populated._id, label: supplierName || 'Direct purchase' },
      description: `Purchase ${populated.invoiceNumber || populated._id} added`,
      req,
    });
    res.status(201).json({ success: true, data: { purchase: populated } });
  } catch (error) {
    next(error);
  }
};

export const getPurchases = async (req, res, next) => {
  try {
    const {
      supplierId, paymentStatus, startDate, endDate,
      search,
    } = req.query;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const filter = { tenantId: req.tenantId };
    if (supplierId) filter.supplierId = supplierId;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (startDate || endDate) {
      filter.purchaseDate = {};
      if (startDate) filter.purchaseDate.$gte = new Date(startDate);
      if (endDate) filter.purchaseDate.$lte = new Date(endDate);
    }
    if (search) {
      const regex = new RegExp(escapeRegex(String(search).trim().slice(0, 80)), 'i');
      filter.$or = [{ invoiceNumber: regex }, { supplierName: regex }];
    }

    const [purchases, total] = await Promise.all([
      PurchaseEntry.find(filter)
        .populate('supplierId', 'name phone')
        .populate('createdBy', 'name')
        .sort({ purchaseDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PurchaseEntry.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { purchases },
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* ─── Get single purchase ─────────────────────────── */
export const getPurchase = async (req, res, next) => {
  try {
    const purchase = await PurchaseEntry.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('supplierId', 'name phone address gstNumber')
      .populate('createdBy', 'name');
    if (!purchase) return next(new AppError('Purchase not found', 404));
    res.json({ success: true, data: { purchase } });
  } catch (err) { next(err); }
};

/* ─── Record payment on a purchase ───────────────── */
export const recordPurchasePayment = async (req, res, next) => {
  try {
    const { purchase, payment } = await postSupplierPayment({ req, purchaseId: req.params.id });
    res.json({ success: true, data: { purchase, payment }, message: 'Payment recorded.' });
  } catch (error) {
    next(error);
  }
};

export const getPurchaseStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = { tenantId: new mongoose.Types.ObjectId(req.tenantId) };
    if (Object.keys(dateFilter).length) matchStage.purchaseDate = dateFilter;

    const [stats] = await PurchaseEntry.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalPaid: { $sum: '$paidAmount' },
          totalPending: { $sum: '$pendingAmount' },
          unpaidCount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'UNPAID'] }, 1, 0] } },
          partialCount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'PARTIAL'] }, 1, 0] } },
        },
      },
    ]);

    res.json({ success: true, data: { stats: stats || {} } });
  } catch (err) { next(err); }
};
