import { Router } from 'express';
import { body } from 'express-validator';
import {
  getStorefrontInfo,
  getStorefrontCategories,
  getStorefrontProducts,
  getStorefrontProduct,
  getCartProducts,
  customerRegister,
  customerLogin,
  getCustomerProfile,
  updateCustomerProfile,
  saveAddress,
  deleteAddress,
  toggleFavorite,
  getFavorites,
  validateCoupon,
  createOrder,
  getOrders,
  getOrder,
  cancelOrder,
  submitPaymentProof,
  getCustomerPaymentProofFile,
  getAdminPaymentProofFile,
  getAdminOrders,
  getAdminOrder,
  getAdminOrderPayments,
  getPaymentQueue,
  verifyPayment,
  updateOrderStatus,
  adminCancelOrder,
  rejectOrder,
  partialFulfillOrder,
  assignStaff,
  assignDelivery,
} from '../controllers/storefront.controller.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission, requireRole } from '../middleware/roleCheck.js';
import { uploadPaymentProof } from '../middleware/upload.js';
import { AppError } from '../utils/AppError.js';
import { requireCustomerOrderAccess } from '../middleware/orderAccess.js';
import { requireCustomerStore } from '../middleware/customerStore.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { authLimiter, paymentProofLimiter } from '../middleware/rateLimiter.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const wrapUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) return next(new AppError(err.message, 400));
    next();
  });
};

const adminAuth = [protect, tenantIsolation, requirePermission(PERMISSIONS.ORDERS_VIEW)];

/* ── Public storefront ────────────────────── */
router.get('/:slug', getStorefrontInfo);
router.get('/:slug/categories', getStorefrontCategories);
router.get('/:slug/products', getStorefrontProducts);
router.get('/:slug/products/:productId', getStorefrontProduct);
router.post('/:slug/cart/products', [
  body('productIds').isArray({ min: 1, max: 100 }),
  body('productIds.*').isMongoId(),
  validate,
], getCartProducts);

/* ── Customer auth (store-scoped) ─────────── */
router.post('/:slug/auth/register', requireTrustedOrigin, authLimiter, [
  body('name').trim().notEmpty().isLength({ max: 80 }),
  body('phone').matches(/^[6-9]\d{9}$/),
  body('password').isLength({ min: 10, max: 128 }),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  validate,
], customerRegister);
router.post('/:slug/auth/login', requireTrustedOrigin, authLimiter, [
  body('phone').matches(/^[6-9]\d{9}$/),
  body('password').isString().notEmpty().isLength({ max: 128 }),
  validate,
], customerLogin);

/* ── Coupon validation ───────────────────── */
const quoteRules = [
  body('items').isArray({ min: 1, max: 100 }),
  body('items.*.productId').isMongoId(),
  body('items.*.variantId').isMongoId(),
  body('items.*.quantity').isInt({ min: 1, max: 1000 }),
  body('orderType').optional().isIn(['home_delivery', 'self_pickup']),
  body('paymentMethod').optional().isIn(['upi_qr', 'upi_id', 'cash_on_pickup', 'cod']),
  body('deliveryArea').optional({ nullable: true }).isString().isLength({ max: 100 }),
  validate,
];
router.post('/:slug/coupon/validate', optionalAuth, [
  body('code').trim().matches(/^[A-Za-z0-9_-]{2,40}$/),
  body('customerPhone').optional({ checkFalsy: true }).matches(/^[6-9]\d{9}$/),
  ...quoteRules,
], validateCoupon);

/* ── Customer protected routes ─────────────── */
router.use('/:slug/customer', protect, requireRole('customer'), requireCustomerStore);
router.get('/:slug/customer/profile', getCustomerProfile);
router.put('/:slug/customer/profile', [
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  validate,
], updateCustomerProfile);
router.post('/:slug/customer/addresses', [
  body('addressId').optional().isMongoId(),
  body('label').optional().isString().isLength({ max: 40 }),
  body('line1').trim().notEmpty().isLength({ max: 200 }),
  body('landmark').optional().isString().isLength({ max: 120 }),
  body('city').trim().notEmpty().isLength({ max: 80 }),
  body('state').optional().isString().isLength({ max: 80 }),
  body('pincode').optional({ checkFalsy: true }).matches(/^\d{6}$/),
  body('isDefault').optional().isBoolean().toBoolean(),
  validate,
], saveAddress);
router.delete('/:slug/customer/addresses/:addressId', deleteAddress);
router.post('/:slug/customer/favorites', [body('productId').isMongoId(), validate], toggleFavorite);
router.get('/:slug/customer/favorites', getFavorites);

/* ── Orders (customer) ─────────────────────── */
router.post('/:slug/orders', protect, requireRole('customer'), [
  body('orderType').isIn(['home_delivery', 'self_pickup']),
  body('couponCode').optional({ checkFalsy: true }).matches(/^[A-Za-z0-9_-]{2,40}$/),
  body('customerInfo.name').optional().isString().isLength({ max: 80 }),
  body('customerInfo.phone').optional().matches(/^[6-9]\d{9}$/),
  body('customerInfo.email').optional({ checkFalsy: true }).isEmail(),
  body('customerInfo.address.line1').optional().isString().isLength({ max: 200 }),
  body('customerInfo.address.city').optional().isString().isLength({ max: 80 }),
  body('customerInfo.address.pincode').optional({ checkFalsy: true }).matches(/^\d{6}$/),
  body('note').optional().isString().isLength({ max: 500 }),
  ...quoteRules,
], createOrder);
router.get('/:slug/orders', protect, requireRole('customer'), requireCustomerStore, getOrders);
router.get('/:slug/orders/:orderId', optionalAuth, requireCustomerOrderAccess, getOrder);
router.post('/:slug/orders/:orderId/cancel', optionalAuth, requireCustomerOrderAccess, [
  body('reason').optional().isString().isLength({ max: 300 }),
  validate,
], cancelOrder);

/* ── Payment proof upload (customer) ─────────────── */
router.post(
  '/:slug/orders/:orderId/payment/proof',
  optionalAuth,
  requireCustomerOrderAccess,
  paymentProofLimiter,
  wrapUpload(uploadPaymentProof),
  body('utrNumber').optional().isString().isLength({ max: 100 }),
  body('notes').optional().isString().isLength({ max: 500 }),
  validate,
  submitPaymentProof
);
router.get(
  '/:slug/orders/:orderId/payment/proof/file',
  optionalAuth,
  requireCustomerOrderAccess,
  getCustomerPaymentProofFile
);

/* ── Admin: payment verification queue ─────────── */
router.get('/:slug/admin/orders/payment-queue', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_PAYMENT_VERIFY), getPaymentQueue);

/* ── Admin: single order detail ─────────────────── */
router.get('/:slug/admin/orders/:orderId', ...adminAuth, getAdminOrder);
router.get('/:slug/admin/orders/:orderId/payments', ...adminAuth, getAdminOrderPayments);
router.get(
  '/:slug/admin/orders/:orderId/payment/proof/file',
  ...adminAuth,
  requirePermission(PERMISSIONS.ORDERS_PAYMENT_VERIFY),
  getAdminPaymentProofFile
);

/* ── Admin: order list ───────────────────────────── */
router.get('/:slug/admin/orders', ...adminAuth, getAdminOrders);

/* ── Admin: order actions ──────────────────────── */
router.patch('/:slug/admin/orders/:orderId/status', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_STATUS_UPDATE), [
  body('status').isIn(['accepted', 'packing', 'packed', 'ready_for_pickup', 'out_for_delivery', 'delivered']),
  body('message').optional().isString().isLength({ max: 300 }),
  validate,
], updateOrderStatus);
const reasonRules = [body('reason').optional().isString().isLength({ max: 300 }), validate];
router.post('/:slug/admin/orders/:orderId/cancel', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_CANCEL), reasonRules, adminCancelOrder);
router.post('/:slug/admin/orders/:orderId/reject', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_REJECT), reasonRules, rejectOrder);
router.post('/:slug/admin/orders/:orderId/partial', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_PARTIAL_FULFILL), [
  body('fulfilledItems').isArray({ min: 1, max: 100 }),
  body('fulfilledItems.*.variantId').isMongoId(),
  body('fulfilledItems.*.fulfilledQty').isInt({ min: 0, max: 1000 }),
  body('reason').optional().isString().isLength({ max: 300 }),
  validate,
], partialFulfillOrder);
router.patch('/:slug/admin/orders/:orderId/assign', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_ASSIGN), [
  body('staffId').optional({ nullable: true }).isMongoId(),
  validate,
], assignStaff);
router.patch('/:slug/admin/orders/:orderId/assign-delivery', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_ASSIGN), [
  body('deliveryId').optional({ nullable: true }).isMongoId(),
  validate,
], assignDelivery);
router.post('/:slug/admin/orders/:orderId/payment/verify', ...adminAuth, requirePermission(PERMISSIONS.ORDERS_PAYMENT_VERIFY), [
  body('action').isIn(['approve', 'reject']),
  body('reason').optional().isString().isLength({ max: 500 }),
  validate,
], verifyPayment);

export default router;
