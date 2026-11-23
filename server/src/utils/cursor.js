import mongoose from 'mongoose';
import { AppError } from './AppError.js';

export function encodeCursor(row, fields) {
  return Buffer.from(JSON.stringify(fields.map((field) => row[field]))).toString('base64url');
}

export function cursorFilter(cursor, fields, { stringId = false } = {}) {
  if (!cursor) return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 1024) throw new Error();
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!Array.isArray(values) || values.length !== fields.length) throw new Error();
    const typed = values.map((value, index) => {
      if (index === fields.length - 1) {
        if (stringId) { if (typeof value !== 'string' || !value || value.length > 150) throw new Error(); return value; }
        if (!mongoose.isValidObjectId(value)) throw new Error();
        return new mongoose.Types.ObjectId(value);
      }
      const date = new Date(value);
      if (typeof value !== 'string' || Number.isNaN(date.getTime())) throw new Error();
      return date;
    });
    return { $or: fields.map((field, index) => Object.fromEntries([
      ...fields.slice(0, index).map((prefix, i) => [prefix, typed[i]]), [field, { $lt: typed[index] }],
    ])) };
  } catch { throw new AppError('Invalid page cursor. Refresh the list and try again.', 400); }
}

export function cursorMeta(rows, limit, fields, extra = {}) {
  const hasNextPage = rows.length > limit;
  const data = rows.slice(0, limit);
  return { data, meta: { ...extra, limit, hasNextPage,
    nextCursor: hasNextPage && data.length ? encodeCursor(data.at(-1), fields) : null } };
}
