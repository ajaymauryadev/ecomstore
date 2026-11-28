import { Router } from 'express';
import { body } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  getExpenses, getExpenseStats, createExpense, updateExpense, deleteExpense,
} from '../controllers/expense.controller.js';
import { validate } from '../middleware/validate.js';
import { ACCOUNT_PAYMENT_METHODS } from '../utils/paymentMethods.js';

const router = Router();
router.use(protect, tenantIsolation);

router.get('/stats', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getExpenseStats);
router.get('/', requirePermission(PERMISSIONS.ACCOUNTING_VIEW), getExpenses);
const expenseRules = [
  body('category').optional().isIn([
    'rent', 'electricity', 'transport', 'packaging', 'staff_salary',
    'damage_loss', 'maintenance', 'marketing', 'other',
  ]),
  body('amount').optional().isFloat({ gt: 0 }),
  body('method').optional().isIn(ACCOUNT_PAYMENT_METHODS),
  body('description').optional().isString().isLength({ max: 500 }),
  body('name').optional().isString().isLength({ max: 120 }),
  body('paidTo').optional().isString().isLength({ max: 120 }),
  body('date').optional().isISO8601(),
  body('receiptUrl').optional({ nullable: true }).isString().isLength({ max: 500 }),
  validate,
];
router.post('/', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), [
  body('category').exists(), body('amount').exists(), body('operationId').optional().isUUID(), ...expenseRules,
], createExpense);
router.put('/:id', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), expenseRules, updateExpense);
router.delete('/:id', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), deleteExpense);

export default router;
