import { Router } from 'express';
import { body } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import {
  getSystemStats, getStores, getStoreDetail, createStore,
  updateStoreSubscription, toggleStoreStatus, updateStoreModules,
  updateStoreLimits, logSupportAccess, getSupportAccessLogs,
} from '../controllers/superAdmin.controller.js';
import { getAuditLogs } from '../controllers/auditLog.controller.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, requireRole('super_admin'));

router.get('/stats', getSystemStats);
router.get('/stores', getStores);
router.post('/stores', [
  body('ownerName').optional().trim().notEmpty().isLength({ max: 80 }),
  body('ownerPhone').matches(/^[6-9]\d{9}$/),
  body('ownerEmail').isEmail().normalizeEmail(),
  body('ownerPassword').isLength({ min: 10, max: 128 }),
  body('storeName').trim().notEmpty().isLength({ max: 100 }),
  body('storeSlug').matches(/^[a-z0-9-]{3,50}$/),
  body('plan').optional().isIn(['trial', 'basic', 'premium', 'enterprise']),
  validate,
], createStore);
router.get('/stores/:id', getStoreDetail);
router.patch('/stores/:id/subscription', [
  body('plan').optional().isIn(['trial', 'basic', 'premium', 'enterprise']),
  body('expiresAt').optional().isISO8601(),
  body('isActive').optional().isBoolean().toBoolean(),
  body('paymentRef').optional().isString().isLength({ max: 200 }),
  validate,
], updateStoreSubscription);
router.patch('/stores/:id/toggle', toggleStoreStatus);
router.patch('/stores/:id/modules', [
  body('enabledModules').isArray({ max: 20 }),
  body('enabledModules.*').isString(),
  validate,
], updateStoreModules);
router.patch('/stores/:id/limits', [
  body('maxProducts').optional().isInt({ min: 1, max: 1000000 }),
  body('maxOrdersPerMonth').optional().isInt({ min: 1, max: 10000000 }),
  body('maxStaff').optional().isInt({ min: 1, max: 10000 }),
  body('maxCustomers').optional().isInt({ min: 1, max: 10000000 }),
  validate,
], updateStoreLimits);
router.post('/stores/:id/support-access', [
  body('reason').trim().notEmpty().isLength({ max: 500 }),
  validate,
], logSupportAccess);
router.get('/stores/:id/support-access', getSupportAccessLogs);
router.get('/audit-logs', getAuditLogs);

export default router;
