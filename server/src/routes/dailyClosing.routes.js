import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  getDailySummary,
  saveDailyClosing,
  finalizeDailyClosing,
  correctDailyClosing,
  getDailyClosings,
  getDailyClosing,
} from '../controllers/dailyClosing.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
const adminOnly = requirePermission(PERMISSIONS.ACCOUNTING_MANAGE);

router.use(protect, tenantIsolation, requirePermission(PERMISSIONS.ACCOUNTING_VIEW), (req, res, next) =>
  req.tenantId ? next() : next(new AppError('Tenant context required.', 403)));

const cashFields = [
  body('openingCash').optional().isFloat({ min: 0 }),
  body('closingCash').optional().isFloat({ min: 0 }),
  body('notes').optional().isString().isLength({ max: 1000 }),
];
const version = () => body('version').isInt({ min: 0, max: Number.MAX_SAFE_INTEGER - 1 }).toInt();

router.get('/summary', getDailySummary);
router.post('/', adminOnly, [
  body('date').isISO8601(),
  ...cashFields,
  body('expenses').optional().isArray({ max: 100 }),
  body('expenses.*.description').trim().notEmpty().isLength({ max: 200 }),
  body('expenses.*.amount').isFloat({ gt: 0 }),
  body('expenses.*.category').optional().isIn(['rent', 'salary', 'utilities', 'petty_cash', 'supplier_payment', 'other']),
  version().optional(),
  body('status').optional().isIn(['draft', 'closed']),
  validate,
], saveDailyClosing);
router.post('/:id/finalize', adminOnly, [param('id').isMongoId(), version(), validate], finalizeDailyClosing);
router.post('/:id/corrections', adminOnly, [
  param('id').isMongoId(),
  version(),
  ...cashFields,
  body('reason').isString().trim().notEmpty().isLength({ max: 1000 }),
  validate,
], correctDailyClosing);
router.get('/', getDailyClosings);
router.get('/:id', getDailyClosing);

export default router;
