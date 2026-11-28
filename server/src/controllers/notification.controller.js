import Notification from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { parsePagination } from '../utils/query.js';

const inboxFilter = (req) => ({
  tenantId: req.tenantId,
  ...(req.user.role === 'store_owner'
    ? { $or: [{ userId: req.user._id }, { userId: null, role: 'admin' }] }
    : { userId: req.user._id }),
});

export const getNotifications = asyncHandler(async (req, res) => {
  const { role, type, isRead } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const filter = inboxFilter(req);

  if (role) filter.role = role;
  if (type) filter.type = type;
  if (isRead !== undefined) filter.isRead = isRead === 'true';


  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);

  sendPaginated(res, notifications, total, page, limit);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const filter = { ...inboxFilter(req), isRead: false };
  const count = await Notification.countDocuments(filter);
  sendSuccess(res, { count });
});

export const markRead = asyncHandler(async (req, res) => {
  const filter = { ...inboxFilter(req), _id: req.params.id };
  await Notification.findOneAndUpdate(
    filter,
    { isRead: true, readAt: new Date() }
  );
  sendSuccess(res, { message: 'Marked as read.' });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const filter = { ...inboxFilter(req), isRead: false };
  await Notification.updateMany(filter, { isRead: true, readAt: new Date() });
  sendSuccess(res, { message: 'All notifications marked as read.' });
});
