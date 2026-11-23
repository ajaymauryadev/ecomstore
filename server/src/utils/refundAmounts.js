import { AppError } from './AppError.js';
import { toMinorUnits } from './money.js';

const sum = (values) => values.reduce((total, value) => total + value, 0);

function allocate(amount, weights) {
  const total = BigInt(sum(weights));
  if (total === 0n || amount === 0) return weights.map(() => 0);
  const shares = weights.map((weight, index) => {
    const weighted = BigInt(amount) * BigInt(weight);
    return { index, amount: Number(weighted / total), remainder: weighted % total };
  });
  const remaining = amount - sum(shares.map((share) => share.amount));
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const share of byRemainder.slice(0, remaining)) share.amount += 1;
  return shares.map((share) => share.amount);
}

export const fulfilledQuantity = (item) => item.fulfilledQty ?? item.quantity;

export function fulfilledDiscountMinor(order) {
  const eligibleSubtotal = sum(order.items.map((item) =>
    item.couponEligible === false ? 0 : toMinorUnits(item.price) * fulfilledQuantity(item)));
  return Math.min(toMinorUnits(order.pricing.couponDiscount ?? 0), eligibleSubtotal);
}

export function buildRefundLines(order) {
  const quantities = order.items.map(fulfilledQuantity);
  const selling = order.items.map((item, index) => toMinorUnits(item.price) * quantities[index]);
  const discount = fulfilledDiscountMinor(order);
  const isBillDiscount = order.orderType === 'counter' && !order.couponId && !order.couponCode;
  const discounts = allocate(discount, selling.map((value, index) =>
    order.items[index].couponEligible === false ? 0 : value));
  const net = selling.map((value, index) => value - discounts[index]);
  const taxes = allocate(toMinorUnits(order.pricing.tax ?? 0), net);
  return order.items.map((item, index) => ({
    quantity: quantities[index],
    itemDiscountMinor: Math.max(0, toMinorUnits(item.mrp ?? item.price) - toMinorUnits(item.price)) * quantities[index],
    billDiscountMinor: isBillDiscount ? discounts[index] : 0,
    couponDiscountMinor: isBillDiscount ? 0 : discounts[index],
    taxMinor: taxes[index],
    eligibleMinor: net[index] + taxes[index],
  }));
}

export function snapshotRefundLines(order) {
  buildRefundLines(order).forEach((line, index) => { order.items[index].refundBasis = line; });
}

export function refundBasis(order) {
  const bases = order.items.every((item) => item.refundBasis != null)
    ? order.items.map((item) => item.refundBasis)
    : buildRefundLines(order);
  const lines = new Map(order.items.map((item, index) => [String(item.variantId), bases[index]]));
  const billedMinor = toMinorUnits(order.pricing.grandTotal ?? 0);
  const receivedMinor = toMinorUnits(order.receivedAmount ?? order.pricing.grandTotal ?? 0)
    + toMinorUnits(order.settlement?.collected || 0);
  const billedMerchandise = Math.max(0,
    Math.min(billedMinor, receivedMinor) - toMinorUnits(order.pricing.deliveryCharge ?? 0));
  const paidMinor = order.paymentStatus === 'paid'
    ? Math.min(billedMerchandise, sum(bases.map((line) => line.eligibleMinor)))
    : 0;
  return { lines, paidMinor };
}

export function lineValueThrough(line, quantity) {
  if (!line?.quantity || quantity <= 0) return 0;
  return Number(BigInt(line.eligibleMinor) * BigInt(Math.min(quantity, line.quantity)) / BigInt(line.quantity));
}

export function recordedReturnValue(ret) {
  return Math.max(
    toMinorUnits(ret.totalRefundAmount ?? 0),
    toMinorUnits(ret.netRefund ?? 0) + toMinorUnits(ret.totalExchangeAmount ?? 0),
    sum(ret.items.map((item) => toMinorUnits(item.refundAmount ?? 0)))
  );
}

export function calculateReturnAmounts(order, items, processed, { refundMethod, exchangeMinor }) {
  const { lines, paidMinor } = refundBasis(order);
  const usedLines = new Map();
  let usedMinor = 0;
  for (const ret of processed) {
    usedMinor += recordedReturnValue(ret);
    for (const item of ret.items) {
      const key = String(item.variantId);
      const used = usedLines.get(key) ?? { quantity: 0, amount: 0 };
      used.quantity += item.qty;
      used.amount += toMinorUnits(item.refundAmount ?? 0);
      usedLines.set(key, used);
    }
  }
  let remaining = Math.max(0, paidMinor - usedMinor);
  if (refundMethod === 'no_refund') remaining = 0;
  if (refundMethod === 'exchange') remaining = Math.min(remaining, exchangeMinor);

  const seen = new Set();
  const amounts = items.map((item) => {
    const key = String(item.variantId);
    if (seen.has(key) || !Number.isSafeInteger(item.qty) || item.qty <= 0) {
      throw new AppError('Return lines must have unique variants and positive whole quantities.', 409);
    }
    seen.add(key);
    const line = lines.get(key);
    const used = usedLines.get(key) ?? { quantity: 0, amount: 0 };
    if (!line || used.quantity + item.qty > line.quantity) {
      throw new AppError('Return quantity exceeds the remaining fulfilled quantity.', 409);
    }
    const before = lineValueThrough(line, used.quantity);
    const after = lineValueThrough(line, used.quantity + item.qty);
    const amount = Math.min(remaining, after - Math.max(before, used.amount));
    const refundable = Math.max(0, amount);
    remaining -= refundable;
    return refundable;
  });
  const refundMinor = sum(amounts);
  if (exchangeMinor > refundMinor) {
    throw new AppError('Exchange value cannot exceed the refundable return value.', 409);
  }
  return { amounts, refundMinor, netMinor: refundMinor - exchangeMinor };
}
