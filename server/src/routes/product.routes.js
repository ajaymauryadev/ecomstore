import { Router } from 'express';
import { body } from 'express-validator';
import {
  getProducts, getProduct, createProduct, updateProduct, deleteProduct,
  toggleProductField, updateVariantStock, bulkUpdatePrices,
} from '../controllers/product.controller.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { validate } from '../middleware/validate.js';
import { UNIT_VALUES } from '../models/Product.js';
import { isSafeImageUrl } from '../utils/validation.js';

const router = Router();

router.use(protect, tenantIsolation);

const productRules = [
  body('name').trim().notEmpty().isLength({ max: 200 }).withMessage('Product name is required'),
  body('brand').optional().trim().isLength({ max: 100 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('categoryId').optional({ nullable: true, checkFalsy: true }).isMongoId(),
  body('images').optional().isArray({ max: 10 }),
  body('images.*.url').custom(isSafeImageUrl),
  body('images.*.isMain').optional().isBoolean().toBoolean(),
  body('tags').optional().isArray({ max: 50 }),
  body('tags.*').optional().trim().notEmpty().isLength({ max: 50 }),
  body('isActive').optional().isBoolean().toBoolean(),
  body('isOnline').optional().isBoolean().toBoolean(),
  body('isFeatured').optional().isBoolean().toBoolean(),
  body('variants').isArray({ min: 1, max: 100 }).withMessage('At least one variant required'),
  body('variants.*.name').trim().notEmpty().isLength({ max: 80 }).withMessage('Variant name required'),
  body('variants.*.unit').optional().isIn(UNIT_VALUES),
  body('variants.*.retailPrice').isFloat({ gt: 0, max: 100000000 }).withMessage('Retail price must be a positive number'),
  body('variants.*.wholesalePrice').optional({ nullable: true }).isFloat({ gt: 0, max: 100000000 }),
  body('variants.*.offerPrice').optional({ nullable: true }).isFloat({ gt: 0, max: 100000000 }),
  body('variants.*.purchasePrice').optional({ nullable: true }).isFloat({ min: 0, max: 100000000 }),
  body('variants.*.stock').optional().isInt({ min: 0, max: 1000000 }),
  body('variants.*.lowStockLimit').optional().isInt({ min: 0, max: 1000000 }),
  body('variants.*.sku').optional().trim().isLength({ max: 100 }),
  body('variants.*.barcode').optional().trim().isLength({ max: 100 }),
  body('variants.*.isActive').optional().isBoolean().toBoolean(),
  body('variants.*.sortOrder').optional().isInt({ min: 0, max: 100000 }),
  validate,
];

router.get('/', requirePermission(PERMISSIONS.PRODUCTS_VIEW), getProducts);
router.get('/:id', requirePermission(PERMISSIONS.PRODUCTS_VIEW), getProduct);
router.post('/', requirePermission(PERMISSIONS.PRODUCTS_CREATE), productRules, createProduct);
router.put('/:id', requirePermission(PERMISSIONS.PRODUCTS_EDIT), [
  body('name').optional().trim().notEmpty().isLength({ max: 200 }),
  body('brand').optional().trim().isLength({ max: 100 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('categoryId').optional({ nullable: true, checkFalsy: true }).isMongoId(),
  body('images').optional().isArray({ max: 10 }),
  body('images.*.url').optional().custom(isSafeImageUrl),
  body('images.*.isMain').optional().isBoolean().toBoolean(),
  body('tags').optional().isArray({ max: 50 }),
  body('tags.*').optional().trim().notEmpty().isLength({ max: 50 }),
  body('isActive').optional().isBoolean().toBoolean(),
  body('isOnline').optional().isBoolean().toBoolean(),
  body('isFeatured').optional().isBoolean().toBoolean(),
  body('revision').optional().isString().matches(/^[a-f0-9]{64}$/),
  body('variants').optional().isArray({ max: 100 }),
  body('variants.*').isObject(),
  body('variants.*._id').optional().isString().bail().isMongoId(),
  body('variants.*.name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('variants.*.unit').optional().isIn(UNIT_VALUES),
  body('variants.*.retailPrice').optional().isFloat({ gt: 0, max: 100000000 }),
  body('variants.*.wholesalePrice').optional({ nullable: true }).isFloat({ gt: 0, max: 100000000 }),
  body('variants.*.offerPrice').optional({ nullable: true }).isFloat({ gt: 0, max: 100000000 }),
  body('variants.*.purchasePrice').optional({ nullable: true }).isFloat({ min: 0, max: 100000000 }),
  body('variants.*.stock').optional().isInt({ min: 0, max: 1000000 }),
  body('variants.*.lowStockLimit').optional().isInt({ min: 0, max: 1000000 }),
  body('variants.*.sku').optional().trim().isLength({ max: 100 }),
  body('variants.*.barcode').optional().trim().isLength({ max: 100 }),
  body('variants.*.isActive').optional().isBoolean().toBoolean(),
  body('variants.*.sortOrder').optional().isInt({ min: 0, max: 100000 }),
  validate,
], updateProduct);
router.delete('/:id', requirePermission(PERMISSIONS.PRODUCTS_DELETE), deleteProduct);
router.patch('/:id/toggle/:field', requirePermission(PERMISSIONS.PRODUCTS_EDIT), toggleProductField);
router.patch('/:id/variants/:variantId/stock', requirePermission(PERMISSIONS.INVENTORY_ADJUST), [
  body('stock').isInt({ min: 0, max: 1000000 }),
  body('operation').optional().isIn(['set', 'add', 'subtract']),
  validate,
], updateVariantStock);
router.post('/bulk/prices', requirePermission(PERMISSIONS.PRODUCTS_EDIT), [
  body('updates').isArray({ min: 1, max: 500 }),
  body('updates.*.productId').isMongoId(),
  body('updates.*.variantId').isMongoId(),
  body('updates.*.retailPrice').optional().isFloat({ gt: 0, max: 100000000 }),
  body('updates.*.wholesalePrice').optional({ nullable: true }).isFloat({ gt: 0, max: 100000000 }),
  body('updates.*.offerPrice').optional({ nullable: true }).isFloat({ gt: 0, max: 100000000 }),
  body('updates.*.purchasePrice').optional({ nullable: true }).isFloat({ min: 0, max: 100000000 }),
  validate,
], bulkUpdatePrices);

export default router;
