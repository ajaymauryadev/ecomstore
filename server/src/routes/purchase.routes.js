import { Router } from 'express';
import { body } from 'express-validator';
import {
  createPurchase, getPurchases, getPurchase,
  recordPurchasePayment, getPurchaseStats,
} from '../controllers/purchase.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, tenantIsolation);

router.route('/')
  .get(requirePermission(PERMISSIONS.PURCHASES_VIEW), getPurchases)
  .post(requirePermission(PERMISSIONS.PURCHASES_MANAGE), [
    body('supplierId').optional({ nullable: true }).isMongoId(),
    body('supplierName').optional().isString().isLength({ max: 120 }),
    body('invoiceNumber').optional().isString().isLength({ max: 100 }),
    body('purchaseDate').optional().isISO8601(),
    body('items').isArray({ min: 1, max: 100 }),
    body('items.*.productId').isMongoId(),
    body('items.*.variantId').isMongoId(),
    body('items.*.quantity').isInt({ min: 1, max: 1000000 }),
    body('items.*.purchasePrice').isFloat({ gt: 0 }),
    body('items.*.sellingPrice').optional({ nullable: true }).isFloat({ gt: 0 }),
    body('paidAmount').optional().isFloat({ min: 0 }),
    body('paymentMethod').optional().isIn(['cash', 'upi', 'bank_transfer', 'cheque', 'credit']),
    body('note').optional().isString().isLength({ max: 500 }),
    validate,
  ], createPurchase);

router.get('/stats', requirePermission(PERMISSIONS.PURCHASES_VIEW), getPurchaseStats);

router.route('/:id')
  .get(requirePermission(PERMISSIONS.PURCHASES_VIEW), getPurchase);

router.post('/:id/payment', requirePermission(PERMISSIONS.PURCHASES_PAY), [
  body('amount').isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'upi', 'bank_transfer', 'cheque']),
  body('note').optional().isString().isLength({ max: 300 }),
  validate,
], recordPurchasePayment);

export default router;
