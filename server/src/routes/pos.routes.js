import { Router } from 'express';
import { body, query } from 'express-validator';
import { createPOSOrder, getPOSOrders, getPOSUdharCustomer, getPOSUdharCustomers } from '../controllers/pos.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission, requireRole } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { posLimiter, accountReadLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';

const trimText = (value) => typeof value === 'string' ? value.trim() : value;

const router = Router();
const staffRoles = requireRole('store_owner', 'staff', 'packer', 'delivery');

router.use(protect, tenantIsolation);

router.post('/order', staffRoles, requirePermission(PERMISSIONS.POS_ACCESS), posLimiter, [
  body('items').isArray({ min: 1, max: 100 }),
  body('items.*.productId').isMongoId(),
  body('items.*.variantId').isMongoId(),
  body('items.*.qty').isInt({ min: 1, max: 1000 }),
  body('items.*.price').optional().isFloat({ gt: 0 }),
  body('paymentMethod').optional().isIn(['counter', 'upi_id', 'credit']),
  body('payments').optional().isObject().bail()
    .custom((value) => value && !Array.isArray(value) && Object.keys(value).every((key) => ['cash', 'upi'].includes(key))),
  body('payments.cash').optional().isFloat({ min: 0 }),
  body('payments.upi').optional().isFloat({ min: 0 }),
  body('saleType').optional().isIn(['instant', 'parcha']),
  body('packingAssigneeId').optional({ nullable: true }).isMongoId(),
  body('udharCustomerId').optional().isString().bail().isMongoId()
    .withMessage('Choose a valid Udhar account.'),
  body('customerName').customSanitizer(trimText)
    .custom((name) => name === undefined || (typeof name === 'string' && name.length <= 80))
    .withMessage('Enter a customer name of up to 80 characters.')
    .bail()
    .custom((name, { req }) => req.body.paymentMethod !== 'credit' || req.body.udharCustomerId !== undefined
      || Boolean(name && name.toLowerCase() !== 'walk-in customer'))
    .withMessage('Enter the customer name for Udhar.'),
  body('customerPhone').customSanitizer(trimText)
    .custom((phone, { req }) => req.body.paymentMethod !== 'credit' || req.body.udharCustomerId !== undefined
      || (phone != null && phone !== ''))
    .withMessage('Enter the customer mobile number for Udhar.')
    .bail()
    .custom((phone) => phone == null || phone === '' || (typeof phone === 'string' && /^[6-9]\d{9}$/.test(phone)))
    .withMessage('Enter a valid 10-digit Indian mobile number.'),
  body('overallDiscount').optional().isFloat({ min: 0 }),
  body('note').optional().isString().isLength({ max: 500 }),
  validate,
], createPOSOrder);
router.get('/udhar-customer', staffRoles, requirePermission(PERMISSIONS.POS_ACCESS), [
  query('phone').isString().bail().matches(/^[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number.'),
  validate,
], getPOSUdharCustomer);
router.get('/orders', staffRoles, requirePermission(PERMISSIONS.POS_ACCESS), getPOSOrders);
router.get('/udhar-customers', staffRoles, requirePermission(PERMISSIONS.POS_ACCESS), accountReadLimiter, [
  query('search').optional().isString().isLength({ max: 80 }),
  validate,
], getPOSUdharCustomers);

export default router;
