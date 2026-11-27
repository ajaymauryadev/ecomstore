import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  getMyOrders,
  acceptPackingOrder,
  startPackingSession,
  getPackingSession,
  updateItemStatus,
  suggestReplacement,
  completePackingSession,
  getPackingQueue,
  getAdminPackingSession,
  verifyPackingSession,
  getStaffActivityLogs,
  getMissingItemsReport,
  getHighValueAlerts,
  getStaffPackingSessions,
} from '../controllers/packing.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission, requireRole } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// All routes require auth + tenant context
router.use(protect, tenantIsolation);

/* ── Staff routes ─────────────────────────────── */
const staffRoles = requireRole('store_owner', 'staff', 'packer', 'delivery');
const adminOnly = staffRoles;

router.get('/my-orders', staffRoles, requirePermission(PERMISSIONS.PACKING_VIEW), getMyOrders);
router.post('/orders/:orderId/accept', staffRoles, requirePermission(PERMISSIONS.PACKING_PERFORM), [
  param('orderId').isMongoId(), validate,
], acceptPackingOrder);
router.get('/session/:orderId', staffRoles, requirePermission(PERMISSIONS.PACKING_VIEW), getPackingSession);
router.post('/session/:orderId/start', staffRoles, requirePermission(PERMISSIONS.PACKING_PERFORM), startPackingSession);
router.patch('/session/:orderId/item/:itemId', staffRoles, requirePermission(PERMISSIONS.PACKING_PERFORM), [
  body('action').isIn(['pick', 'pack', 'missing']),
  body('pickedQty').optional().isInt({ min: 1, max: 1000 }),
  body('missingReason').optional().isString().isLength({ max: 300 }),
  body('operationId').optional().isUUID(),
  body('expectedStatus').optional().isIn(['pending', 'picked', 'packed', 'missing']),
  body('recordedAt').optional().isISO8601(),
  validate,
], updateItemStatus);
router.post('/session/:orderId/item/:itemId/replacement', staffRoles, requirePermission(PERMISSIONS.PACKING_PERFORM), [
  body('replacementProductId').isMongoId(),
  body('replacementVariantId').isMongoId(),
  body('replacementNote').optional().isString().isLength({ max: 300 }),
  validate,
], suggestReplacement);
router.post('/session/:orderId/complete', staffRoles, requirePermission(PERMISSIONS.PACKING_PERFORM), [
  body('staffNotes').optional().isString().isLength({ max: 500 }),
  validate,
], completePackingSession);

/* ── Admin routes ─────────────────────────────── */
router.get('/admin/queue', adminOnly, requirePermission(PERMISSIONS.PACKING_VERIFY), getPackingQueue);
router.get('/admin/sessions', adminOnly, requirePermission(PERMISSIONS.PACKING_REPORTS), getStaffPackingSessions);
router.get('/admin/session/:sessionId', adminOnly, requirePermission(PERMISSIONS.PACKING_VERIFY), getAdminPackingSession);
router.post('/admin/session/:sessionId/verify', adminOnly, requirePermission(PERMISSIONS.PACKING_VERIFY), [
  body('action').isIn(['approve', 'reject']),
  body('rejectionReason').optional().isString().isLength({ max: 500 }),
  body('adminNotes').optional().isString().isLength({ max: 500 }),
  body('nextStatus').optional().isIn(['ready_for_pickup', 'out_for_delivery']),
  validate,
], verifyPackingSession);
router.get('/admin/activity', adminOnly, requirePermission(PERMISSIONS.PACKING_REPORTS), getStaffActivityLogs);
router.get('/admin/missing-report', adminOnly, requirePermission(PERMISSIONS.PACKING_REPORTS), getMissingItemsReport);
router.get('/admin/high-value-alerts', adminOnly, requirePermission(PERMISSIONS.PACKING_REPORTS), getHighValueAlerts);

export default router;
