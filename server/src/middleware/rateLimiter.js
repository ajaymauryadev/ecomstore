import rateLimit from 'express-rate-limit';
import { accessClaims } from './auth.js';

const createLimiter = (windowMinutes, max, message, { scope, ...options } = {}) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: (req, res) => ({
      status: 'error',
      message,
      retryAfterSeconds: Number(res.getHeader('Retry-After')),
      ...(scope && { rateLimitScope: scope }),
    }),
    ...options,
  });

export const apiLimiter = createLimiter(15, 200, 'Public request limit reached.', { scope: 'public' });
const businessLimiter = createLimiter(15, 450, 'Account request limit reached.', {
  scope: 'business',
  keyGenerator: (req) => accessClaims(req).userId,
});
const businessRoles = new Set(['super_admin', 'store_owner', 'staff', 'packer', 'delivery']);

export function apiTrafficLimiter(req, res, next) {
  // Refresh has its own IP budget so anonymous traffic cannot consume it.
  if (req.method === 'POST' && /^\/v1\/auth\/refresh\/?$/i.test(req.path)) return next();
  let claims;
  try {
    claims = accessClaims(req);
  } catch {
    // Invalid or expired credentials use the anonymous budget.
  }
  const limiter = businessRoles.has(claims?.role) &&
    typeof claims.userId === 'string' && /^[a-f\d]{24}$/i.test(claims.userId)
    ? businessLimiter
    : apiLimiter;
  return limiter(req, res, next);
}

export const authLimiter = createLimiter(15, 10, 'Too many authentication attempts.');
export const refreshLimiter = createLimiter(15, 60, 'Too many session refresh attempts.');

const signedInAccount = (req) => String(req.user._id);
const storeAccount = (req) => `${req.tenantId}:${req.user._id}`;
export const accountReadLimiter = createLimiter(1, 120, 'Too many account lookups. Retry shortly.', {
  keyGenerator: storeAccount, skip: (req) => !['GET', 'HEAD'].includes(req.method),
});
export const accountPaymentLimiter = createLimiter(1, 30, 'Too many payment changes. Your draft is safe; retry shortly.', { keyGenerator: storeAccount });
export const reportReadLimiter = createLimiter(1, 30, 'Too many report requests. Retry shortly.', { keyGenerator: storeAccount });
export const passwordChangeLimiter = createLimiter(15, 10, 'Too many password change attempts.', { keyGenerator: signedInAccount });
export const posLimiter = createLimiter(1, 120, 'POS rate limit exceeded.', { keyGenerator: signedInAccount });
export const uploadIpLimiter = createLimiter(15, 60, 'Shared network upload limit reached.');
export const uploadLimiter = createLimiter(15, 30, 'Account upload limit reached.', { keyGenerator: signedInAccount });
export const paymentProofLimiter = createLimiter(15, 10, 'Too many payment proof uploads.');
