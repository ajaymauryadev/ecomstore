import { Router } from 'express';
import { body, query } from 'express-validator';
import {
  getSuppliers, getSupplier, createSupplier,
  updateSupplier, deleteSupplier, recordPayment, getSupplierReconciliation,
} from '../controllers/supplier.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, tenantIsolation);

const supplierRules = [
  body('name').optional().trim().notEmpty().isLength({ max: 120 }),
  body('phone').optional({ checkFalsy: true }).matches(/^[6-9]\d{9}$/),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('companyName').optional().isString().isLength({ max: 160 }),
  body('gstNumber').optional({ checkFalsy: true }).isString().isLength({ max: 30 }),
  body('notes').optional().isString().isLength({ max: 500 }),
  body('isActive').optional().isBoolean().toBoolean(),
  validate,
];

router.route('/')
  .get(requirePermission(PERMISSIONS.SUPPLIERS_VIEW), getSuppliers)
  .post(requirePermission(PERMISSIONS.SUPPLIERS_MANAGE), [body('name').exists(), ...supplierRules], createSupplier);

router.get('/reconciliation', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), [
  query('supplierId').optional().isMongoId(),
  validate,
], getSupplierReconciliation);

router.route('/:id')
  .get(requirePermission(PERMISSIONS.SUPPLIERS_VIEW), getSupplier)
  .put(requirePermission(PERMISSIONS.SUPPLIERS_MANAGE), supplierRules, updateSupplier)
  .delete(requirePermission(PERMISSIONS.SUPPLIERS_MANAGE), deleteSupplier);

router.post('/:id/payment', requirePermission(PERMISSIONS.SUPPLIERS_PAY), [
  body('amount').isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'upi', 'bank_transfer', 'cheque']),
  body('note').optional().isString().isLength({ max: 300 }),
  validate,
], recordPayment);

export default router;
