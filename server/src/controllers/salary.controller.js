import StaffSalary from '../models/StaffSalary.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { parsePagination } from '../utils/query.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';

const computeStatus = (record) => {
  if (record.totalPaid <= 0) return 'unpaid';
  if (record.totalPaid >= record.monthlySalary) return 'paid';
  return 'partial';
};

export const getSalaryRecords = asyncHandler(async (req, res) => {
  const { monthYear, staffId, status } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const filter = { tenantId: req.tenantId };
  if (monthYear) filter.monthYear = monthYear;
  if (staffId) filter.staffId = staffId;
  if (status) filter.status = status;
  const [records, total] = await Promise.all([
    StaffSalary.find(filter).sort({ monthYear: -1, staffName: 1, _id: 1 }).skip(skip).limit(limit),
    StaffSalary.countDocuments(filter),
  ]);
  sendPaginated(res, records, total, page, limit);
});

export const getSalaryStats = asyncHandler(async (req, res) => {
  const match = { tenantId: req.tenantId };
  if (req.query.monthYear) match.monthYear = req.query.monthYear;
  const [stats] = await StaffSalary.aggregate([
    { $match: match },
    { $group: {
      _id: null,
      totalSalary: { $sum: '$monthlySalary' },
      totalPaid: { $sum: '$totalPaid' },
      totalDue: { $sum: { $max: [{ $subtract: ['$monthlySalary', '$totalPaid'] }, 0] } },
      paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
      unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } },
      partialCount: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
      staffCount: { $sum: 1 },
    } },
  ]);
  sendSuccess(res, stats ?? { totalSalary: 0, totalPaid: 0, totalDue: 0, staffCount: 0 });
});

export const upsertSalaryRecord = asyncHandler(async (req, res, next) => {
  const { staffId, monthYear, monthlySalary, notes } = req.body;
  if (!staffId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthYear || '')) {
    return next(new AppError('A staff member and valid YYYY-MM month are required.', 400));
  }
  const salary = fromMinorUnits(toMinorUnits(monthlySalary, 'monthly salary', { allowZero: false }));
  const staff = await User.findOne({
    _id: staffId,
    tenantId: req.tenantId,
    role: { $in: ['staff', 'packer', 'delivery'] },
    isActive: true,
  });
  if (!staff) return next(new AppError('Staff member not found.', 404));

  const record = await StaffSalary.findOneAndUpdate(
    { tenantId: req.tenantId, staffId, monthYear },
    {
      $set: {
        monthlySalary: salary,
        staffName: staff.name,
        staffPhone: staff.phone || '',
        notes: String(notes || '').trim().slice(0, 500),
      },
      $setOnInsert: { tenantId: req.tenantId, staffId, monthYear },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  record.status = computeStatus(record);
  await record.save();
  sendSuccess(res, { record }, 201);
});

export const recordPayment = asyncHandler(async (req, res, next) => {
  const { amount, type = 'salary', method = 'cash', note, operationId } = req.body;
  if (!['advance', 'salary', 'bonus'].includes(type) || !['cash', 'upi', 'bank_transfer'].includes(method)) {
    return next(new AppError('Invalid salary payment type or method.', 400));
  }
  const payment = fromMinorUnits(toMinorUnits(amount, 'payment amount', { allowZero: false }));
  const memo = String(note || '').trim().slice(0, 300);
  const { record, replayed } = await runInTransaction(async (session) => {
    const current = await StaffSalary.findOne({ _id: req.params.id, tenantId: req.tenantId }).session(session);
    if (!current) throw new AppError('Salary record not found.', 404);
    const existing = operationId && current.payments.find((entry) => entry.operationId === operationId);
    if (existing) {
      if (existing.amount !== payment || existing.type !== type || existing.method !== method || existing.note !== memo) {
        throw new AppError('This request ID already belongs to another salary payment.', 409);
      }
      return { record: current, replayed: true };
    }
    current.payments.push({
      amount: payment,
      type,
      method,
      note: memo,
      operationId,
      paidAt: new Date(),
      paidBy: req.user._id,
      paidByName: req.user.name,
    });
    if (type === 'advance') {
      current.advancePaid = fromMinorUnits(
        toMinorUnits(current.advancePaid, 'advance paid') + toMinorUnits(payment)
      );
    }
    current.totalPaid = fromMinorUnits(
      toMinorUnits(current.totalPaid, 'total paid') + toMinorUnits(payment)
    );
    current.status = computeStatus(current);
    await current.save({ session });
    return { record: current };
  });
  if (replayed) {
    req.skipSavedDataChange = true;
    return sendSuccess(res, { record });
  }
  await logAudit({
    tenantId: req.tenantId,
    action: 'salary_paid',
    user: req.user,
    resource: { type: 'StaffSalary', id: record._id, label: record.staffName },
    description: `Salary payment recorded (${type}) for ${record.staffName}`,
    req,
  });
  sendSuccess(res, { record });
});

export const getStaffSalaryHistory = asyncHandler(async (req, res) => {
  const { staffId } = req.params;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 24, maxLimit: 100 });
  const filter = { tenantId: req.tenantId, staffId };
  const [records, total] = await Promise.all([
    StaffSalary.find(filter).sort({ monthYear: -1 }).skip(skip).limit(limit),
    StaffSalary.countDocuments(filter),
  ]);
  sendPaginated(res, records, total, page, limit);
});

export const getStaffList = asyncHandler(async (req, res) => {
  const staff = await User.find({
    tenantId: req.tenantId,
    role: { $in: ['staff', 'packer', 'delivery'] },
    isActive: true,
  }).select('name phone role email').sort({ name: 1 }).limit(1000);
  sendSuccess(res, { staff });
});
