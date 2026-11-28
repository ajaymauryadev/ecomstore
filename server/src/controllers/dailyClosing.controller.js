import { createHash } from 'node:crypto';
import DailyClosing, { closingSnapshot, MANUAL_MOVEMENT_TYPES } from '../models/DailyClosing.js';
import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { parsePagination } from '../utils/query.js';
import { runInTransaction } from '../utils/transaction.js';
import { computeClosingSummary } from '../services/dailyClosing.service.js';
import { accountingDay, closingDateKeys, shiftAccountingDate, storedClosingDate } from '../utils/accountingDay.js';
import { hasPermission, PERMISSIONS } from '../constants/permissions.js';

const closedConflict = () => new AppError('This day is finalized. Use an audited correction to revise it.', 409);
const staleVersion = () => new AppError('The closing version has changed. Reload the closing before continuing.', 409);
const versionFilter = (version) => version === 0 ? { $in: [0, null] } : version;

// Older Indian-host deployments stored local midnight rather than the UTC date key.
const findDayClosing = (tenantId, day, timeZone, session) => DailyClosing.findOne({
  tenantId, date: { $in: closingDateKeys(day, timeZone) },
}).sort({ status: 1, date: -1 }).session(session);

function dayForClosing(closing, timeZone) {
  const stored = storedClosingDate(closing.date, timeZone);
  if (!stored) throw new AppError('This legacy date key requires review before the closing can be changed.', 409);
  return accountingDay(stored.businessDate, timeZone);
}

function serializeClosing(closing, timeZone, original = false) {
  if (!closing) return null;
  return {
    ...closing.toObject(),
    businessDate: storedClosingDate(closing.date, timeZone)?.businessDate ?? null,
    ...(original && { corrections: [] }),
  };
}

const inputAmount = (input, previous, key) => {
  const value = Object.hasOwn(input, key) ? input[key] : previous?.[key];
  return value == null || value === '' ? null : fromMinorUnits(toMinorUnits(value, key));
};
const cashInputs = (input, previous) => ({
  openingCash: inputAmount(input, previous, 'openingCash'),
  closingCash: inputAmount(input, previous, 'closingCash'),
  notes: String(input.notes ?? previous?.notes ?? '').trim(),
});

const reviewKey = (summary) => createHash('sha256').update(JSON.stringify(summary)).digest('hex');
async function buildSnapshot(tenantId, day, cash, session, manual, finalizing = false, reviewed, differenceReason = cash.notes) {
  const { summary, cashNetMinor } = await computeClosingSummary(tenantId, day, session, manual);
  if (reviewed && reviewed !== reviewKey(summary)) throw new AppError('Money movements changed. Review the updated summary before finalizing.', 409);
  const expectedMinor = cash.openingCash == null ? null : toMinorUnits(cash.openingCash) + cashNetMinor;
  const difference = expectedMinor == null || expectedMinor < 0 || cash.closingCash == null
    ? null : fromMinorUnits(toMinorUnits(cash.closingCash) - expectedMinor);
  if (finalizing) {
    if (cash.openingCash == null || cash.closingCash == null) throw new AppError('Confirm opening cash and enter the physical drawer count.', 400);
    if (expectedMinor < 0) throw new AppError('Expected drawer cash is below zero. Check opening cash, missing receipts and payment methods.', 400);
    if (difference !== 0 && !differenceReason) throw new AppError('Add a note explaining the cash difference before finalizing.', 400);
  }
  return {
    ...summary,
    ...cash,
    expectedClosingCash: expectedMinor == null ? null : fromMinorUnits(expectedMinor),
    cashDifference: difference,
  };
}

const actorFields = (user) => ({ closedBy: user._id, closedByName: user.name });

async function suggestedOpening(tenantId, day, timeZone, session) {
  const candidates = await DailyClosing.find({
    tenantId, status: 'closed', date: { $lt: new Date(Math.max(day.start, day.key)) },
  }).sort({ date: -1 }).limit(8).select('date closingCash corrections.revised.closingCash').session(session).lean();
  const previous = candidates.map((record) => ({ record, date: storedClosingDate(record.date, timeZone)?.businessDate }))
    .filter(({ date }) => date && date < day.businessDate).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!previous) return null;
  const cash = previous.record.corrections?.at(-1)?.revised.closingCash ?? previous.record.closingCash;
  if (cash == null) return null;
  const start = accountingDay(shiftAccountingDate(previous.date, 1), timeZone).start;
  if (start >= day.start) return cash;
  const drafts = await DailyClosing.find({
    tenantId, 'manualMovements.0': { $exists: true }, date: { $gte: new Date(start.getTime() - 86400000), $lte: day.key },
  }).select('date manualMovements').session(session).lean();
  const manual = drafts.filter(({ date }) => {
    const businessDate = storedClosingDate(date, timeZone)?.businessDate;
    return businessDate > previous.date && businessDate < day.businessDate;
  }).flatMap((record) => record.manualMovements);
  const { cashNetMinor } = await computeClosingSummary(tenantId, { start, end: day.start }, session, manual);
  return fromMinorUnits(toMinorUnits(cash) + cashNetMinor);
}

export const getDailySummary = asyncHandler(async (req, res) => {
  const { storeTimeZone: timeZone } = req;
  const day = accountingDay(req.query.date, timeZone);
  const result = await runInTransaction(async (session) => {
    const closing = await findDayClosing(req.tenantId, day, timeZone, session);
    const { summary } = await computeClosingSummary(req.tenantId, day, session, closing?.manualMovements);
    const suggestedOpeningCash = closing?.openingCash == null ? await suggestedOpening(req.tenantId, day, timeZone, session) : null;
    return { date: day.key, businessDate: day.businessDate, timeZone, ...summary, reviewKey: reviewKey(summary), suggestedOpeningCash, closing: serializeClosing(closing, timeZone) };
  });
  sendSuccess(res, result);
});

const receivedTypes = ['sales', 'udharCollections', 'otherReceived'];
const paidTypes = ['supplierPayments', 'expenses', 'salaries', 'refunds', 'otherPaid'];
export const getDailyTransactions = asyncHandler(async (req, res) => {
  const day = accountingDay(req.query.date, req.storeTimeZone);
  const { kind, channel } = req.query;
  const types = kind === 'received' ? receivedTypes : kind === 'paid' ? paidTypes : kind === 'totalSales' ? ['sales', 'creditSales'] : [kind];
  if (!types.every((type) => [...receivedTypes, ...paidTypes, 'creditSales'].includes(type)) ||
      (channel && !['cash', 'upi', 'bank', 'other', 'unclassified', 'digital'].includes(channel))) throw new AppError('Invalid transaction filter.', 400);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const rows = await runInTransaction(async (session) => {
    const closing = await findDayClosing(req.tenantId, day, req.storeTimeZone, session);
    const { transactions } = await computeClosingSummary(req.tenantId, day, session, closing?.manualMovements, { types, channel });
    return transactions.sort((a, b) => new Date(b.date) - new Date(a.date) || String(a.reference).localeCompare(String(b.reference)));
  });
  const canReadSalary = hasPermission(req.user, PERMISSIONS.SALARY_VIEW);
  const visible = rows.slice(skip, skip + limit).map((row) => {
    if (row.type !== 'salaries' || canReadSalary) return row;
    return { type: row.type, method: row.method, date: row.date, amount: row.amount };
  });
  sendPaginated(res, visible, rows.length, page, limit);
});

export const saveDailyClosing = asyncHandler(async (req, res) => {
  const { date, expenses = [], status = 'closed', version, movement } = req.body;
  if (expenses.length) {
    throw new AppError('Record expenses in Accounting → Expenses. Daily Closing includes them automatically.', 400);
  }
  const { storeTimeZone: timeZone } = req;
  const day = accountingDay(date, timeZone);
  if (day.businessDate > accountingDay(undefined, timeZone).businessDate) throw new AppError('Select today or an earlier business date.', 400);
  if (movement && status !== 'draft') throw new AppError('Record money movements while the day is open.', 400);
  const manualEntry = movement && {
    operationId: movement.operationId, type: movement.type,
    method: movement.type.startsWith('bank_') || movement.type.startsWith('owner_') ? 'cash' : movement.type === 'external_upi' ? 'upi' : movement.method,
    amount: fromMinorUnits(toMinorUnits(movement.amount, 'movement amount', { allowZero: false })),
    party: movement.party?.trim(), description: movement.description.trim(),
    recordedAt: accountingDay(undefined, timeZone).businessDate === day.businessDate ? new Date() : day.start,
    recordedByName: req.user.name,
  };

  const save = () => runInTransaction(async (session) => {
    const existing = await findDayClosing(req.tenantId, day, timeZone, session);
    const recorded = movement && existing?.manualMovements.find((entry) => entry.operationId === movement.operationId);
    if (recorded) {
      if (['type', 'method', 'amount', 'party', 'description'].some((key) => recorded[key] !== manualEntry[key])) {
        throw new AppError('This request ID already belongs to another money movement.', 409);
      }
      req.skipSavedDataChange = true;
      return existing;
    }
    if (existing?.status === 'closed') {
      const cash = cashInputs(req.body);
      // Existing clients can replay an identical one-step close on a previously empty day.
      if (status === 'closed' && (version == null || version === 0) && existing.closedAt
          && existing.version === 1 && existing.finalizedFromVersion == null
          && Object.keys(cash).every((key) => cash[key] === existing[key])) {
        return existing;
      }
      throw closedConflict();
    }
    if (!existing) {
      if (version != null && version !== 0) throw staleVersion();
      const manualMovements = manualEntry ? [manualEntry] : [];
      const snapshot = await buildSnapshot(req.tenantId, day, cashInputs(req.body), session, manualMovements, status === 'closed');
      const [created] = await DailyClosing.create([{
        tenantId: req.tenantId,
        date: day.key,
        ...actorFields(req.user),
        ...snapshot,
        manualMovements,
        status,
        version: 1,
        ...(status === 'closed' && { closedAt: new Date() }),
      }], { session });
      return created;
    }

    if (status === 'closed') throw new AppError('Finalize the saved draft through the finalize action.', 409);
    if (version !== existing.version) throw staleVersion();
    if (manualEntry && existing.manualMovements.length >= 500) throw new AppError('This day has reached its manual entry limit.', 400);
    const manualMovements = manualEntry ? [...existing.manualMovements, manualEntry] : existing.manualMovements;
    const snapshot = await buildSnapshot(req.tenantId, day, cashInputs(req.body, existing), session, manualMovements);
    const draft = await DailyClosing.findOneAndUpdate(
      { _id: existing._id, tenantId: req.tenantId, status: 'draft', version: versionFilter(version) },
      { $set: { ...snapshot, ...actorFields(req.user), version: version + 1, ...(manualEntry && { manualMovements }) } },
      { new: true, session }
    );
    if (!draft) throw staleVersion();
    return draft;
  });

  let closing;
  try {
    closing = await save();
  } catch (error) {
    if (error.code !== 11000) throw error;
    closing = await save();
  }
  sendSuccess(res, { closing: serializeClosing(closing, timeZone, closing.status === 'closed') });
});

export const finalizeDailyClosing = asyncHandler(async (req, res) => {
  const { version } = req.body;
  const { storeTimeZone: timeZone } = req;
  const closing = await runInTransaction(async (session) => {
    const filter = { _id: req.params.id, tenantId: req.tenantId };
    const current = await DailyClosing.findOne(filter).session(session);
    if (!current) throw new AppError('Closing not found.', 404);
    if (current.status === 'closed') {
      if (current.finalizedFromVersion === version) return current;
      throw closedConflict();
    }
    if (current.version !== version) throw staleVersion();
    const day = dayForClosing(current, timeZone);
    const dayClosing = await findDayClosing(req.tenantId, day, timeZone, session);
    if (!current._id.equals(dayClosing?._id)) throw closedConflict();
    const snapshot = await buildSnapshot(req.tenantId, day, cashInputs({}, current), session, current.manualMovements, true, req.body.reviewKey);
    const finalized = await DailyClosing.findOneAndUpdate(
      { ...filter, status: 'draft', version: versionFilter(version) },
      { $set: {
        ...snapshot,
        ...actorFields(req.user),
        status: 'closed',
        closedAt: new Date(),
        version: version + 1,
        finalizedFromVersion: version,
      } },
      { new: true, session }
    );
    if (!finalized) throw staleVersion();
    return finalized;
  });
  sendSuccess(res, { closing: serializeClosing(closing, timeZone, true) });
});

export const correctDailyClosing = asyncHandler(async (req, res) => {
  const { version, reason } = req.body;
  const { storeTimeZone: timeZone } = req;
  const result = await runInTransaction(async (session) => {
    const filter = { _id: req.params.id, tenantId: req.tenantId };
    const current = await DailyClosing.findOne(filter).session(session);
    if (!current) throw new AppError('Closing not found.', 404);
    if (current.status !== 'closed') throw new AppError('Finalize the draft before recording a correction.', 409);
    const latest = current.corrections.at(-1);
    if (version !== (latest?.version ?? current.version)) throw staleVersion();
    const previous = latest?.revised ?? current;
    const day = dayForClosing(current, timeZone);
    const revised = await buildSnapshot(req.tenantId, day, cashInputs(req.body, previous), session, current.manualMovements, true, undefined, reason);
    const correction = {
      version: version + 1,
      reason,
      actorId: req.user._id,
      actorName: req.user.name,
      correctedAt: new Date(),
      previous: closingSnapshot(previous),
      revised,
    };
    const closing = await DailyClosing.findOneAndUpdate(
      { ...filter, status: 'closed', [`corrections.${current.corrections.length}`]: { $exists: false } },
      { $push: { corrections: correction } },
      { new: true, session, timestamps: false, runValidators: true }
    );
    if (!closing) throw staleVersion();
    const saved = closing.corrections.at(-1);
    await AuditLog.create([{
      tenantId: req.tenantId,
      action: 'daily_closing_corrected',
      performedBy: { userId: req.user._id, name: req.user.name, role: req.user.role },
      resource: { type: 'DailyClosing', id: closing._id, label: day.businessDate },
      changes: { correctionId: saved._id, version: saved.version, reason: saved.reason },
      description: 'Daily closing correction recorded',
    }], { session });
    return { closing: serializeClosing(closing, timeZone), correction: saved };
  });
  sendSuccess(res, result, 201);
});

export const getDailyClosings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const [records, total] = await Promise.all([
    DailyClosing.find({ tenantId: req.tenantId }).sort({ date: -1 }).skip(skip).limit(limit),
    DailyClosing.countDocuments({ tenantId: req.tenantId }),
  ]);
  sendPaginated(res, records.map((record) => serializeClosing(record, req.storeTimeZone)), total, page, limit);
});

export const getDailyClosing = asyncHandler(async (req, res, next) => {
  const record = await DailyClosing.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!record) return next(new AppError('Record not found.', 404));
  sendSuccess(res, { closing: serializeClosing(record, req.storeTimeZone) });
});
