import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import path from 'path';
import { mkdirSync, existsSync } from 'fs';
import { apiTrafficLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './utils/AppError.js';
import routes from './routes/index.js';
import { env } from './config/env.js';
import { isApiReady } from './config/readiness.js';
import Product from './models/Product.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { PRIVATE_PAYMENT_ROOT, PUBLIC_UPLOADS_ROOT, UPLOADS_ROOT } from './middleware/upload.js';
import { remoteAsset } from './services/imageStorage.service.js';
import { trackSavedDataChanges } from './middleware/savedDataSync.js';

mkdirSync(PUBLIC_UPLOADS_ROOT, { recursive: true });
mkdirSync(PRIVATE_PAYMENT_ROOT, { recursive: true, mode: 0o700 });

export const app = express();
app.set('trust proxy', env.TRUSTED_PROXY_CIDRS);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: (origin, cb) => {
    const allowed = env.CORS_ORIGINS.split(',').map(o => o.trim());
    const isDevLoopback = env.isDevelopment && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    if (!origin || allowed.includes(origin) || isDevLoopback) return cb(null, true);
    cb(new AppError('Origin is not allowed by the CORS policy.', 403));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Order-Access-Token', 'Idempotency-Key'],
  exposedHeaders: ['Content-Disposition', 'Retry-After'],
}));

app.use('/api', (req, res, next) => {
  if (req.get('Authorization') || req.get('X-Order-Access-Token') || /^\/v1\/auth(?:\/|$)/i.test(req.path)) {
    res.set('Cache-Control', 'private, no-store');
  }
  next();
}, apiTrafficLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 100 }));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(mongoSanitize());
app.use(compression());

if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Keep existing database image paths stable while ImageKit delivers the bytes.
app.get('/uploads/:tenantId/:filename', asyncHandler(async (req, res, next) => {
  const { tenantId, filename } = req.params;
  if (!/^[a-f\d]{24}$/i.test(tenantId) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(filename)) return next();
  const asset = await remoteAsset(`public/${tenantId}/${filename}`);
  if (!asset) return next();
  if (asset.isPrivate) throw new AppError('Image not found.', 404);
  res.set({ 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.redirect(302, asset.url);
}));

app.use('/uploads', express.static(PUBLIC_UPLOADS_ROOT, {
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  dotfiles: 'deny',
  fallthrough: true,
  immutable: true,
  maxAge: '30d',
  index: false,
}));

// Backward-compatible access for legacy product images only. Files referenced solely
// by orders (including legacy payment proofs) are intentionally not public.
app.get('/uploads/:filename', asyncHandler(async (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !/^[A-Za-z0-9._-]{1,160}$/.test(filename)) {
    return next(new AppError('Image not found.', 404));
  }
  const url = `/uploads/${filename}`;
  const isProductImage = await Product.exists({ 'images.url': url, isActive: true });
  if (!isProductImage) return next(new AppError('Image not found.', 404));
  const asset = await remoteAsset(filename);
  if (asset && !asset.isPrivate) {
    res.set({ 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    return res.redirect(302, asset.url);
  }
  const filePath = path.join(UPLOADS_ROOT, filename);
  if (!isProductImage || !existsSync(filePath)) return next(new AppError('Image not found.', 404));
  res.set('Cross-Origin-Resource-Policy', 'cross-origin').sendFile(filePath);
}));
app.use('/api/v1', trackSavedDataChanges, routes);

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', asyncHandler(async (req, res) => {
  const ready = await isApiReady();
  res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
  });
}));

app.all('*', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

app.use(errorHandler);
