import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { parsePagination } from '../utils/query.js';

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { action, userId, from, to } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = {};

  // Every store workspace, including delegated employees, stays within its tenant.
  if (req.user.role !== 'super_admin') filter.tenantId = req.tenantId;
  if (req.user.role === 'super_admin' && req.query.tenantId) filter.tenantId = req.query.tenantId;

  if (action) filter.action = action;
  if (userId) filter['performedBy.userId'] = userId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  sendPaginated(res, logs, total, page, limit);
});

export const getAuditStats = asyncHandler(async (req, res) => {
  const filter = req.user.role !== 'super_admin' ? { tenantId: req.tenantId } : {};
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [total, recent, byAction] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.countDocuments({ ...filter, createdAt: { $gte: sevenDaysAgo } }),
    AuditLog.aggregate([
      { $match: { ...filter, createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  sendSuccess(res, { total, recentWeek: recent, topActions: byAction });
});
