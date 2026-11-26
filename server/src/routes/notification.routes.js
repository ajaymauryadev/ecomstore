import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  getNotifications, getUnreadCount, markRead, markAllRead,
} from '../controllers/notification.controller.js';

const router = Router();
// Customers use the same inbox handlers, which always scope reads and writes
// to their own user ID and tenant. Employee access still requires permission.
router.use(protect, tenantIsolation, (req, res, next) => req.user.role === 'customer'
  ? next() : requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW)(req, res, next));

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/mark-all-read', markAllRead);
router.patch('/:id/read', markRead);

export default router;
