import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  exportTenant, exportProducts, exportOrders,
  exportCustomers, exportInventory, exportAccounting,
} from '../controllers/backup.controller.js';

const router = Router();
router.use(protect, tenantIsolation, requirePermission(PERMISSIONS.BACKUP_EXPORT));

router.get('/full', exportTenant);
router.get('/products', exportProducts);
router.get('/orders', exportOrders);
router.get('/customers', exportCustomers);
router.get('/inventory', exportInventory);
router.get('/accounting', exportAccounting);

export default router;
