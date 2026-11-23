import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  getCustomers, getCustomerStats, createCustomer, updateCustomer,
  getCustomerLedger, addDebit, addCredit, getAllDues, getLegacyCreditBills,
  previewPayment, getCustomerBills, getBillPayments, reversePayment,
} from '../controllers/udhar.controller.js';
import { validate } from '../middleware/validate.js';
import { ACCOUNT_PAYMENT_METHODS } from '../utils/paymentMethods.js';
import { accountReadLimiter, accountPaymentLimiter } from '../middleware/rateLimiter.js';

const router = Router();
router.use(protect, tenantIsolation, accountReadLimiter);

router.get('/stats', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getCustomerStats);
router.get('/legacy-credit-bills', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getLegacyCreditBills);
router.get('/dues', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getAllDues);
router.get('/', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getCustomers);
router.post('/', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), [
  body('name').trim().notEmpty().isLength({ max: 100 }),
  body('address').optional().isString().trim().isLength({ max: 500 }),
  body('phone').optional({ checkFalsy: true }).matches(/^[6-9]\d{9}$/),
  body('notes').optional().isString().isLength({ max: 500 }),
  validate,
], createCustomer);
router.put('/:id', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('address').optional().isString().trim().isLength({ max: 500 }),
  body('phone').optional({ checkFalsy: true }).matches(/^[6-9]\d{9}$/),
  body('notes').optional().isString().isLength({ max: 500 }),
  body('isActive').optional().isBoolean().toBoolean(),
  validate,
], updateCustomer);
router.get('/:id/ledger', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getCustomerLedger);
router.get('/:id/bills', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), [param('id').isMongoId(), validate], getCustomerBills);
router.get('/:id/bills/:orderId/payments', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), [
  param('id').isMongoId(), param('orderId').isMongoId(), validate,
], getBillPayments);
router.get('/:id/payment-preview', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), [
  param('id').isMongoId(), query('amount').isFloat({ gt: 0 }), query('orderId').optional().isMongoId(), validate,
], previewPayment);
router.post('/:id/payments/:entryId/reverse', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), accountPaymentLimiter, [
  param('id').isMongoId(), param('entryId').isMongoId(), body('reason').isString().trim().isLength({ min: 3, max: 300 }), validate,
], reversePayment);
const entryRules = [
  body('amount').isFloat({ gt: 0 }),
  body('description').optional().isString().isLength({ max: 300 }),
  body('date').optional().isISO8601(),
  validate,
];
router.post('/:id/debit', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), [
  body('referenceType').optional().isIn(['order', 'manual', 'pos_order']),
  body('referenceId').optional({ nullable: true }).isMongoId(),
  ...entryRules,
], addDebit);
router.post('/:id/credit', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), accountPaymentLimiter, [
  param('id').isMongoId(),
  body('orderId').optional().isMongoId(),
  body('method').optional().isIn(ACCOUNT_PAYMENT_METHODS),
  ...entryRules,
], addCredit);

export default router;
