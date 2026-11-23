import { Router } from 'express';
import { body } from 'express-validator';
import {
  createReturn,
  processReturn,
  getReturns,
  getReturn,
  getReturnStats,
} from '../controllers/return.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission, requireRole } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const staffRoles = requireRole('store_owner', 'staff', 'packer', 'delivery');
const adminOnly = staffRoles;

router.use(protect, tenantIsolation);

router.get('/stats', adminOnly, requirePermission(PERMISSIONS.RETURNS_PROCESS), getReturnStats);
router.get('/', staffRoles, requirePermission(PERMISSIONS.RETURNS_VIEW), getReturns);
router.post('/', staffRoles, requirePermission(PERMISSIONS.RETURNS_CREATE), [
  body('type').isIn(['customer_return', 'purchase_return']),
  body('orderId').optional({ nullable: true }).isMongoId(),
  body('supplierId').optional({ nullable: true }).isMongoId(),
  body('purchaseEntryId').optional({ nullable: true }).isMongoId(),
  body('items').isArray({ min: 1, max: 100 }),
  body('items.*.productId').isMongoId(),
  body('items.*.variantId').isMongoId(),
  body('items.*.qty').isInt({ min: 1, max: 1000 }),
  body('items.*.reason').optional().isString().isLength({ max: 300 }),
  body('items.*.condition').optional().isIn(['good', 'damaged', 'opened']),
  body('items.*.restockItem').optional().isBoolean().toBoolean(),
  body('exchangeItems').optional().isArray({ max: 100 }),
  body('exchangeItems.*.productId').isMongoId(),
  body('exchangeItems.*.variantId').isMongoId(),
  body('exchangeItems.*.qty').isInt({ min: 1, max: 1000 }),
  body('refundMethod').optional().isIn(['cash', 'upi', 'store_credit', 'exchange', 'no_refund']),
  body('adjustSupplierBalance').optional().isBoolean().toBoolean(),
  body('notes').optional().isString().isLength({ max: 500 }),
  validate,
], createReturn);
router.get('/:id', staffRoles, requirePermission(PERMISSIONS.RETURNS_VIEW), getReturn);
router.post('/:id/process', adminOnly, requirePermission(PERMISSIONS.RETURNS_PROCESS), [
  body('action').isIn(['approve', 'reject']),
  body('rejectionReason').optional().isString().isLength({ max: 300 }),
  validate,
], processReturn);

export default router;
