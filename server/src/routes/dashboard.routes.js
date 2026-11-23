import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';

const router = Router();
router.get('/', protect, tenantIsolation, requirePermission(PERMISSIONS.DASHBOARD_VIEW), getDashboard);
export default router;
