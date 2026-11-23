import { Router } from 'express';
import { body, param } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { getPlans, createPlan, updatePlan, deletePlan, seedDefaultPlans } from '../controllers/plan.controller.js';
import { validate } from '../middleware/validate.js';
import { ALL_MODULES } from '../models/Plan.js';

const router = Router();

// Explicitly restricted bootstrap action (idempotent; skips existing plans).
router.post('/seed', protect, requireRole('super_admin'), seedDefaultPlans);

// Public: any authenticated user can read plans
router.get('/', protect, getPlans);

// Super admin only: manage plans
router.use(protect, requireRole('super_admin'));
const planRules = [
  body('name').optional().isIn(['trial', 'basic', 'premium', 'enterprise']),
  body('displayName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('price').optional().isFloat({ min: 0 }),
  body('billingCycle').optional().isIn(['monthly', 'yearly', 'lifetime']),
  body('trialDays').optional().isInt({ min: 0, max: 3650 }),
  body('durationDays').optional().isInt({ min: 1, max: 36500 }),
  body('modules').optional().isArray({ max: 20 }),
  body('limits.maxProducts').optional().isInt({ min: 1, max: 1000000 }),
  body('limits.maxOrdersPerMonth').optional().isInt({ min: 1, max: 10000000 }),
  body('limits.maxStaff').optional().isInt({ min: 1, max: 10000 }),
  body('limits.maxCustomers').optional().isInt({ min: 1, max: 10000000 }),
  body('limits.maxStorageGB').optional().isFloat({ min: 0.1, max: 100000 }),
  body('modules.*').optional().isIn(ALL_MODULES),
  body('isActive').optional().isBoolean().toBoolean(),
  body('isPublic').optional().isBoolean().toBoolean(),
  body('sortOrder').optional().isInt({ min: 0, max: 10000 }),
  body('color').optional().matches(/^#[0-9a-f]{6}$/i),
  body('badge').optional().trim().isLength({ max: 50 }),
  validate,
];
router.post('/', [body('name').exists(), body('displayName').exists(), ...planRules], createPlan);
router.put('/:id', param('id').isMongoId(), planRules, updatePlan);
router.delete('/:id', param('id').isMongoId(), validate, deletePlan);

export default router;
