import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { getAuditLogs, getAuditStats } from '../controllers/auditLog.controller.js';

const router = Router();
router.use(protect);

// Store owner: see own tenant logs
router.get('/', tenantIsolation, requirePermission(PERMISSIONS.AUDIT_LOGS_VIEW), getAuditLogs);
router.get('/stats', tenantIsolation, requirePermission(PERMISSIONS.AUDIT_LOGS_VIEW), getAuditStats);

export default router;
