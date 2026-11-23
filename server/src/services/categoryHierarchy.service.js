import Store from '../models/Store.js';
import { AppError } from '../utils/AppError.js';

// Snapshot reads alone cannot prevent concurrent category edits from creating a
// cycle, or a product assignment from racing a category deletion.
export async function lockCategoryReferences(tenantId, session) {
  const result = await Store.updateOne(
    { _id: tenantId },
    { $inc: { categoryRevision: 1 } },
    { session, timestamps: false }
  );
  if (!result.matchedCount) throw new AppError('Store not found.', 404);
}

export function parentStatus(categoriesById, categoryId, parentId) {
  const visited = new Set([String(categoryId)]);
  while (parentId != null) {
    const key = String(parentId);
    if (visited.has(key)) return 'cycle';
    const parent = categoriesById.get(key);
    if (!parent) return 'missing';
    visited.add(key);
    parentId = parent.parentId;
  }
  return 'valid';
}
