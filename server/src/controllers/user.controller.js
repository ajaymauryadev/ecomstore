import User from '../models/User.js';
import Store from '../models/Store.js';
import RefreshToken from '../models/RefreshToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { canAssignPermissions } from '../constants/permissions.js';
import { runInTransaction } from '../utils/transaction.js';
import { escapeRegex, parsePagination } from '../utils/query.js';
import { emitToUser } from '../config/socket.js';
import { logAudit } from '../services/audit.service.js';

const STAFF_ROLES = new Set(['staff', 'packer', 'delivery']);

export const getStoreStaff = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, role: { $in: [...STAFF_ROLES] } };
  if (req.query.role && STAFF_ROLES.has(req.query.role)) filter.role = req.query.role;
  if (req.query.search) {
    const search = new RegExp(escapeRegex(String(req.query.search).trim().slice(0, 80)), 'i');
    filter.$or = [{ name: search }, { email: search }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  sendPaginated(res, users, total, page, limit);
});

export const createStaffMember = asyncHandler(async (req, res, next) => {
  const { name, email, password, phone, role, permissions = [] } = req.body;
  if (!STAFF_ROLES.has(role)) return next(new AppError('Invalid staff role.', 400));
  if (!Array.isArray(permissions) || !canAssignPermissions(role, permissions)) {
    return next(new AppError('One or more permissions are not valid for this role.', 400));
  }
  if (await User.exists({ email })) return next(new AppError('Email already registered.', 409));

  const user = await runInTransaction(async (session) => {
    const store = await Store.findOne({ _id: req.tenantId, isActive: true }).session(session);
    if (!store) throw new AppError('Store not found.', 404);
    const activeStaff = await User.countDocuments({
      tenantId: req.tenantId, role: { $in: [...STAFF_ROLES] }, isActive: true,
    }).session(session);
    if (activeStaff >= store.limits.maxStaff) throw new AppError('Store staff limit has been reached.', 409);
    const [created] = await User.create([{
      name, email, password, phone, role, tenantId: req.tenantId, permissions,
    }], { session });
    store.staffCount = activeStaff + 1;
    await store.save({ session });
    return created;
  });
  sendSuccess(res, { user }, 201);
});

export const updateStaffMember = asyncHandler(async (req, res, next) => {
  const user = await User.findOne({
    _id: req.params.id, tenantId: req.tenantId, role: { $in: [...STAFF_ROLES] },
  });
  if (!user) return next(new AppError('Staff member not found.', 404));
  if (req.body.permissions !== undefined &&
      (!Array.isArray(req.body.permissions) || !canAssignPermissions(user.role, req.body.permissions))) {
    return next(new AppError('One or more permissions are not valid for this role.', 400));
  }

  const wasActive = user.isActive;
  ['name', 'phone', 'permissions', 'isActive'].forEach((key) => {
    if (req.body[key] !== undefined) user[key] = req.body[key];
  });
  await runInTransaction(async (session) => {
    await user.save({ session, validateModifiedOnly: true });
    if (wasActive !== user.isActive) {
      await Store.updateOne(
        { _id: req.tenantId },
        { $inc: { staffCount: user.isActive ? 1 : -1 } },
        { session }
      );
      if (!user.isActive) {
        await RefreshToken.updateMany({ userId: user._id }, { isRevoked: true }, { session });
      }
    }
  });
  try { emitToUser(user._id, 'user:updated', { user: user.toJSON() }); } catch {}
  await logAudit({ tenantId: req.tenantId, action: 'staff_action', user: req.user,
    resource: { type: 'User', id: user._id, label: user.name },
    description: 'Staff profile, permissions or account status updated', req });
  sendSuccess(res, { user });
});

export const deleteStaffMember = asyncHandler(async (req, res, next) => {
  const user = await User.findOne({
    _id: req.params.id, tenantId: req.tenantId, role: { $in: [...STAFF_ROLES] },
  });
  if (!user) return next(new AppError('Staff member not found.', 404));
  if (user.isActive) {
    await runInTransaction(async (session) => {
      user.isActive = false;
      await user.save({ session, validateModifiedOnly: true });
      await RefreshToken.updateMany({ userId: user._id }, { isRevoked: true }, { session });
      await Store.updateOne({ _id: req.tenantId }, { $inc: { staffCount: -1 } }, { session });
    });
  }
  sendSuccess(res, { user });
});

export const getProfile = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const updates = {};
  ['name', 'phone'].forEach((key) => {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  });
  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  sendSuccess(res, { user });
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.search) {
    const search = new RegExp(escapeRegex(String(req.query.search).trim().slice(0, 80)), 'i');
    filter.$or = [{ name: search }, { email: search }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  sendPaginated(res, users, total, page, limit);
});
