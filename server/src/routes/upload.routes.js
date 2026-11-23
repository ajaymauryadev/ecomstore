import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { uploadSingle, uploadMultiple } from '../middleware/upload.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { requireAnyPermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { uploadIpLimiter, uploadLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(
  protect,
  tenantIsolation,
  requireAnyPermission(
    PERMISSIONS.PRODUCTS_CREATE,
    PERMISSIONS.PRODUCTS_EDIT,
    PERMISSIONS.OFFERS_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE
  ),
  uploadLimiter,
  uploadIpLimiter
);

router.post('/image', (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return next(new AppError(err.message, 400));
    if (!req.file) return next(new AppError('No file uploaded.', 400));
    req.retainUploadedFiles?.();
    const url = req.file.url;
    sendSuccess(res, { url }, 201);
  });
});

router.post('/images', (req, res, next) => {
  uploadMultiple(req, res, (err) => {
    if (err) return next(new AppError(err.message, 400));
    if (!req.files?.length) return next(new AppError('No files uploaded.', 400));
    req.retainUploadedFiles?.();
    const urls = req.files.map((f) => f.url);
    sendSuccess(res, { urls }, 201);
  });
});

export default router;
