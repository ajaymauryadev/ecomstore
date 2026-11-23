import AuditLog from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

export const logAudit = async ({ tenantId, action, user, resource, changes, description, req }) => {
  try {
    await AuditLog.create({
      tenantId,
      action,
      performedBy: user ? { userId: user._id, name: user.name, role: user.role } : undefined,
      resource,
      changes,
      description,
      ip: req?.ip || req?.headers?.['x-forwarded-for'],
      userAgent: req?.headers?.['user-agent'],
    });
  } catch (err) {
    logger.error(`Audit write failed: ${err.message}`);
  }
};
