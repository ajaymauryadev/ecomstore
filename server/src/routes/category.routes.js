import { Router } from 'express';
import { body } from 'express-validator';
import {
  getCategories, createCategory, updateCategory, deleteCategory, reorderCategories,
} from '../controllers/category.controller.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { validate } from '../middleware/validate.js';
import { isSafeImageUrl } from '../utils/validation.js';

const router = Router();

router.use(protect, tenantIsolation);

router.get('/', requirePermission(PERMISSIONS.CATEGORIES_VIEW), getCategories);

router.post('/', requirePermission(PERMISSIONS.CATEGORIES_MANAGE), [
  body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Category name is required'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('emoji').optional().trim().isLength({ max: 16 }),
  body('image').optional({ checkFalsy: true }).trim().custom(isSafeImageUrl),
  body('parentId').optional({ nullable: true }).isMongoId(),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }),
  validate,
], createCategory);

router.put('/:id', requirePermission(PERMISSIONS.CATEGORIES_MANAGE), [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('description').optional().trim().isLength({ max: 500 }),
  body('emoji').optional().trim().isLength({ max: 16 }),
  body('image').optional({ checkFalsy: true }).trim().custom(isSafeImageUrl),
  body('parentId').optional({ nullable: true }).isMongoId(),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }),
  body('isActive').optional().isBoolean().toBoolean(),
  validate,
], updateCategory);

router.delete('/:id', requirePermission(PERMISSIONS.CATEGORIES_MANAGE), deleteCategory);

router.patch('/reorder', requirePermission(PERMISSIONS.CATEGORIES_MANAGE), [
  body('orders').isArray({ min: 1, max: 500 }),
  body('orders.*.id').isMongoId(),
  body('orders.*.sortOrder').isInt({ min: 0, max: 100000 }),
  validate,
], reorderCategories);

export default router;
