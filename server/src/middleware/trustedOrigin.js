import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const allowedOrigins = new Set(
  env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
);

export const requireTrustedOrigin = (req, res, next) => {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');

  const isDevelopmentLoopback = env.isDevelopment && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
  if (origin && !allowedOrigins.has(origin) && !isDevelopmentLoopback) {
    return next(new AppError('Request origin is not allowed.', 403));
  }
  if (!origin && fetchSite === 'cross-site') {
    return next(new AppError('Cross-site request is not allowed.', 403));
  }
  next();
};
