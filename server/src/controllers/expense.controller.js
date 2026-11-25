import Expense from '../models/Expense.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { parsePagination } from '../utils/query.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { accountingDateFilter, accountingTimestamp } from '../utils/accountingDay.js';

const addDateFilter = (filter, req) => {
  const { startDate, endDate } = req.query;
  if (startDate || endDate) filter.date = accountingDateFilter(startDate, endDate, req.storeTimeZone);
};

export const getExpenses = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, isActive: { $ne: false } };
  if (category) filter.category = category;
  addDateFilter(filter, req);
  const [expenses, total] = await Promise.all([
    Expense.find(filter).sort({ date: -1, _id: 1 }).skip(skip).limit(limit),
    Expense.countDocuments(filter),
  ]);
  sendPaginated(res, expenses, total, page, limit);
});

export const getExpenseStats = asyncHandler(async (req, res) => {
  const match = { tenantId: req.tenantId, isActive: { $ne: false } };
  addDateFilter(match, req);
  const [byCategory, [totals]] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  sendSuccess(res, { byCategory, total: totals?.total ?? 0, count: totals?.count ?? 0 });
});

export const createExpense = asyncHandler(async (req, res, next) => {
  const { category, amount, method = 'cash', description, date, receiptUrl } = req.body;
  if (!category) return next(new AppError('Category and amount are required.', 400));
  const expense = await Expense.create({
    tenantId: req.tenantId,
    category,
    amount: fromMinorUnits(toMinorUnits(amount, 'expense amount', { allowZero: false })),
    method,
    description: String(description || '').trim().slice(0, 500),
    date: accountingTimestamp(date, req.storeTimeZone),
    receiptUrl: receiptUrl ? String(receiptUrl).trim().slice(0, 500) : null,
    recordedBy: req.user._id,
    recordedByName: req.user.name,
  });
  await logAudit({
    tenantId: req.tenantId,
    action: 'expense_added',
    user: req.user,
    resource: { type: 'Expense', id: expense._id, label: category },
    description: `Expense recorded (${category})`,
    req,
  });
  sendSuccess(res, { expense }, 201);
});

export const updateExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findOne({
    _id: req.params.id, tenantId: req.tenantId, isActive: { $ne: false },
  });
  if (!expense) return next(new AppError('Expense not found.', 404));
  const { category, amount, method, description, date, receiptUrl } = req.body;
  if (category !== undefined) expense.category = category;
  if (amount !== undefined) {
    expense.amount = fromMinorUnits(toMinorUnits(amount, 'expense amount', { allowZero: false }));
  }
  if (description !== undefined) expense.description = String(description || '').trim().slice(0, 500);
  if (method !== undefined) expense.method = method;
  if (date !== undefined) expense.date = accountingTimestamp(date, req.storeTimeZone);
  if (receiptUrl !== undefined) expense.receiptUrl = receiptUrl ? String(receiptUrl).trim().slice(0, 500) : null;
  await expense.save();
  sendSuccess(res, { expense });
});

export const deleteExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId, isActive: { $ne: false } },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!expense) return next(new AppError('Expense not found.', 404));
  sendSuccess(res, { message: 'Expense archived.' });
});
