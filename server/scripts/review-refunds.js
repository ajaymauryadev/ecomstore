import 'dotenv/config';
import mongoose from 'mongoose';
import Order from '../src/models/Order.js';
import Return, { ACTIVE_RETURN_STATUSES } from '../src/models/Return.js';
import { calculateReturnAmounts, recordedReturnValue } from '../src/utils/refundAmounts.js';
import { toMinorUnits } from '../src/utils/money.js';

function reviewOrder(order, records) {
  const processed = [];
  const findings = [];
  for (const ret of records) {
    const reference = {
      tenantId: ret.tenantId,
      orderId: ret.orderId,
      orderNumber: order?.orderNumber ?? ret.orderNumber,
      returnId: ret._id,
      returnNumber: ret.returnNumber,
      status: ret.status,
    };
    try {
      const recordedMinor = recordedReturnValue(ret);
      if (!order) {
        findings.push({ ...reference, reason: 'missing_order', recordedMinor });
      } else {
        const { amounts, refundMinor: eligibleMinor } = calculateReturnAmounts(order, ret.items, processed, {
          refundMethod: ret.refundMethod === 'no_refund' ? ret.refundMethod : undefined,
          exchangeMinor: 0,
        });
        const lineExcessMinor = ret.items.reduce((sum, item, index) =>
          sum + Math.max(0, toMinorUnits(item.refundAmount ?? 0) - amounts[index]), 0);
        const exchangeOnlyCashMinor = ret.refundMethod === 'exchange' ? toMinorUnits(ret.netRefund ?? 0) : 0;
        const excessMinor = Math.max(recordedMinor - eligibleMinor, lineExcessMinor, exchangeOnlyCashMinor);
        if (excessMinor > 0) {
          findings.push({ ...reference, reason: 'over_refund', recordedMinor, eligibleMinor, excessMinor });
        }
      }
    } catch {
      findings.push({ ...reference, reason: 'invalid_return_or_order_amounts_or_quantities' });
    }
    if (ret.status === 'processed') processed.push(ret);
  }
  return findings;
}

async function main() {
  const [tenantId, ...extra] = process.argv.slice(2);
  if ((tenantId && !mongoose.isObjectIdOrHexString(tenantId)) || extra.length) {
    throw new Error('Pass a tenant ObjectId or omit it to scan all tenants.');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 6000,
  });

  const filter = { type: 'customer_return', status: { $in: ACTIVE_RETURN_STATUSES } };
  if (tenantId) filter.tenantId = tenantId;
  const cursor = Return.find(filter)
    .select('tenantId orderId orderNumber returnNumber status items totalRefundAmount totalExchangeAmount netRefund refundMethod')
    .sort({ tenantId: 1, orderId: 1, approvalSequence: 1, processedAt: 1, createdAt: 1, _id: 1 }).lean().cursor();
  const findings = [];
  let records = [];
  let scanned = 0;
  async function reviewGroup() {
    const [first] = records;
    if (!first) return;
    const order = first.orderId
      ? await Order.findOne({ _id: first.orderId, tenantId: first.tenantId })
        .select('items pricing orderType paymentStatus receivedAmount orderNumber couponId couponCode').lean()
      : null;
    const chronological = [
      ...records.filter((ret) => ret.status === 'processed'),
      ...records.filter((ret) => ret.status !== 'processed'),
    ];
    findings.push(...reviewOrder(order, chronological));
  }
  for await (const ret of cursor) {
    if (records.length && (String(ret.orderId) !== String(records[0].orderId) ||
        String(ret.tenantId) !== String(records[0].tenantId))) {
      await reviewGroup();
      records = [];
    }
    records.push(ret);
    scanned += 1;
  }
  await reviewGroup();
  console.log(JSON.stringify({ tenantId: tenantId ?? null, scanned, findings }, null, 2));
}

try {
  await main();
} catch (error) {
  const safeMessage = /^Pass a tenant|^MONGODB_URI is required/.test(error.message)
    ? error.message : `Database scan failed (${error.name}).`;
  console.error(safeMessage);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
