import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { workloadGate } from '../middleware/workloadGate.js';
import {
  exportTenant, exportProducts, exportOrders,
  exportCustomers, exportInventory, exportAccounting,
} from '../controllers/backup.controller.js';

const router = Router();
const admitExport = workloadGate(1, 'An export is running. Please retry shortly.');
router.use(protect, tenantIsolation, requirePermission(PERMISSIONS.BACKUP_EXPORT));

router.get('/full', admitExport(exportTenant));
router.get('/products', admitExport(exportProducts));
router.get('/orders', admitExport(exportOrders));
router.get('/customers', admitExport(exportCustomers));
router.get('/inventory', admitExport(exportInventory));
router.get('/accounting', admitExport(exportAccounting));

export default router;
