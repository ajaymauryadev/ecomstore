import { Router } from 'express';
import { body } from 'express-validator';
import { getCoupons, createCoupon, updateCoupon, deleteCoupon } from '../controllers/coupon.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, tenantIsolation);

const couponRules = [
  body('code').optional().trim().matches(/^[A-Za-z0-9_-]{2,40}$/),
  body('type').optional().isIn(['percent', 'flat']),
  body('value').optional().isFloat({ gt: 0 }),
  body('maxDiscount').optional({ nullable: true }).isFloat({ gt: 0 }),
  body('minOrderValue').optional().isFloat({ min: 0 }),
  body('usageLimitTotal').optional({ nullable: true }).isInt({ min: 1 }),
  body('usageLimitPerUser').optional({ nullable: true }).isInt({ min: 1 }),
  body('applicableOrderTypes').optional().isArray({ max: 5 }),
  body('applicableProductIds').optional().isArray({ max: 500 }),
  body('applicableCategoryIds').optional().isArray({ max: 200 }),
  body('applicableCustomerIds').optional().isArray({ max: 1000 }),
  body('startsAt').optional({ nullable: true }).isISO8601(),
  body('expiresAt').optional({ nullable: true }).isISO8601(),
  body('isActive').optional().isBoolean(),
  validate,
];

router.route('/')
  .get(requirePermission(PERMISSIONS.COUPONS_VIEW), getCoupons)
  .post(requirePermission(PERMISSIONS.COUPONS_MANAGE), [
    body('code').exists(), body('type').exists(), body('value').exists(), ...couponRules,
  ], createCoupon);
router.route('/:id')
  .put(requirePermission(PERMISSIONS.COUPONS_MANAGE), couponRules, updateCoupon)
  .delete(requirePermission(PERMISSIONS.COUPONS_MANAGE), deleteCoupon);

export default router;
