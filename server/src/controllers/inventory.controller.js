import mongoose from 'mongoose';
import Product from '../models/Product.js';
import StockLedger, { ADJUSTMENT_REASONS } from '../models/StockLedger.js';
import { AppError } from '../utils/AppError.js';
import { emitToTenant } from '../config/socket.js';
import { notifyAdmin } from '../services/notification.service.js';
import { logAudit } from '../services/audit.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { assertPositiveInteger } from '../utils/money.js';
import { escapeRegex, parsePagination } from '../utils/query.js';
import { inventoryStockExpression } from '../utils/inventoryQuery.js';

/* ─── Inventory dashboard ─────────────────────────── */
export const getInventoryDashboard = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;

    // Aggregate all variant stock across products
    const [stats] = await Product.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), isActive: true } },
      { $unwind: '$variants' },
      { $match: { 'variants.isActive': true } },
      {
        $group: {
          _id: null,
          totalProducts: { $addToSet: '$_id' },
          totalVariants: { $sum: 1 },
          totalStockUnits: { $sum: '$variants.stock' },
          totalStockValue: {
            $sum: {
              $multiply: ['$variants.stock', { $ifNull: ['$variants.purchasePrice', '$variants.retailPrice'] }],
            },
          },
          totalRetailValue: {
            $sum: { $multiply: ['$variants.stock', '$variants.retailPrice'] },
          },
          outOfStockCount: { $sum: { $cond: [{ $lte: ['$variants.stock', 0] }, 1, 0] } },
          lowStockCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$variants.stock', 0] },
                    { $lte: ['$variants.stock', '$variants.lowStockLimit'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          totalProducts: { $size: '$totalProducts' },
          totalVariants: 1,
          totalStockUnits: 1,
          totalStockValue: { $round: ['$totalStockValue', 2] },
          totalRetailValue: { $round: ['$totalRetailValue', 2] },
          outOfStockCount: 1,
          lowStockCount: 1,
          potentialProfit: { $round: [{ $subtract: ['$totalRetailValue', '$totalStockValue'] }, 2] },
        },
      },
    ]);

    res.json({ success: true, data: { stats: stats || {} } });
  } catch (err) { next(err); }
};

/* ─── Get all products with stock info ────────────── */
export const getInventoryList = async (req, res, next) => {
  try {
    const {
      categoryId, stockStatus, search,
    } = req.query;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });

    const filter = { tenantId: req.tenantId, isActive: true };
    if (categoryId) filter.categoryId = categoryId;
    if (search) {
      const regex = new RegExp(escapeRegex(String(search).trim().slice(0, 80)), 'i');
      filter.$or = [{ name: regex }, { brand: regex }];
    }

    const stockExpression = inventoryStockExpression(stockStatus);
    if (stockExpression) filter.$expr = stockExpression;
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select('name brand categoryId images variants isActive')
        .populate({ path: 'categoryId', select: 'name emoji', match: { tenantId: req.tenantId } })
        .sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
    // Mongoose's built-in lean() does not execute schema virtuals.
    const paginated = products.map((product) => ({ ...product,
      mainImage: product.images?.find((image) => image.isMain)?.url ?? product.images?.[0]?.url ?? null,
    }));

    res.json({
      success: true,
      data: { products: paginated },
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* ─── Low stock page ──────────────────────────────── */
export const getLowStockProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
    const { focusProductId, focusVariantId } = req.query;
    if ((focusProductId && !mongoose.isValidObjectId(focusProductId)) ||
        (focusVariantId && !mongoose.isValidObjectId(focusVariantId))) throw new AppError('Invalid stock reference.', 400);
    const [result] = await Product.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(req.tenantId), isActive: true } },
      { $unwind: '$variants' },
      {
        $match: {
          'variants.isActive': true,
          $expr: {
            $and: [
              { $gte: ['$variants.stock', 0] },
              { $lte: ['$variants.stock', '$variants.lowStockLimit'] },
            ],
          },
        },
      },
      { $facet: {
        count: [{ $count: 'total' }],
        products: [
          { $sort: { 'variants.stock': 1, name: 1, _id: 1, 'variants._id': 1 } },
          { $skip: skip }, { $limit: limit },
          { $lookup: {
            from: 'categories', localField: 'categoryId', foreignField: '_id',
            pipeline: [{ $match: { tenantId: new mongoose.Types.ObjectId(req.tenantId) } },
              { $project: { name: 1, emoji: 1 } }],
            as: 'category',
          } },
          { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
          { $project: { name: 1, brand: 1, images: 1,
            'category.name': 1, 'category.emoji': 1, variant: '$variants' } },
        ],
      } },
    ]);
    // Notifications can open a specific variant even when it is not on page one.
    let focus = null;
    if (focusProductId && focusVariantId) {
      const product = await Product.findOne({ _id: focusProductId, tenantId: req.tenantId, isActive: true })
        .select('name brand images variants').lean();
      const variant = product?.variants.find((v) => String(v._id) === focusVariantId &&
        v.isActive && v.stock >= 0 && v.stock <= v.lowStockLimit);
      if (variant) focus = { ...product, variants: undefined, variant };
    }
    const total = result.count[0]?.total ?? 0;
    res.json({ success: true, data: { products: result.products, focus },
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

/* ─── Stock adjustment ────────────────────────────── */
export const adjustStock = async (req, res, next) => {
  try {
    const { productId, variantId, adjustmentType, quantity, reason, note } = req.body;
    if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId)) {
      throw new AppError('A valid product and variant are required.', 400);
    }
    if (!ADJUSTMENT_REASONS.includes(reason)) throw new AppError('Invalid adjustment reason.', 400);
    if (!['add', 'remove'].includes(adjustmentType)) throw new AppError('Invalid adjustment type.', 400);
    const qty = assertPositiveInteger(quantity, 'quantity', 1_000_000);

    const result = await runInTransaction(async (session) => {
      const product = await Product.findOne({
        _id: productId, tenantId: req.tenantId, 'variants._id': variantId,
      }).session(session);
      const variant = product?.variants.id(variantId);
      if (!variant) throw new AppError('Product variant not found.', 404);
      const balanceBefore = variant.stock;
      const quantityChange = adjustmentType === 'add' ? qty : -qty;
      const filter = { _id: productId, tenantId: req.tenantId, 'variants._id': variantId };
      if (adjustmentType === 'remove') {
        filter.variants = { $elemMatch: { _id: variantId, stock: { $gte: qty } } };
      }
      const update = await Product.updateOne(
        filter,
        { $inc: { 'variants.$[variant].stock': quantityChange } },
        { arrayFilters: [{ 'variant._id': variantId }], session }
      );
      if (update.modifiedCount !== 1) throw new AppError('Insufficient stock for this adjustment.', 409);
      const balanceAfter = balanceBefore + quantityChange;
      await StockLedger.create([{
        tenantId: req.tenantId,
        productId,
        variantId,
        movementType: adjustmentType === 'add' ? 'ADJUSTMENT_ADD' : 'ADJUSTMENT_REMOVE',
        quantityChange,
        balanceBefore,
        balanceAfter,
        referenceType: 'StockAdjustment',
        reason,
        note: String(note || '').trim().slice(0, 500),
        createdBy: req.user._id,
      }], { session });
      return {
        productId: product._id,
        productName: product.name,
        variantId: variant._id,
        variantName: variant.name,
        lowStockLimit: variant.lowStockLimit,
        balanceAfter,
        quantityChange,
      };
    });

    if (result.balanceAfter > 0 && result.balanceAfter <= result.lowStockLimit) {
      emitToTenant(req.tenantId.toString(), 'stock:low', result);
      await notifyAdmin(req.tenantId, 'low_stock', 'Low Stock Alert',
        `${result.productName} (${result.variantName}) is low on stock`, result);
    }
    await logAudit({
      tenantId: req.tenantId,
      action: 'stock_adjusted',
      user: req.user,
      resource: { type: 'Product', id: result.productId, label: `${result.productName} (${result.variantName})` },
      description: `${adjustmentType} ${qty} units - ${reason}`,
      req,
    });
    res.json({
      success: true,
      data: { stock: result.balanceAfter, quantityChange: result.quantityChange },
      message: 'Stock adjusted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

export const getStockLedger = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { variantId, movementType } = req.query;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });

    const filter = { tenantId: req.tenantId, productId };
    if (variantId) filter.variantId = variantId;
    if (movementType) filter.movementType = movementType;

    const [entries, total] = await Promise.all([
      StockLedger.find(filter)
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StockLedger.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { entries },
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* ─── Stock value report ──────────────────────────── */
export const getStockValueReport = async (req, res, next) => {
  try {
    const { categoryId } = req.query;
    const matchFilter = {
      tenantId: new mongoose.Types.ObjectId(req.tenantId),
      isActive: true,
    };
    if (categoryId) matchFilter.categoryId = new mongoose.Types.ObjectId(categoryId);

    const report = await Product.aggregate([
      { $match: matchFilter },
      { $unwind: '$variants' },
      { $match: { 'variants.isActive': true, 'variants.stock': { $gt: 0 } } },
      {
        $lookup: {
          from: 'categories',
          localField: 'categoryId',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$categoryId',
          categoryName: { $first: '$category.name' },
          categoryEmoji: { $first: '$category.emoji' },
          totalStockValue: {
            $sum: {
              $multiply: [
                '$variants.stock',
                { $ifNull: ['$variants.purchasePrice', '$variants.retailPrice'] },
              ],
            },
          },
          totalRetailValue: {
            $sum: { $multiply: ['$variants.stock', '$variants.retailPrice'] },
          },
          productCount: { $addToSet: '$_id' },
          variantCount: { $sum: 1 },
        },
      },
      {
        $project: {
          categoryName: 1,
          categoryEmoji: 1,
          totalStockValue: { $round: ['$totalStockValue', 2] },
          totalRetailValue: { $round: ['$totalRetailValue', 2] },
          potentialProfit: {
            $round: [{ $subtract: ['$totalRetailValue', '$totalStockValue'] }, 2],
          },
          productCount: { $size: '$productCount' },
          variantCount: 1,
        },
      },
      { $sort: { totalStockValue: -1 } },
    ]);

    res.json({ success: true, data: { report } });
  } catch (err) { next(err); }
};
