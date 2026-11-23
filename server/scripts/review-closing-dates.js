import 'dotenv/config';
import mongoose from 'mongoose';
import DailyClosing from '../src/models/DailyClosing.js';
import Store from '../src/models/Store.js';
import { resolveStoreTimeZone, storedClosingDate } from '../src/utils/accountingDay.js';

async function reportClosingDates(tenantId) {
  const groups = new Map();
  const legacyKeys = [];
  const unresolved = [];
  let scanned = 0;
  let currentTenant;
  let store;
  const filter = tenantId ? { tenantId } : {};
  const records = DailyClosing.find(filter).select('tenantId date status version')
    .sort({ tenantId: 1, date: 1, _id: 1 }).lean().cursor();

  for await (const record of records) {
    scanned += 1;
    const id = String(record.tenantId);
    if (id !== currentTenant) {
      currentTenant = id;
      store = record.tenantId
        ? await Store.findById(record.tenantId).select('settings.timezone').lean()
        : null;
    }
    const reference = {
      tenantId: record.tenantId ?? null,
      closingId: record._id,
      storedKey: record.date ?? null,
      status: record.status ?? null,
      version: record.version ?? 0,
    };
    const configuredZone = store?.settings?.timezone;
    const timeZone = resolveStoreTimeZone(configuredZone);
    const date = storedClosingDate(record.date, timeZone);
    if (!store || (configuredZone && configuredZone !== timeZone) || !date) {
      const reason = !store ? 'missing_store' : configuredZone && configuredZone !== timeZone
        ? 'invalid_store_timezone' : 'unrecognized_date_key';
      unresolved.push({ ...reference, reason });
      continue;
    }
    const entry = { ...reference, timeZone, ...date, proposedKey: date.businessDate + 'T00:00:00.000Z' };
    if (date.keyType === 'legacy_local_midnight') legacyKeys.push(entry);
    const key = `${id}/${date.businessDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const collisions = [...groups.values()].filter((entries) => entries.length > 1).map((entries) => ({
    tenantId: entries[0].tenantId,
    timeZone: entries[0].timeZone,
    businessDate: entries[0].businessDate,
    proposedKey: entries[0].proposedKey,
    records: entries,
  }));
  return { generatedAt: new Date(), tenantId: tenantId ?? null, scanned, legacyKeys, collisions, unresolved };
}

try {
  const [tenantId, ...extra] = process.argv.slice(2);
  if ((tenantId && !mongoose.isObjectIdOrHexString(tenantId)) || extra.length) {
    throw new Error('Pass a tenant ObjectId or omit it to scan all tenants.');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 6000,
  });
  console.log(JSON.stringify(await reportClosingDates(tenantId), null, 2));
} catch (error) {
  console.error(/^Pass a tenant|^MONGODB_URI is required/.test(error.message)
    ? error.message : `Closing date scan failed (${error.name}).`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
