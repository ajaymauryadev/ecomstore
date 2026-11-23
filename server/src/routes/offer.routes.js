import { Router } from 'express';
import { body } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { getOffers, createOffer, updateOffer, deleteOffer } from '../controllers/offer.controller.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, tenantIsolation);

const offerRules = [
  body('title').optional().trim().notEmpty().isLength({ max: 160 }),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('type').optional().isIn(['combo', 'festival_pack', 'ration_pack', 'buy_x_get_y', 'wholesale', 'bulk']),
  body('bundleItems').optional().isArray({ max: 100 }),
  body('bundleItems.*.productId').isMongoId(),
  body('bundleItems.*.variantId').isMongoId(),
  body('bundleItems.*.quantity').optional().isInt({ min: 1, max: 1000 }),
  body('bundlePrice').optional({ nullable: true }).isFloat({ gt: 0 }),
  body('buyQuantity').optional({ nullable: true }).isInt({ min: 1, max: 1000 }),
  body('getQuantity').optional({ nullable: true }).isInt({ min: 1, max: 1000 }),
  body('buyProductId').optional({ nullable: true }).isMongoId(),
  body('buyVariantId').optional({ nullable: true }).isMongoId(),
  body('getProductId').optional({ nullable: true }).isMongoId(),
  body('getVariantId').optional({ nullable: true }).isMongoId(),
  body('targetProductId').optional({ nullable: true }).isMongoId(),
  body('targetVariantId').optional({ nullable: true }).isMongoId(),
  body('tiers').optional().isArray({ max: 50 }),
  body('tiers.*.minQuantity').isInt({ min: 1, max: 1000000 }),
  body('tiers.*.pricePerUnit').optional({ nullable: true }).isFloat({ gt: 0 }),
  body('tiers.*.discountPercent').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body('minOrderValue').optional().isFloat({ min: 0 }),
  body('isActive').optional().isBoolean().toBoolean(),
  body('startsAt').optional({ nullable: true }).isISO8601(),
  body('expiresAt').optional({ nullable: true }).isISO8601(),
  body('displayOrder').optional().isInt({ min: 0, max: 1000000 }),
  validate,
];

router.route('/')
  .get(requirePermission(PERMISSIONS.OFFERS_VIEW), getOffers)
  .post(requirePermission(PERMISSIONS.OFFERS_MANAGE), [
    body('title').exists(), body('type').exists(), ...offerRules,
  ], createOffer);
router.route('/:id')
  .put(requirePermission(PERMISSIONS.OFFERS_MANAGE), offerRules, updateOffer)
  .delete(requirePermission(PERMISSIONS.OFFERS_MANAGE), deleteOffer);

export default router;
