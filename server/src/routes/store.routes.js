import { Router } from 'express';
import {
  getAllStores,
  getMyStore,
  updateMyStore,
  getStoreBySlug,
  toggleStoreStatus,
  getStoreStats,
} from '../controllers/store.controller.js';
import { protect } from '../middleware/auth.js';
import { requireAnyPermission, requirePermission, requireRole } from '../middleware/roleCheck.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { isSafeImageUrl } from '../utils/validation.js';

const router = Router();

// Public
router.get('/public/:slug', getStoreBySlug);

// Authenticated
router.use(protect);

// Super admin
router.get('/', requireRole('super_admin'), getAllStores);
router.get('/stats', requireRole('super_admin'), getStoreStats);
router.patch('/:id/toggle-status', requireRole('super_admin'), toggleStoreStatus);

// Store owner
router.get('/mine', tenantIsolation, requireAnyPermission(PERMISSIONS.DASHBOARD_VIEW), getMyStore);
router.patch('/mine', tenantIsolation, requirePermission(PERMISSIONS.SETTINGS_MANAGE), [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('address').optional().isObject(),
  body('address.*').optional().trim().isLength({ max: 200 }),
  body('contact').optional().isObject(),
  body('contact.phone').optional({ checkFalsy: true }).trim().matches(/^[+]?[0-9 -]{7,20}$/),
  body('contact.whatsapp').optional({ checkFalsy: true }).trim().matches(/^[+]?[0-9 -]{7,20}$/),
  body('contact.email').optional({ checkFalsy: true }).trim().isEmail().normalizeEmail(),
  body('branding').optional().isObject(),
  body('branding.logo').optional({ checkFalsy: true }).custom(isSafeImageUrl),
  body('branding.banner').optional({ checkFalsy: true }).custom(isSafeImageUrl),
  body('branding.primaryColor').optional().matches(/^#[0-9a-f]{6}$/i),
  body('branding.tagline').optional().trim().isLength({ max: 160 }),
  body('settings').optional().isObject(),
  body('settings.currency').optional().isIn(['INR']),
  body('settings.timezone').optional().isIn(['Asia/Kolkata']),
  body('settings.taxRate').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('settings.lowStockThreshold').optional().isInt({ min: 0, max: 1000000 }).toInt(),
  body('settings.orderPrefix').optional().trim().matches(/^[A-Z0-9-]{1,10}$/),
  body('settings.allowCustomerOrders').optional().isBoolean().toBoolean(),
  body('settings.requirePinForSales').optional().isBoolean().toBoolean(),
  body('paymentSettings').optional().isObject(),
  body('paymentSettings.*').optional().trim().isLength({ max: 200 }),
  body('paymentSettings.upiId').optional({ checkFalsy: true }).isString().trim().matches(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/).withMessage('Enter a valid UPI ID, such as name@bank.'),
  body('paymentSettings.upiQrUrl').optional({ checkFalsy: true }).custom(isSafeImageUrl),
  body('deliverySettings').optional().isObject(),
  body('deliverySettings.defaultCharge').optional().isFloat({ min: 0, max: 1000000 }).toFloat(),
  body('deliverySettings.freeDeliveryAbove').optional().isFloat({ min: 0, max: 100000000 }).toFloat(),
  body('deliverySettings.minOrderAmount').optional().isFloat({ min: 0, max: 100000000 }).toFloat(),
  body('deliverySettings.areas').optional().isArray({ max: 100 }),
  body('deliverySettings.areas.*.name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('deliverySettings.areas.*.charge').optional().isFloat({ min: 0, max: 1000000 }).toFloat(),
  body('deliverySettings.areas.*.minOrder').optional().isFloat({ min: 0, max: 100000000 }).toFloat(),
  body('businessHours').optional().isObject(),
  body('businessHours.openTime').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('businessHours.closeTime').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('businessHours.pickupOpenTime').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('businessHours.pickupCloseTime').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('businessHours.closedDays').optional().isArray({ max: 7 }),
  body('businessHours.closedDays.*').optional().isIn(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  body('orderSettings').optional().isObject(),
  body('orderSettings.isAcceptingOrders').optional().isBoolean().toBoolean(),
  body('orderSettings.autoAccept').optional().isBoolean().toBoolean(),
  body('orderSettings.allowGuest').optional().isBoolean().toBoolean(),
  body('taxSettings').optional().isObject(),
  body('taxSettings.enableGST').optional().isBoolean().toBoolean(),
  body('taxSettings.gstNumber').optional({ checkFalsy: true }).trim().matches(/^[0-9A-Z]{15}$/),
  body('taxSettings.cgstPercent').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('taxSettings.sgstPercent').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  validate,
], updateMyStore);

export default router;
