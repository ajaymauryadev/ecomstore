import Order from '../models/Order.js';
import PurchaseEntry from '../models/PurchaseEntry.js';
import Expense from '../models/Expense.js';
import StaffSalary from '../models/StaffSalary.js';
import Supplier from '../models/Supplier.js';
import UdharCustomer from '../models/UdharCustomer.js';
import StockLedger from '../models/StockLedger.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Return from '../models/Return.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { parsePagination } from '../utils/query.js';
import { accountingDate, accountingDateFilter, accountingDay, DEFAULT_STORE_TIME_ZONE } from '../utils/accountingDay.js';

function dateRange(startDate, endDate, timeZone) {
  const today = accountingDate(undefined, timeZone);
  const { $gte: start, $lt: end } = accountingDateFilter(startDate || today.slice(0, 8) + '01', endDate || today, timeZone);
  return { start, end };
}

function reportYear(value, defaultYear) {
  const year = value == null ? defaultYear : Number(value);
  if (!Number.isInteger(year) || year < 1000 || year > 9998) throw new AppError('Report year is invalid.', 400);
  return year;
}

const fulfilledEvent = {
  $first: {
    $filter: {
      input: { $ifNull: ['$timeline', []] },
      as: 'event',
      cond: { $eq: ['$$event.status', 'partially_fulfilled'] },
    },
  },
};

// A null line cost records a missing snapshot. Zero is a valid cost or quantity.
const lineCost = (unitCost, quantity) => ({
  $switch: {
    branches: [
      { case: { $eq: [quantity, 0] }, then: 0 },
      { case: { $isNumber: unitCost }, then: { $multiply: [unitCost, quantity] } },
    ],
    default: null,
  },
});

const countUnknownCosts = (input) => ({
  $size: { $filter: { input, cond: { $eq: ['$$this', null] } } },
});

// GET /reports/profit-loss
export const getProfitLoss = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = dateRange(startDate, endDate, req.storeTimeZone);
  const tid = req.tenantId;
  const period = { $gte: start, $lt: end };

  const [
    salesAgg, expenseAgg, salaryAgg,
    supplierDues, customerDues, damageLossAgg, returnAgg,
  ] = await Promise.all([
    // Recognize fulfilled sales, using createdAt for older records without fulfillment dates.
    Order.aggregate([
      { $match: {
        tenantId: tid,
        status: { $in: ['delivered', 'partially_fulfilled', 'ready_for_pickup', 'out_for_delivery'] },
        $or: [
          { deliveredAt: period },
          { createdAt: period },
          { timeline: { $elemMatch: { status: 'partially_fulfilled', timestamp: period } } },
        ],
      } },
      { $set: { partial: fulfilledEvent } },
      { $match: { $or: [
        { status: { $in: ['delivered', 'partially_fulfilled'] } },
        { 'partial.timestamp': { $exists: true } },
      ] } },
      { $set: { soldAt: { $ifNull: ['$partial.timestamp', '$deliveredAt', '$createdAt'] } } },
      { $match: { soldAt: period } },
      { $project: {
        total: '$pricing.grandTotal',
        lineCosts: { $map: {
          input: { $ifNull: ['$items', []] },
          as: 'item',
          in: lineCost('$$item.unitCost', { $ifNull: ['$$item.fulfilledQty', '$$item.quantity'] }),
        } },
      } },
      { $group: {
        _id: null,
        total: { $sum: '$total' },
        count: { $sum: 1 },
        knownCost: { $sum: { $sum: '$lineCosts' } },
        unknownLines: { $sum: countUnknownCosts('$lineCosts') },
      } },
    ]),
    // Expenses
    Expense.aggregate([
      { $match: { tenantId: tid, isActive: { $ne: false }, date: { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // Staff salary paid in period
    StaffSalary.aggregate([
      { $match: { tenantId: tid } },
      { $unwind: '$payments' },
      { $match: { 'payments.paidAt': { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: '$payments.amount' } } },
    ]),
    // Supplier dues (current)
    Supplier.aggregate([
      { $match: { tenantId: tid, pendingAmount: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$pendingAmount' } } },
    ]),
    // Customer dues (current)
    UdharCustomer.aggregate([
      { $match: { tenantId: tid, balance: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$balance' } } },
    ]),
    // Damaged/lost stock (quantity only - no stored cost value)
    StockLedger.aggregate([
      {
        $match: {
          tenantId: tid,
          createdAt: { $gte: start, $lt: end },
          movementType: { $in: ['DAMAGE_OUT', 'ADJUSTMENT_REMOVE'] },
          reason: { $in: ['damaged', 'expired', 'theft_loss', 'broken_packet'] },
        },
      },
      {
        $group: {
          _id: null,
          totalQty: { $sum: { $abs: '$quantityChange' } },
        },
      },
    ]),
    // Restocked units reverse their original cost. Replacement units carry their own cost.
    Return.aggregate([
      { $match: { tenantId: tid, processedAt: period, status: 'processed', type: 'customer_return' } },
      { $lookup: {
        from: Order.collection.name,
        localField: 'orderId',
        foreignField: '_id',
        pipeline: [{ $match: { tenantId: tid } }, { $project: { items: 1 } }],
        as: 'originalOrder',
      } },
      { $set: { originalItems: { $ifNull: [{ $first: '$originalOrder.items' }, []] } } },
      { $project: {
        netRefund: 1,
        restockCosts: { $map: {
          input: { $filter: {
            input: { $ifNull: ['$items', []] },
            cond: { $ifNull: ['$$this.restockItem', true] },
          } },
          as: 'returned',
          in: { $let: {
            vars: { original: { $first: { $filter: {
              input: '$originalItems',
              cond: { $eq: ['$$this.variantId', '$$returned.variantId'] },
            } } } },
            in: lineCost('$$original.unitCost', '$$returned.qty'),
          } },
        } },
        exchangeCosts: { $map: {
          input: { $ifNull: ['$exchangeItems', []] },
          in: lineCost('$$this.unitCost', '$$this.qty'),
        } },
      } },
      { $group: {
        _id: null,
        total: { $sum: '$netRefund' },
        knownCost: { $sum: { $subtract: [{ $sum: '$exchangeCosts' }, { $sum: '$restockCosts' }] } },
        unknownLines: { $sum: { $add: [
          countUnknownCosts('$exchangeCosts'), countUnknownCosts('$restockCosts'),
        ] } },
      } },
    ]),
  ]);

  const totalSales = salesAgg[0]?.total ?? 0;
  const salesCount = salesAgg[0]?.count ?? 0;
  const returnsTotal = returnAgg[0]?.total ?? 0;
  const netSales = totalSales - returnsTotal;
  const knownCogs = (salesAgg[0]?.knownCost ?? 0) + (returnAgg[0]?.knownCost ?? 0);
  const unknownCostLines = (salesAgg[0]?.unknownLines ?? 0) + (returnAgg[0]?.unknownLines ?? 0);
  const grossProfit = netSales - knownCogs;
  const expenses = expenseAgg[0]?.total ?? 0;
  const salaryCost = salaryAgg[0]?.total ?? 0;
  const damageValue = 0; // qty tracked, cost value not stored in ledger
  const netProfit = grossProfit - expenses - salaryCost - damageValue;

  sendSuccess(res, {
    period: { start, end },
    totalSales: +totalSales.toFixed(2),
    salesCount,
    netSales: +netSales.toFixed(2),
    knownCogs: +knownCogs.toFixed(2),
    cogs: unknownCostLines ? null : +knownCogs.toFixed(2),
    unknownCostLines,
    grossProfit: unknownCostLines ? null : +grossProfit.toFixed(2),
    grossMargin: !unknownCostLines && netSales > 0 ? +((grossProfit / netSales) * 100).toFixed(2) : null,
    expenses: +expenses.toFixed(2),
    salaryCost: +salaryCost.toFixed(2),
    damageValue: 0,
    damageQty: damageLossAgg[0]?.totalQty ?? 0,
    returnsTotal: +returnsTotal.toFixed(2),
    netProfit: unknownCostLines ? null : +netProfit.toFixed(2),
    supplierDues: +(supplierDues[0]?.total ?? 0).toFixed(2),
    customerDues: +(customerDues[0]?.total ?? 0).toFixed(2),
  });
});

// GET /reports/daily-sales
export const getDailySales = asyncHandler(async (req, res) => {
  const timeZone = req.storeTimeZone ?? DEFAULT_STORE_TIME_ZONE;
  const { businessDate, key, start, end } = accountingDay(req.query.date || undefined, timeZone);

  const hourlyData = await Order.aggregate([
    { $match: { tenantId: req.tenantId, createdAt: { $gte: start, $lt: end }, status: { $nin: ['cancelled', 'rejected'] } } },
    {
      $group: {
        _id: { $hour: { date: '$createdAt', timezone: timeZone } },
        sales: { $sum: '$pricing.grandTotal' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const hours = Array.from({ length: 24 }, (_, i) => {
    const found = hourlyData.find((h) => h._id === i);
    return { hour: i, label: `${i.toString().padStart(2, '0')}:00`, sales: found?.sales ?? 0, orders: found?.orders ?? 0 };
  });

  sendSuccess(res, { date: key, businessDate, timeZone, hours, total: hours.reduce((s, h) => s + h.sales, 0) });
});

// GET /reports/monthly-sales
export const getMonthlySales = asyncHandler(async (req, res) => {
  const { year, month } = req.query;
  const timeZone = req.storeTimeZone ?? DEFAULT_STORE_TIME_ZONE;
  const [todayYear, todayMonth] = accountingDate(undefined, timeZone).split('-').map(Number);
  const y = reportYear(year, todayYear);
  const m = month === undefined ? todayMonth - 1 : Number(month);
  if (!Number.isInteger(m) || m < 0 || m > 11) throw new AppError('Report month is invalid.', 400);

  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + 1, 0));
  const period = accountingDateFilter(first, last.toISOString().slice(0, 10), timeZone);

  const daily = await Order.aggregate([
    { $match: { tenantId: req.tenantId, createdAt: period, status: { $nin: ['cancelled', 'rejected'] } } },
    {
      $group: {
        _id: { $dayOfMonth: { date: '$createdAt', timezone: timeZone } },
        sales: { $sum: '$pricing.grandTotal' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const daysInMonth = last.getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const found = daily.find((d) => d._id === day);
    return { day, sales: found?.sales ?? 0, orders: found?.orders ?? 0 };
  });

  sendSuccess(res, { year: y, month: m, days, total: days.reduce((s, d) => s + d.sales, 0) });
});

// GET /reports/yearly-sales
export const getYearlySales = asyncHandler(async (req, res) => {
  const { year } = req.query;
  const timeZone = req.storeTimeZone ?? DEFAULT_STORE_TIME_ZONE;
  const y = reportYear(year, Number(accountingDate(undefined, timeZone).slice(0, 4)));
  const period = accountingDateFilter(`${y}-01-01`, `${y}-12-31`, timeZone);

  const monthly = await Order.aggregate([
    { $match: { tenantId: req.tenantId, createdAt: period, status: { $nin: ['cancelled', 'rejected'] } } },
    {
      $group: {
        _id: { $month: { date: '$createdAt', timezone: timeZone } },
        sales: { $sum: '$pricing.grandTotal' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = MONTHS.map((label, i) => {
    const found = monthly.find((m) => m._id === i + 1);
    return { month: i + 1, label, sales: found?.sales ?? 0, orders: found?.orders ?? 0 };
  });

  sendSuccess(res, { year: y, months, total: months.reduce((s, m) => s + m.sales, 0) });
});

// GET /reports/product-sales
export const getProductSales = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const requestedLimit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
  const { start, end } = dateRange(startDate, endDate, req.storeTimeZone);

  const data = await Order.aggregate([
    { $match: { tenantId: req.tenantId, createdAt: { $gte: start, $lt: end }, status: { $nin: ['cancelled', 'rejected'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        productName: { $first: '$items.name' },
        totalQty: { $sum: '$items.quantity' },
        totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: requestedLimit },
  ]);

  sendSuccess(res, { products: data, period: { start, end } });
});

// GET /reports/category-sales
export const getCategorySales = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = dateRange(startDate, endDate, req.storeTimeZone);

  const data = await Order.aggregate([
    { $match: { tenantId: req.tenantId, createdAt: { $gte: start, $lt: end }, status: { $nin: ['cancelled', 'rejected'] } } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.categoryId',
        foreignField: '_id',
        as: 'catArr',
      },
    },
    { $addFields: { category: { $arrayElemAt: ['$catArr', 0] } } },
    {
      $group: {
        _id: '$category._id',
        categoryName: { $first: '$category.name' },
        categoryEmoji: { $first: '$category.emoji' },
        totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        totalQty: { $sum: '$items.quantity' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  sendSuccess(res, { categories: data, period: { start, end } });
});

// GET /reports/stock
export const getStockReport = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });

  const filter = { tenantId: req.tenantId, isActive: true };

  const products = await Product.find(filter)
    .select('name categoryId variants')
    .populate('categoryId', 'name emoji')
    .sort({ name: 1 })
    .skip(skip)
    .limit(limit);

  const total = await Product.countDocuments(filter);

  sendPaginated(res, products, total, page, limit);
});

// GET /reports/supplier-dues
export const getSupplierDues = asyncHandler(async (req, res) => {
  const suppliers = await Supplier.find({
    tenantId: req.tenantId,
    pendingAmount: { $gt: 0 },
    isActive: true,
  }).select('name phone companyName pendingAmount totalPurchased totalPaid paymentHistory').sort({ pendingAmount: -1 });
  suppliers.splice(500);

  const total = suppliers.reduce((s, sup) => s + sup.pendingAmount, 0);
  sendSuccess(res, { suppliers, total: +total.toFixed(2) });
});

// GET /reports/customer-dues
export const getCustomerDues = asyncHandler(async (req, res) => {
  const customers = await UdharCustomer.find({
    tenantId: req.tenantId,
    balance: { $gt: 0 },
    isActive: true,
  }).sort({ balance: -1 });
  customers.splice(500);

  const total = customers.reduce((s, c) => s + c.balance, 0);
  sendSuccess(res, { customers, total: +total.toFixed(2) });
});

// GET /reports/expenses
export const getExpenseReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = dateRange(startDate, endDate, req.storeTimeZone);
  const localDate = { date: '$date', timezone: req.storeTimeZone ?? DEFAULT_STORE_TIME_ZONE };

  const [byCategory, [totals], trend] = await Promise.all([
    Expense.aggregate([
      { $match: { tenantId: req.tenantId, isActive: { $ne: false }, date: { $gte: start, $lt: end } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: { tenantId: req.tenantId, isActive: { $ne: false }, date: { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: { tenantId: req.tenantId, isActive: { $ne: false }, date: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { year: { $year: localDate }, month: { $month: localDate }, day: { $dayOfMonth: localDate } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]),
  ]);

  sendSuccess(res, {
    byCategory,
    total: totals?.total ?? 0,
    count: totals?.count ?? 0,
    trend,
    period: { start, end },
  });
});

// GET /reports/salary
export const getSalaryReport = asyncHandler(async (req, res) => {
  const { monthYear } = req.query;
  const filter = { tenantId: req.tenantId };
  if (monthYear) filter.monthYear = monthYear;

  const [records, [stats]] = await Promise.all([
    StaffSalary.find(filter).sort({ monthYear: -1, staffName: 1 }).limit(1000),
    StaffSalary.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalSalary: { $sum: '$monthlySalary' },
          totalPaid: { $sum: '$totalPaid' },
          totalDue: { $sum: { $max: [{ $subtract: ['$monthlySalary', '$totalPaid'] }, 0] } },
          paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } },
          staffCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  sendSuccess(res, {
    records,
    stats: stats ?? { totalSalary: 0, totalPaid: 0, totalDue: 0, staffCount: 0 },
  });
});

// GET /reports/purchases
export const getPurchaseReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = dateRange(startDate, endDate, req.storeTimeZone);

  const [bySupplier, [totals]] = await Promise.all([
    PurchaseEntry.aggregate([
      { $match: { tenantId: req.tenantId, createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: '$supplierId',
          supplierName: { $first: '$supplierName' },
          totalAmount: { $sum: '$totalAmount' },
          paidAmount: { $sum: '$paidAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]),
    PurchaseEntry.aggregate([
      { $match: { tenantId: req.tenantId, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, totalAmount: { $sum: '$totalAmount' }, paidAmount: { $sum: '$paidAmount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    bySupplier,
    total: totals?.totalAmount ?? 0,
    paid: totals?.paidAmount ?? 0,
    count: totals?.count ?? 0,
    period: { start, end },
  });
});
