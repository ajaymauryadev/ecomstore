import { Router } from 'express';
import { body } from 'express-validator';
import {
  getStoreStaff,
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  getProfile,
  updateProfile,
  getAllUsers,
} from '../controllers/user.controller.js';
import { protect } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/roleCheck.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';

const router = Router();

router.use(protect);

// Own profile
router.get('/profile', getProfile);
router.patch('/profile', [
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('phone').optional().matches(/^[6-9]\d{9}$/),
  validate,
], updateProfile);

// Super admin
router.get('/', requireRole('super_admin'), getAllUsers);

// Store owner — staff management
router.get('/staff', tenantIsolation, requirePermission(PERMISSIONS.STAFF_VIEW), getStoreStaff);
router.post('/staff', tenantIsolation, requirePermission(PERMISSIONS.STAFF_MANAGE), [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 10, max: 128 }),
  body('role').isIn(['staff', 'packer', 'delivery']),
  body('permissions').optional().isArray({ max: 100 }),
  validate,
], createStaffMember);
router.patch('/staff/:id', tenantIsolation, requirePermission(PERMISSIONS.STAFF_MANAGE), [
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('permissions').optional().isArray({ max: 100 }),
  body('permissions.*').optional().isString().isLength({ max: 80 }),
  body('phone').optional().matches(/^[6-9]\d{9}$/),
  body('isActive').optional().isBoolean().toBoolean(),
  validate,
], updateStaffMember);
router.delete('/staff/:id', tenantIsolation, requirePermission(PERMISSIONS.STAFF_MANAGE), deleteStaffMember);

export default router;
