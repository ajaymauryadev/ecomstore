import { Router } from 'express';
import { body } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  getSalaryRecords, getSalaryStats, upsertSalaryRecord,
  recordPayment, getStaffSalaryHistory, getStaffList,
} from '../controllers/salary.controller.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, tenantIsolation);

router.get('/staff', requirePermission(PERMISSIONS.SALARY_VIEW), getStaffList);
router.get('/stats', requirePermission(PERMISSIONS.SALARY_VIEW), getSalaryStats);
router.get('/history/:staffId', requirePermission(PERMISSIONS.SALARY_VIEW), getStaffSalaryHistory);
router.get('/', requirePermission(PERMISSIONS.SALARY_VIEW), getSalaryRecords);
router.post('/', requirePermission(PERMISSIONS.SALARY_MANAGE), [
  body('staffId').isMongoId(),
  body('monthYear').matches(/^\d{4}-(0[1-9]|1[0-2])$/),
  body('monthlySalary').isFloat({ gt: 0 }),
  body('notes').optional().isString().isLength({ max: 500 }),
  validate,
], upsertSalaryRecord);
router.post('/:id/payment', requirePermission(PERMISSIONS.SALARY_MANAGE), [
  body('operationId').optional().isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('type').optional().isIn(['advance', 'salary', 'bonus']),
  body('method').optional().isIn(['cash', 'upi', 'bank_transfer']),
  body('note').optional().isString().isLength({ max: 300 }),
  validate,
], recordPayment);

export default router;
