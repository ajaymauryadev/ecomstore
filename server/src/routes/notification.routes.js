import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  getNotifications, getUnreadCount, markRead, markAllRead,
} from '../controllers/notification.controller.js';

const router = Router();
router.use(protect, tenantIsolation, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW));

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/mark-all-read', markAllRead);
router.patch('/:id/read', markRead);

export default router;
