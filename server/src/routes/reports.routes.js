import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { tenantIsolation } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/roleCheck.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { getSalesOverview } from '../controllers/sales.controller.js';
import { reportReadLimiter } from '../middleware/rateLimiter.js';
import { workloadGate } from '../middleware/workloadGate.js';
import {
  getProfitLoss, getDailySales, getMonthlySales, getYearlySales,
  getProductSales, getCategorySales, getStockReport,
  getSupplierDues, getCustomerDues, getExpenseReport, getSalaryReport, getPurchaseReport,
} from '../controllers/reports.controller.js';

const router = Router();
const admitReport = workloadGate(2, 'Reports are busy. Please retry shortly.');
router.use(protect, tenantIsolation, requirePermission(PERMISSIONS.REPORTS_SENSITIVE));

router.get('/profit-loss', admitReport(getProfitLoss));
router.get('/daily-sales', admitReport(getDailySales));
router.get('/sales-overview', reportReadLimiter, admitReport(getSalesOverview));
router.get('/monthly-sales', admitReport(getMonthlySales));
router.get('/yearly-sales', admitReport(getYearlySales));
router.get('/product-sales', admitReport(getProductSales));
router.get('/category-sales', admitReport(getCategorySales));
router.get('/stock', admitReport(getStockReport));
router.get('/supplier-dues', admitReport(getSupplierDues));
router.get('/customer-dues', admitReport(getCustomerDues));
router.get('/expenses', admitReport(getExpenseReport));
router.get('/salary', admitReport(getSalaryReport));
router.get('/purchases', admitReport(getPurchaseReport));

export default router;
