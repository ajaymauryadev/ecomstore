import { AppError } from '../utils/AppError.js';
import { hasPermission } from '../constants/permissions.js';

export const requireRole = (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError('Not authenticated.', 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(`Access denied. Required roles: ${roles.join(', ')}`, 403));
    }
    next();
  };

export const requirePermission = (...permissions) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError('Not authenticated.', 401));
    if (!permissions.every((permission) => hasPermission(req.user, permission))) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };

export const requireAnyPermission = (...permissions) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError('Not authenticated.', 401));
    if (!permissions.some((permission) => hasPermission(req.user, permission))) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };
