import DailyClosing, { closingSnapshot } from '../models/DailyClosing.js';
import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { parsePagination } from '../utils/query.js';
import { runInTransaction } from '../utils/transaction.js';
import { computeClosingSummary } from '../services/dailyClosing.service.js';
import { accountingDay, closingDateKeys, storedClosingDate } from '../utils/accountingDay.js';

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

const cashInputs = (input, previous) => ({
  openingCash: fromMinorUnits(toMinorUnits(input.openingCash ?? previous?.openingCash ?? 0, 'opening cash')),
  closingCash: fromMinorUnits(toMinorUnits(input.closingCash ?? previous?.closingCash ?? 0, 'closing cash')),
  notes: String(input.notes ?? previous?.notes ?? '').trim(),
});

async function buildSnapshot(tenantId, day, cash, session) {
  const { summary, cashNetMinor } = await computeClosingSummary(tenantId, day, session);
  const expectedMinor = toMinorUnits(cash.openingCash) + cashNetMinor;
  return {
    ...summary,
    ...cash,
    expectedClosingCash: fromMinorUnits(expectedMinor),
    cashDifference: fromMinorUnits(toMinorUnits(cash.closingCash) - expectedMinor),
  };
}

const actorFields = (user) => ({ closedBy: user._id, closedByName: user.name });

export const getDailySummary = asyncHandler(async (req, res) => {
  const { storeTimeZone: timeZone } = req;
  const day = accountingDay(req.query.date, timeZone);
  const result = await runInTransaction(async (session) => {
    const closing = await findDayClosing(req.tenantId, day, timeZone, session);
    const { summary } = await computeClosingSummary(req.tenantId, day, session);
    return { date: day.key, businessDate: day.businessDate, timeZone, ...summary, closing: serializeClosing(closing, timeZone) };
  });
  sendSuccess(res, result);
});

export const saveDailyClosing = asyncHandler(async (req, res) => {
  const { date, expenses = [], status = 'closed', version } = req.body;
  if (expenses.length) {
    throw new AppError('Record expenses in Accounting → Expenses. Daily Closing includes them automatically.', 400);
  }
  const { storeTimeZone: timeZone } = req;
  const day = accountingDay(date, timeZone);

  const save = () => runInTransaction(async (session) => {
    const existing = await findDayClosing(req.tenantId, day, timeZone, session);
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
      const snapshot = await buildSnapshot(req.tenantId, day, cashInputs(req.body), session);
      const [created] = await DailyClosing.create([{
        tenantId: req.tenantId,
        date: day.key,
        ...actorFields(req.user),
        ...snapshot,
        status,
        version: 1,
        ...(status === 'closed' && { closedAt: new Date() }),
      }], { session });
      return created;
    }

    if (status === 'closed') throw new AppError('Finalize the saved draft through the finalize action.', 409);
    if (version !== existing.version) throw staleVersion();
    const snapshot = await buildSnapshot(req.tenantId, day, cashInputs(req.body, existing), session);
    const draft = await DailyClosing.findOneAndUpdate(
      { _id: existing._id, tenantId: req.tenantId, status: 'draft', version: versionFilter(version) },
      { $set: { ...snapshot, ...actorFields(req.user), version: version + 1 } },
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
    const snapshot = await buildSnapshot(req.tenantId, day, cashInputs({}, current), session);
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
    const revised = await buildSnapshot(req.tenantId, day, cashInputs(req.body, previous), session);
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
