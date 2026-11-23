import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  updatePassword,
} from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import { authLimiter, passwordChangeLimiter, refreshLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 80 }),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 10, max: 128 }).withMessage('Password must be between 10 and 128 characters'),
  body('role').optional().equals('store_owner').withMessage('Only store owner registration is available here'),
  body('storeName').notEmpty().withMessage('Store name required'),
  body('storeSlug')
    .notEmpty()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must be lowercase letters, numbers and hyphens only'),
  validate,
];

const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required'),
  body('rememberMe').optional().isBoolean().withMessage('rememberMe must be a boolean'),
  validate,
];

const updatePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword').isLength({ min: 10, max: 128 }).withMessage('New password must be between 10 and 128 characters'),
  validate,
];

router.post('/register', requireTrustedOrigin, authLimiter, registerRules, register);
router.post('/login', requireTrustedOrigin, authLimiter, loginRules, login);
router.post('/refresh', requireTrustedOrigin, refreshLimiter, refreshToken);
router.post('/logout', requireTrustedOrigin, logout);
router.get('/me', protect, getMe);
router.patch('/update-password', requireTrustedOrigin, protect, passwordChangeLimiter, updatePasswordRules, updatePassword);

export default router;
