import { Router } from 'express';
import { body } from 'express-validator';
import { getDeliveryOrders, updateDeliveryStatus } from '../controllers/delivery.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission, requireRole } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect, tenantIsolation, requireRole('store_owner', 'staff', 'packer', 'delivery'));
router.get('/orders', requirePermission(PERMISSIONS.DELIVERY_VIEW), getDeliveryOrders);
router.patch('/orders/:orderId/status', requirePermission(PERMISSIONS.DELIVERY_UPDATE), [
  body('status').isIn(['out_for_delivery', 'delivered']),
  validate,
], updateDeliveryStatus);
export default router;
