import { AppError } from './AppError.js';

export const DEFAULT_STORE_TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 86400000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i;
const formatters = new Map();

function zoneFormatters(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, {
      date: new Intl.DateTimeFormat('sv-SE', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }),
      offset: new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }),
    });
  }
  return formatters.get(timeZone);
}

export function resolveStoreTimeZone(value) {
  if (typeof value !== 'string' || !value || /^[+-]/.test(value)) return DEFAULT_STORE_TIME_ZONE;
  try {
    zoneFormatters(value);
    return value;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return DEFAULT_STORE_TIME_ZONE;
  }
}

const dateKey = (day) => new Date(day + 'T00:00:00.000Z');
const utcDate = (date) => date.toISOString().slice(0, 10);
const validDateLabel = (value) => {
  const key = dateKey(value);
  return Number.isFinite(key.getTime()) && utcDate(key) === value;
};

export function accountingDate(value = new Date(), timeZone = DEFAULT_STORE_TIME_ZONE) {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    if (validDateLabel(value)) return value;
  } else if (value instanceof Date || (typeof value === 'string' && OFFSET_TIMESTAMP.test(value) && validDateLabel(value.slice(0, 10)))) {
    const timestamp = new Date(value);
    if (Number.isFinite(timestamp.getTime())) return zoneFormatters(timeZone).date.format(timestamp);
  }
  throw new AppError('Use a valid calendar date or a timestamp with a UTC offset.', 400);
}

export function shiftAccountingDate(day, days) {
  return utcDate(new Date(dateKey(day).getTime() + days * DAY_MS));
}

function zoneOffset(formatter, timestamp) {
  const offset = formatter.formatToParts(timestamp).find(({ type }) => type === 'timeZoneName').value;
  if (offset === 'GMT') return 0;
  const [, sign, hours, minutes, seconds = '0'] = /^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(offset);
  const duration = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
  return sign === '-' ? -duration : duration;
}

function localDayStart(day, timeZone) {
  const target = dateKey(day).getTime();
  const { date, offset } = zoneFormatters(timeZone);
  const offsets = new Set([target - DAY_MS, target, target + DAY_MS].map((instant) => zoneOffset(offset, instant)));
  const midnights = [...offsets].map((candidate) => target - candidate)
    .filter((instant) => instant + zoneOffset(offset, instant) === target);
  if (midnights.length) return new Date(Math.min(...midnights));

  // A shift at midnight may skip that clock time. Find the start of the resulting local day.
  let before = target - DAY_MS;
  let after = target + DAY_MS;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (date.format(middle) < day) before = middle;
    else after = middle;
  }
  return new Date(after);
}

export function accountingDay(value, timeZone = DEFAULT_STORE_TIME_ZONE) {
  const businessDate = accountingDate(value, timeZone);
  return {
    businessDate,
    key: dateKey(businessDate),
    start: localDayStart(businessDate, timeZone),
    end: localDayStart(shiftAccountingDate(businessDate, 1), timeZone),
  };
}

export function accountingDateFilter(from, to, timeZone = DEFAULT_STORE_TIME_ZONE) {
  const first = from ? accountingDate(from, timeZone) : undefined;
  const last = to ? accountingDate(to, timeZone) : undefined;
  if (first && last && first > last) throw new AppError('Start date cannot be after end date.', 400);
  return {
    ...(first && { $gte: localDayStart(first, timeZone) }),
    ...(last && { $lt: localDayStart(shiftAccountingDate(last, 1), timeZone) }),
  };
}

export function accountingTimestamp(value, timeZone = DEFAULT_STORE_TIME_ZONE) {
  if (!value) return new Date();
  const day = accountingDate(value, timeZone);
  return typeof value === 'string' && DATE_ONLY.test(value) ? localDayStart(day, timeZone) : new Date(value);
}

export function closingDateKeys(day, timeZone = DEFAULT_STORE_TIME_ZONE) {
  const indiaMidnight = timeZone === DEFAULT_STORE_TIME_ZONE ? day.start : localDayStart(day.businessDate, DEFAULT_STORE_TIME_ZONE);
  return [...new Set([day.key, day.start, indiaMidnight].map(Number))]
    .map((key) => new Date(key))
    .filter((key) => storedClosingDate(key, timeZone)?.businessDate === day.businessDate);
}

export function storedClosingDate(timestamp, timeZone = DEFAULT_STORE_TIME_ZONE) {
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) return null;
  const utc = utcDate(timestamp);
  if (timestamp.getTime() === dateKey(utc).getTime()) return { businessDate: utc, keyType: 'utc_date_key' };
  for (const zone of new Set([timeZone, DEFAULT_STORE_TIME_ZONE])) {
    const businessDate = accountingDate(timestamp, zone);
    if (timestamp.getTime() === localDayStart(businessDate, zone).getTime()) {
      return { businessDate, keyType: 'legacy_local_midnight' };
    }
  }
  return null;
}
