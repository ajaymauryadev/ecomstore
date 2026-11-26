import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { getSalesOverview } from '../controllers/sales.controller.js';
import { reportReadLimiter } from '../middleware/rateLimiter.js';
import {
  getProfitLoss, getDailySales, getMonthlySales, getYearlySales,
  getProductSales, getCategorySales, getStockReport,
  getSupplierDues, getCustomerDues, getExpenseReport, getSalaryReport, getPurchaseReport,
} from '../controllers/reports.controller.js';

const router = Router();
router.use(protect, tenantIsolation, requirePermission(PERMISSIONS.REPORTS_SENSITIVE));

router.get('/profit-loss', getProfitLoss);
router.get('/daily-sales', getDailySales);
router.get('/sales-overview', reportReadLimiter, getSalesOverview);
router.get('/monthly-sales', getMonthlySales);
router.get('/yearly-sales', getYearlySales);
router.get('/product-sales', getProductSales);
router.get('/category-sales', getCategorySales);
router.get('/stock', getStockReport);
router.get('/supplier-dues', getSupplierDues);
router.get('/customer-dues', getCustomerDues);
router.get('/expenses', getExpenseReport);
router.get('/salary', getSalaryReport);
router.get('/purchases', getPurchaseReport);

export default router;
