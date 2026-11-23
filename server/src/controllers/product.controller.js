import { createHash } from 'node:crypto';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import StockLedger from '../models/StockLedger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { escapeRegex, parsePagination } from '../utils/query.js';
import { runInTransaction } from '../utils/transaction.js';
import { assertPositiveInteger, toMinorUnits } from '../utils/money.js';
import { lockCategoryReferences } from '../services/categoryHierarchy.service.js';

const VARIANT_FIELDS = [
  'name', 'unit', 'retailPrice', 'wholesalePrice', 'offerPrice', 'purchasePrice',
  'lowStockLimit', 'sku', 'barcode', 'isActive', 'sortOrder',
];

const productRevision = (product) => {
  // Stock movements and bulk price updates can bypass Mongoose's document version.
  const snapshot = product.toObject({ depopulate: true, virtuals: false, versionKey: false });
  const json = JSON.stringify(snapshot, (_, value) =>
    value && Object.getPrototypeOf(value) === Object.prototype
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
      : value
  );
  return createHash('sha256').update(json).digest('hex');
};

const PRODUCT_FIELDS = Object.freeze([
  'name', 'brand', 'description', 'categoryId', 'images', 'variants',
  'isActive', 'isOnline', 'isFeatured', 'tags',
]);
const productPayload = (body) => Object.fromEntries(
  PRODUCT_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])
);

export const getProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

  const filter = { tenantId: req.tenantId };

  if (req.query.search) {
    const search = new RegExp(escapeRegex(String(req.query.search).trim().slice(0, 80)), 'i');
    filter.$or = [
      { name: search }, { brand: search },
      { 'variants.sku': search }, { 'variants.barcode': search },
      { 'variants.name': search },
      { tags: { $in: [search] } },
    ];
  }

  if (req.query.categoryId) filter.categoryId = req.query.categoryId;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  if (req.query.isOnline !== undefined) filter.isOnline = req.query.isOnline === 'true';
  if (req.query.isFeatured !== undefined) filter.isFeatured = req.query.isFeatured === 'true';

  if (req.query.lowStock === 'true') {
    filter.$expr = {
      $anyElementTrue: {
        $map: {
          input: '$variants',
          as: 'variant',
          in: { $and: [
            '$$variant.isActive',
            { $gt: ['$$variant.stock', 0] },
            { $lte: ['$$variant.stock', '$$variant.lowStockLimit'] },
          ] },
        },
      },
    };
  }
  if (req.query.outOfStock === 'true') {
    filter.variants = { $elemMatch: { isActive: true, stock: { $lte: 0 } } };
  }

  const sortMap = {
    name: { name: 1 },
    '-name': { name: -1 },
    price: { 'variants.retailPrice': 1 },
    createdAt: { createdAt: -1 },
  };
  const sort = sortMap[req.query.sortBy] || { updatedAt: -1 };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('categoryId', 'name emoji'),
    Product.countDocuments(filter),
  ]);

  sendPaginated(res, products, total, page, limit);
});

export const getProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!product) return next(new AppError('Product not found.', 404));
  const revision = productRevision(product);
  await product.populate('categoryId', 'name emoji');
  sendSuccess(res, { product, revision });
});

const verifyCategory = async (categoryId, tenantId, session) => {
  if (!categoryId) return;
  await lockCategoryReferences(tenantId, session);
  const exists = await Category.exists({ _id: categoryId, tenantId }).session(session);
  if (!exists) throw new AppError('Category not found for this store.', 400);
};

export const createProduct = asyncHandler(async (req, res) => {
  const product = await runInTransaction(async (session) => {
    await verifyCategory(req.body.categoryId, req.tenantId, session);
    const [created] = await Product.create([{ ...productPayload(req.body), tenantId: req.tenantId }], { session });
    const ledger = created.variants
      .filter((variant) => Number(variant.stock) > 0)
      .map((variant) => ({
        tenantId: req.tenantId,
        productId: created._id,
        variantId: variant._id,
        movementType: 'ADJUSTMENT_ADD',
        quantityChange: variant.stock,
        balanceBefore: 0,
        balanceAfter: variant.stock,
        referenceType: 'StockAdjustment',
        reason: 'manual_correction',
        note: 'Initial product stock',
        createdBy: req.user._id,
      }));
    if (ledger.length) await StockLedger.create(ledger, { session, ordered: true });
    return created;
  });
  await product.populate('categoryId', 'name emoji');
  sendSuccess(res, { product }, 201);
});

export const updateProduct = asyncHandler(async (req, res) => {
  const { variants = [], revision, ...rest } = req.body;
  const product = await runInTransaction(async (session) => {
    await verifyCategory(rest.categoryId, req.tenantId, session);
    const current = await Product.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!current) throw new AppError('Product not found.', 404);
    if (revision !== undefined && revision !== productRevision(current)) {
      throw new AppError('This product changed while you were editing. Reload it and review the latest variants, prices and stock before saving.', 409);
    }

    current.set(productPayload(rest));
    const ledger = [];
    const seen = new Set();
    for (const incoming of variants) {
      const fields = Object.fromEntries(
        VARIANT_FIELDS.filter((field) => incoming[field] !== undefined).map((field) => [field, incoming[field]])
      );

      if (incoming._id) {
        const variantId = incoming._id.toLowerCase();
        if (seen.has(variantId)) throw new AppError('A variant can only be updated once per request.', 409);
        seen.add(variantId);
        const existing = current.variants.id(variantId);
        if (!existing) throw new AppError('Product variant no longer exists. Reload the product before editing.', 409);
        if (incoming.stock !== undefined && Number(incoming.stock) !== existing.stock) {
          throw new AppError('Use Inventory stock adjustments to change stock for an existing variant.', 409);
        }
        existing.set(fields);
        continue;
      }

      if (current.variants.length >= 100) throw new AppError('A product can have at most 100 variants.', 409);
      const stock = Number(incoming.stock ?? 0);
      const created = current.variants.create({ ...fields, stock });
      current.variants.push(created);
      if (stock > 0) ledger.push({
        tenantId: req.tenantId,
        productId: current._id,
        variantId: created._id,
        movementType: 'ADJUSTMENT_ADD',
        quantityChange: stock,
        balanceBefore: 0,
        balanceAfter: stock,
        referenceType: 'StockAdjustment',
        reason: 'manual_correction',
        note: 'Initial stock for new variant',
        createdBy: req.user._id,
      });
    }
    await current.save({ session });
    if (ledger.length) await StockLedger.create(ledger, { session, ordered: true });
    return current;
  });
  const newRevision = productRevision(product);
  await product.populate('categoryId', 'name emoji');
  sendSuccess(res, { product, revision: newRevision });
});

export const deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false, isOnline: false } },
    { new: true }
  );
  if (!product) return next(new AppError('Product not found.', 404));
  sendSuccess(res, null);
});

export const toggleProductField = asyncHandler(async (req, res, next) => {
  const allowed = ['isActive', 'isOnline', 'isFeatured'];
  const { field } = req.params;
  if (!allowed.includes(field)) return next(new AppError('Invalid toggle field.', 400));

  const product = await Product.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!product) return next(new AppError('Product not found.', 404));
  product[field] = !product[field];
  await product.save();
  sendSuccess(res, { _id: product._id, field, value: product[field] });
});

export const updateVariantStock = asyncHandler(async (req, res, next) => {
  const { stock, operation = 'set' } = req.body;
  if (!['set', 'add', 'subtract'].includes(operation)) return next(new AppError('Invalid stock operation.', 400));
  const amount = operation === 'set' ? Number(stock) : assertPositiveInteger(stock, 'stock', 1_000_000);
  if (operation === 'set' && (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000)) {
    return next(new AppError('stock must be a non-negative whole number no greater than 1000000.', 400));
  }
  const result = await runInTransaction(async (session) => {
    const product = await Product.findOne({
      _id: req.params.id, tenantId: req.tenantId, 'variants._id': req.params.variantId,
    }).session(session);
    const variant = product?.variants.id(req.params.variantId);
    if (!variant) throw new AppError('Variant not found.', 404);
    const before = variant.stock;
    const after = operation === 'add' ? before + amount
      : operation === 'subtract' ? before - amount
      : amount;
    if (!Number.isSafeInteger(after) || after < 0 || after > 1_000_000) {
      throw new AppError('The requested stock level is invalid.', 409);
    }
    const delta = after - before;
    if (delta !== 0) {
      const update = await Product.updateOne(
        {
          _id: product._id,
          tenantId: req.tenantId,
          variants: { $elemMatch: { _id: variant._id, stock: before } },
        },
        { $set: { 'variants.$[variant].stock': after } },
        { arrayFilters: [{ 'variant._id': variant._id }], session }
      );
      if (update.modifiedCount !== 1) throw new AppError('Stock changed concurrently. Please retry.', 409);
      await StockLedger.create([{
        tenantId: req.tenantId,
        productId: product._id,
        variantId: variant._id,
        movementType: delta > 0 ? 'ADJUSTMENT_ADD' : 'ADJUSTMENT_REMOVE',
        quantityChange: delta,
        balanceBefore: before,
        balanceAfter: after,
        referenceType: 'StockAdjustment',
        reason: 'manual_correction',
        note: 'Product stock editor adjustment',
        createdBy: req.user._id,
      }], { session });
    }
    variant.stock = after;
    return variant;
  });
  sendSuccess(res, { variant: result });
});

export const bulkUpdatePrices = asyncHandler(async (req, res, next) => {
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 500) {
    return next(new AppError('updates must contain between 1 and 500 price changes.', 400));
  }
  updates.forEach((update) => {
    if (!update.productId || !update.variantId) throw new AppError('Every price update requires a product and variant.', 400);
    ['retailPrice', 'wholesalePrice', 'offerPrice', 'purchasePrice'].forEach((field) => {
      if (update[field] !== undefined && update[field] !== null) {
        toMinorUnits(update[field], field, { allowZero: field === 'purchasePrice' });
      }
    });
  });
  const bulkOps = updates.map(({ productId, variantId, retailPrice, wholesalePrice, offerPrice, purchasePrice }) => ({
    updateOne: {
      filter: { _id: productId, tenantId: req.tenantId, 'variants._id': variantId },
      update: {
        $set: {
          ...(retailPrice !== undefined && { 'variants.$.retailPrice': retailPrice }),
          ...(wholesalePrice !== undefined && { 'variants.$.wholesalePrice': wholesalePrice }),
          ...(offerPrice !== undefined && { 'variants.$.offerPrice': offerPrice }),
          ...(purchasePrice !== undefined && { 'variants.$.purchasePrice': purchasePrice }),
        },
      },
    },
  }));
  await runInTransaction(async (session) => {
    const productIds = [...new Set(updates.map((update) => String(update.productId)))];
    const products = await Product.find({ _id: { $in: productIds }, tenantId: req.tenantId })
      .select('variants')
      .session(session);
    const productMap = new Map(products.map((product) => [String(product._id), product]));
    updates.forEach((update) => {
      const variant = productMap.get(String(update.productId))?.variants.id(update.variantId);
      if (!variant) throw new AppError('One or more product variants were not found.', 404);
      const retail = update.retailPrice ?? variant.retailPrice;
      const offer = update.offerPrice === null ? null : (update.offerPrice ?? variant.offerPrice);
      const wholesale = update.wholesalePrice === null
        ? null
        : (update.wholesalePrice ?? variant.wholesalePrice);
      if (offer != null && Number(offer) > Number(retail)) {
        throw new AppError('Offer price cannot exceed retail price.', 400);
      }
      if (wholesale != null && Number(wholesale) > Number(retail)) {
        throw new AppError('Wholesale price cannot exceed retail price.', 400);
      }
    });
    const result = await Product.bulkWrite(bulkOps, { session });
    if (result.matchedCount !== updates.length) throw new AppError('One or more product variants were not found.', 404);
  });
  sendSuccess(res, null);
});
