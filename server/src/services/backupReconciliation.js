import { hash } from './backupMedia.js';
import { decodeDocument } from './backupModels.js';

const minor = (value) => Math.round(Number(value) * 100);
const lastByDate = (left, right) =>
  new Date(left.createdAt) - new Date(right.createdAt) || String(left._id).localeCompare(String(right._id));

export function reconcileBackup(data) {
  const orders = data.orders.map(decodeDocument);
  const products = data.products.map(decodeDocument);
  const ledger = data.stockLedger.map(decodeDocument).sort(lastByDate);
  const customers = data.udhar.map(decodeDocument);
  const entries = data.udharEntries.map(decodeDocument).sort(lastByDate);
  const discrepancies = [];
  const orderIds = new Set(orders.map((order) => String(order._id)));
  const purchases = new Set(data.purchases.map((purchase) => purchase._id.$oid));
  const returns = new Set(data.returns.map((item) => item._id.$oid));
  const references = { Order: orderIds, PurchaseEntry: purchases, Return: returns };
  const variantKey = (productId, variantId) => String(productId) + '/' + String(variantId);
  const variants = products.flatMap((product) => (product.variants || []).map((variant) => ({
    id: variantKey(product._id, variant._id), stock: Number(variant.stock),
  })));
  const variantIds = new Set(variants.map((variant) => variant.id));
  const endingStock = new Map();
  for (const row of ledger) {
    const key = variantKey(row.productId, row.variantId);
    if (Number(row.balanceBefore) + Number(row.quantityChange) !== Number(row.balanceAfter)) {
      discrepancies.push({ type: 'stock-row-arithmetic', id: String(row._id) });
    }
    const earlier = endingStock.get(key);
    if (earlier !== undefined && earlier !== Number(row.balanceBefore)) {
      discrepancies.push({ type: 'stock-ledger-gap', id: String(row._id) });
    }
    endingStock.set(key, Number(row.balanceAfter));
    const linked = references[row.referenceType];
    if (!variantIds.has(key) || (linked instanceof Set && !linked.has(String(row.referenceId)))) {
      discrepancies.push({ type: 'stock-history-link-missing', id: String(row._id) });
    }
  }
  for (const { id, stock } of variants) {
    if (endingStock.has(id) && endingStock.get(id) !== stock) {
      discrepancies.push({ type: 'stock-balance-mismatch', id, stored: stock, ledger: endingStock.get(id) });
    }
  }

  const customerIds = new Set(customers.map((customer) => String(customer._id)));
  const balances = new Map();
  for (const entry of entries) {
    const customerId = String(entry.customerId);
    const change = minor(entry.amount) * (entry.type === 'debit' ? 1 : -1);
    const balance = (balances.get(customerId) || 0) + change;
    balances.set(customerId, balance);
    if (minor(entry.balanceAfter) !== balance) {
      discrepancies.push({ type: 'udhar-running-balance-mismatch', id: String(entry._id) });
    }
    if (!customerIds.has(customerId) || (['order', 'pos_order'].includes(entry.referenceType) && !orderIds.has(String(entry.referenceId)))) {
      discrepancies.push({ type: 'udhar-history-link-missing', id: String(entry._id) });
    }
  }
  for (const customer of customers) {
    const id = String(customer._id);
    const stored = minor(customer.balance);
    const expected = balances.get(id) || 0;
    if (stored !== expected) discrepancies.push({ type: 'udhar-balance-mismatch', id, stored, ledger: expected });
  }

  const orderTotals = orders.map((order) => {
    const pricing = order.pricing || {};
    const total = minor(pricing.grandTotal);
    const expected = minor(pricing.subtotal) - minor(pricing.couponDiscount || 0)
      + minor(pricing.deliveryCharge || 0) + minor(pricing.tax || 0);
    if (!Number.isSafeInteger(total) || total !== expected) {
      discrepancies.push({ type: 'order-total-mismatch', id: String(order._id), stored: total, calculated: expected });
    }
    return { id: String(order._id), total };
  });
  const customerBalances = customers.map((customer) => ({
    id: String(customer._id), balance: minor(customer.balance),
  }));
  return {
    orderTotalMinor: orderTotals.reduce((sum, order) => sum + order.total, 0),
    stockUnits: variants.reduce((sum, variant) => sum + variant.stock, 0),
    udharBalanceMinor: customerBalances.reduce((sum, customer) => sum + customer.balance, 0),
    orderTotalsSha256: hash(JSON.stringify(orderTotals)),
    stockBalancesSha256: hash(JSON.stringify(variants)),
    udharBalancesSha256: hash(JSON.stringify(customerBalances)),
    discrepancies,
  };
}
