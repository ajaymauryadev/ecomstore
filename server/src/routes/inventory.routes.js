import { Router } from 'express';
import { body } from 'express-validator';
import {
  getInventoryDashboard, getInventoryList, getLowStockProducts,
  adjustStock, getStockLedger, getStockValueReport,
} from '../controllers/inventory.controller.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { validate } from '../middleware/validate.js';
import { ADJUSTMENT_REASONS } from '../models/StockLedger.js';

const router = Router();
router.use(protect, tenantIsolation);

router.get('/dashboard', requirePermission(PERMISSIONS.INVENTORY_VIEW), getInventoryDashboard);
router.get('/list', requirePermission(PERMISSIONS.INVENTORY_VIEW), getInventoryList);
router.get('/low-stock', requirePermission(PERMISSIONS.INVENTORY_VIEW), getLowStockProducts);
router.get('/stock-value', requirePermission(PERMISSIONS.INVENTORY_VIEW), getStockValueReport);
router.post('/adjust', requirePermission(PERMISSIONS.INVENTORY_ADJUST), [
  body('productId').isMongoId(),
  body('variantId').isMongoId(),
  body('adjustmentType').isIn(['add', 'remove']),
  body('quantity').isInt({ min: 1, max: 1000000 }),
  body('reason').isIn(ADJUSTMENT_REASONS),
  body('note').optional().isString().isLength({ max: 500 }),
  validate,
], adjustStock);
router.get('/ledger/:productId', requirePermission(PERMISSIONS.INVENTORY_VIEW), getStockLedger);

export default router;
