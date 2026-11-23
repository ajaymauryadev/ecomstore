import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.js';

const accessVerification = Symbol('accessVerification');

export function accessClaims(req) {
  if (!req[accessVerification]) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '');
    try {
      const claims = match && match[1].length <= 4096 ? verifyAccessToken(match[1]) : null;
      req[accessVerification] = { claims };
    } catch (error) {
      req[accessVerification] = { error };
    }
  }
  if (req[accessVerification].error) throw req[accessVerification].error;
  return req[accessVerification].claims;
}

export const protect = asyncHandler(async (req, res, next) => {
  const decoded = accessClaims(req);
  if (!decoded) return next(new AppError('Not authenticated. Please log in.', 401));

  const user = await User.findById(decoded.userId).select('+tokenVersion');
  if (!user) return next(new AppError('User no longer exists.', 401));
  if (!user.isActive) return next(new AppError('Account is deactivated.', 401));
  if (Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
    return next(new AppError('Session is no longer valid. Please log in again.', 401));
  }
  if (user.changedPasswordAfter(decoded.iat)) {
    return next(new AppError('Password changed since this token was issued. Please log in again.', 401));
  }

  const userTenantId = user.tenantId?.toString() || null;
  if ((decoded.tenantId || null) !== userTenantId || decoded.role !== user.role) {
    return next(new AppError('Authentication context is no longer valid. Please log in again.', 401));
  }

  req.user = user;
  req.tenantId = user.tenantId;
  next();
});

export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    const decoded = accessClaims(req);
    if (!decoded) return next();
    const user = await User.findById(decoded.userId).select('+tokenVersion');
    const userTenantId = user?.tenantId?.toString() || null;
    if (user?.isActive &&
        Number(decoded.tokenVersion || 0) === Number(user.tokenVersion || 0) &&
        !user.changedPasswordAfter(decoded.iat) &&
        (decoded.tenantId || null) === userTenantId && decoded.role === user.role) {
      req.user = user;
      req.tenantId = user.tenantId;
    }
  } catch {
    // ignore — optional auth
  }
  next();
});
