export const ACCOUNTING_TIME_ZONE = 'Asia/Kolkata';

const formatters = new Map();

function dateFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' }));
  }
  return formatters.get(timeZone);
}

export function resolveStoreTimeZone(value) {
  if (typeof value !== 'string' || !value || /^[+-]/.test(value)) return ACCOUNTING_TIME_ZONE;
  try {
    dateFormatter(value);
    return value;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return ACCOUNTING_TIME_ZONE;
  }
}

export const accountingDate = (value = new Date(), timeZone = ACCOUNTING_TIME_ZONE) =>
  dateFormatter(timeZone).format(new Date(value));

export const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
};
