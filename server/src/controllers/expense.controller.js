import Expense from '../models/Expense.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { parsePagination } from '../utils/query.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { accountingDateFilter, accountingTimestamp } from '../utils/accountingDay.js';
import mongoose from 'mongoose';

const expenseFilter = (req) => {
  const { startDate, endDate, category, method, search, expense } = req.query;
  const filter = { tenantId: req.tenantId, isActive: { $ne: false } };
  if (startDate || endDate) filter.date = accountingDateFilter(startDate, endDate, req.storeTimeZone);
  if (typeof category === 'string' && category) filter.category = category;
  if (typeof method === 'string' && method) filter.method = method === 'unrecorded' ? null : method;
  if (expense) {
    if (!mongoose.isObjectIdOrHexString(expense)) throw new AppError('Invalid expense reference.', 400);
    filter._id = new mongoose.Types.ObjectId(expense);
  }
  if (typeof search === 'string' && search.trim()) {
    const pattern = [...search.trim().slice(0, 100)].map((char) => '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char).join('');
    filter.$or = ['name', 'paidTo', 'description', 'recordedByName'].map((key) => ({ [key]: new RegExp(pattern, 'i') }));
  }
  return filter;
};

export const getExpenses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = expenseFilter(req);
  const [expenses, total] = await Promise.all([
    Expense.find(filter).sort({ date: -1, _id: 1 }).skip(skip).limit(limit),
    Expense.countDocuments(filter),
  ]);
  sendPaginated(res, expenses, total, page, limit);
});

export const getExpenseStats = asyncHandler(async (req, res) => {
  const rows = await Expense.aggregate([
    { $match: expenseFilter(req) },
    { $group: { _id: { category: '$category', method: '$method' }, total: { $sum: { $round: [{ $multiply: ['$amount', 100] }, 0] } }, count: { $sum: 1 } } },
  ]);
  const categories = new Map();
  let total = 0, cash = 0, online = 0, count = 0;
  for (const row of rows) {
    const category = categories.get(row._id.category) ?? { _id: row._id.category, total: 0, count: 0 };
    category.total += row.total;
    category.count += row.count;
    categories.set(category._id, category);
    total += row.total;
    count += row.count;
    if (row._id.method === 'cash') cash += row.total;
    else if (row._id.method) online += row.total;
  }
  const byCategory = [...categories.values()].sort((a, b) => b.total - a.total)
    .map((row) => ({ ...row, total: fromMinorUnits(row.total) }));
  sendSuccess(res, { byCategory, total: fromMinorUnits(total), cash: fromMinorUnits(cash), online: fromMinorUnits(online), count });
});

export const createExpense = asyncHandler(async (req, res, next) => {
  const { category, amount, method = 'cash', description, date, receiptUrl, name, paidTo, operationId } = req.body;
  if (!category) return next(new AppError('Category and amount are required.', 400));
  const fields = {
    tenantId: req.tenantId,
    category,
    amount: fromMinorUnits(toMinorUnits(amount, 'expense amount', { allowZero: false })),
    method,
    name: name?.trim(),
    paidTo: paidTo?.trim(),
    operationId,
    description: String(description || '').trim().slice(0, 500),
    date: accountingTimestamp(date, req.storeTimeZone),
    receiptUrl: receiptUrl ? String(receiptUrl).trim().slice(0, 500) : null,
    recordedBy: req.user._id,
    recordedByName: req.user.name,
  };
  let expense;
  try { expense = await Expense.create(fields); }
  catch (error) {
    if (error.code !== 11000 || !operationId) throw error;
    expense = await Expense.findOne({ tenantId: req.tenantId, operationId });
    const same = expense && ['category', 'amount', 'method', 'name', 'paidTo', 'description', 'receiptUrl']
      .every((key) => expense[key] === fields[key]) && (!date || +expense.date === +fields.date);
    if (!same) throw new AppError('This request ID already belongs to another expense.', 409);
    req.skipSavedDataChange = true;
    return sendSuccess(res, { expense });
  }
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
  const { category, amount, method, description, date, receiptUrl, name, paidTo } = req.body;
  if (category !== undefined) expense.category = category;
  if (amount !== undefined) {
    expense.amount = fromMinorUnits(toMinorUnits(amount, 'expense amount', { allowZero: false }));
  }
  if (description !== undefined) expense.description = String(description || '').trim().slice(0, 500);
  if (name !== undefined) expense.name = name.trim();
  if (paidTo !== undefined) expense.paidTo = paidTo.trim();
  if (method !== undefined) expense.method = method;
  if (date !== undefined) expense.date = accountingTimestamp(date, req.storeTimeZone);
  if (receiptUrl !== undefined) expense.receiptUrl = receiptUrl ? String(receiptUrl).trim().slice(0, 500) : null;
  await expense.save();
  await logAudit({ tenantId: req.tenantId, action: 'expense_updated', user: req.user,
    resource: { type: 'Expense', id: expense._id, label: expense.name || expense.category }, description: 'Expense updated', req });
  sendSuccess(res, { expense });
});

export const deleteExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId, isActive: { $ne: false } },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!expense) return next(new AppError('Expense not found.', 404));
  await logAudit({ tenantId: req.tenantId, action: 'expense_archived', user: req.user,
    resource: { type: 'Expense', id: expense._id, label: expense.name || expense.category }, description: 'Expense archived', req });
  sendSuccess(res, { message: 'Expense archived.' });
});
