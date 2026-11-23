import { AppError } from './AppError.js';

export const toMinorUnits = (value, field = 'amount', { allowZero = true } = {}) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw new AppError(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} finite number.`, 400);
  }
  if (number > Number.MAX_SAFE_INTEGER / 100) {
    throw new AppError(`${field} is too large.`, 400);
  }
  return Math.round((number + Number.EPSILON) * 100);
};

export const fromMinorUnits = (minorUnits) => Number((minorUnits / 100).toFixed(2));

export const roundMoney = (value, field = 'amount', options) =>
  fromMinorUnits(toMinorUnits(value, field, options));

export const percentOf = (minorUnits, percent, field = 'percentage') => {
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new AppError(`${field} must be between 0 and 100.`, 400);
  }
  return Math.round((minorUnits * value) / 100);
};

export const assertPositiveInteger = (value, field = 'quantity', maximum = 10000) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new AppError(`${field} must be a positive whole number no greater than ${maximum}.`, 400);
  }
  return number;
};
