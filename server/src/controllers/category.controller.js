import Category from '../models/Category.js';
import Product from '../models/Product.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { runInTransaction } from '../utils/transaction.js';
import { lockCategoryReferences, parentStatus } from '../services/categoryHierarchy.service.js';

async function validateParent(tenantId, categoryId, parentId, session) {
  if (parentId == null) return;

  const categories = await Category.find({ tenantId }).select('parentId').lean().session(session);
  const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
  const status = parentStatus(categoriesById, categoryId, parentId);
  if (status === 'cycle') throw new AppError('This parent would create or preserve a category cycle.', 409);
  if (status === 'missing') throw new AppError('Choose a parent with a complete hierarchy in this store.', 400);
}

export const getCategories = asyncHandler(async (req, res) => {
  const [categories, productCounts] = await Promise.all([
    Category.find({ tenantId: req.tenantId }).sort({ sortOrder: 1, name: 1 }),
    Product.aggregate([
      { $match: { tenantId: req.tenantId, categoryId: { $ne: null } } },
      { $group: {
        _id: '$categoryId',
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
      } },
    ]),
  ]);
  const productCountsById = new Map(productCounts.map((row) => [String(row._id), row]));
  const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
  const childCounts = new Map();
  for (const category of categories) {
    if (category.parentId == null) continue;
    const parentId = String(category.parentId);
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  }

  const enriched = categories.map((category) => {
    const id = String(category._id);
    const counts = productCountsById.get(id);
    return {
      ...category.toJSON(),
      productCount: counts?.active ?? 0,
      productReferenceCount: counts?.total ?? 0,
      childCount: childCounts.get(id) ?? 0,
      parentStatus: parentStatus(categoriesById, id, category.parentId),
    };
  });

  sendSuccess(res, { categories: enriched });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description, emoji, image, parentId, sortOrder } = req.body;
  const tenantId = req.tenantId;

  const category = await runInTransaction(async (session) => {
    await lockCategoryReferences(tenantId, session);
    const existing = await Category.exists({ tenantId, name: name.trim() }).session(session);
    if (existing) throw new AppError('A category with this name already exists.', 409);

    const created = new Category({ tenantId, name, description, emoji: emoji || undefined, image, parentId, sortOrder });
    await validateParent(tenantId, created._id, created.parentId, session);
    return created.save({ session });
  });

  sendSuccess(res, { category }, 201);
});

export const updateCategory = asyncHandler(async (req, res) => {
  const allowed = ['name', 'description', 'emoji', 'image', 'parentId', 'sortOrder', 'isActive'];
  const updates = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const tenantId = req.tenantId;
  const category = await runInTransaction(async (session) => {
    await lockCategoryReferences(tenantId, session);
    const current = await Category.findOne({ _id: req.params.id, tenantId }).session(session);
    if (!current) throw new AppError('Category not found.', 404);

    current.set(updates);
    if ('parentId' in updates) await validateParent(tenantId, current._id, current.parentId, session);
    return current.save({ session });
  });
  sendSuccess(res, { category });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  await runInTransaction(async (session) => {
    await lockCategoryReferences(tenantId, session);
    const category = await Category.findOne({ _id: req.params.id, tenantId }).session(session);
    if (!category) throw new AppError('Category not found.', 404);

    const child = await Category.exists({ tenantId, parentId: category._id }).session(session);
    const product = await Product.exists({ tenantId, categoryId: category._id }).session(session);
    if (child || product) {
      throw new AppError('This category is in use. Archive it or move its products and child categories before deleting.', 409);
    }

    await category.deleteOne({ session });
  });
  sendSuccess(res, null);
});

export const reorderCategories = asyncHandler(async (req, res) => {
  const { orders } = req.body;
  if (!Array.isArray(orders)) return;

  await Category.bulkWrite(
    orders.map(({ id, sortOrder }) => ({
      updateOne: {
        filter: { _id: id, tenantId: req.tenantId },
        update: { $set: { sortOrder } },
      },
    }))
  );

  sendSuccess(res, null);
});
