import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import PurchaseEntry from '../models/PurchaseEntry.js';
import Supplier from '../models/Supplier.js';
import { AppError } from '../utils/AppError.js';
import { invoiceAmounts, setInvoiceAmounts } from '../utils/invoiceAmounts.js';
import { fromMinorUnits, toMinorUnits } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';

export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque'];

const invoiceFields = 'supplierId purchaseDate invoiceNumber totalAmount paidAmount pendingAmount paymentStatus legacyPaidAmount accountEntries';

const hasInvoiceMismatch = (invoice, amounts) =>
  amounts.pending < 0 || Math.round((invoice.pendingAmount ?? 0) * 100) !== amounts.pending
  || Math.round((invoice.paidAmount ?? 0) * 100) !== amounts.paid || invoice.paymentStatus !== amounts.status;

function summarizeInvoices(invoices) {
  const totals = { totalPurchased: 0, totalPaid: 0, pendingAmount: 0 };
  const rows = invoices.map((invoice) => {
    const amounts = invoiceAmounts(invoice);
    totals.totalPurchased += amounts.total - amounts.credits;
    totals.totalPaid += amounts.paid;
    totals.pendingAmount += amounts.pending;
    return { invoice, amounts, mismatch: hasInvoiceMismatch(invoice, amounts) };
  });
  return { totals, rows };
}

// Account payments follow purchase date, with invoice ID breaking same-date ties.
const supplierInvoices = (tenantId, supplierId, session) => PurchaseEntry.find({ tenantId, supplierId })
  .select(invoiceFields)
  .sort({ purchaseDate: 1, _id: 1 })
  .session(session);

function supplierMismatch(supplier, summary) {
  return summary.rows.some(({ mismatch }) => mismatch)
    || Object.entries(summary.totals).some(([field, value]) => Math.round((supplier[field] ?? 0) * 100) !== value);
}

function requireReconciled(supplier, invoices) {
  const summary = summarizeInvoices(invoices);
  if (supplierMismatch(supplier, summary)) {
    throw new AppError('Supplier and invoice balances differ. Review Supplier Payments → Reconciliation before recording another payment.', 409);
  }
}

function setSupplierTotals(supplier, invoices) {
  const { totals } = summarizeInvoices(invoices);
  for (const [field, amount] of Object.entries(totals)) supplier[field] = fromMinorUnits(amount);
}

function paymentIdFor(req, scope) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return new mongoose.Types.ObjectId();
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(key)) throw new AppError('Invalid Idempotency-Key header.', 400);
  const hash = createHash('sha256').update(JSON.stringify([String(req.tenantId), String(scope), key])).digest('hex');
  return new mongoose.Types.ObjectId(hash.slice(0, 24));
}

async function applyEntry(invoice, entry, session) {
  invoice.legacyPaidAmount ??= invoice.paidAmount ?? 0;
  invoice.accountEntries.push(entry);
  setInvoiceAmounts(invoice);
  await invoice.save({ session });
}

async function allocate({ invoices, amountMinor, entry, session }) {
  const allocations = [];
  let remaining = amountMinor;
  for (const invoice of invoices) {
    if (remaining === 0) break;
    const applied = Math.min(remaining, invoiceAmounts(invoice).pending);
    if (applied <= 0) continue;
    const amount = fromMinorUnits(applied);
    await applyEntry(invoice, { ...entry, amount }, session);
    allocations.push({ purchaseId: invoice._id, invoiceNumber: invoice.invoiceNumber, amount });
    remaining -= applied;
  }
  if (remaining !== 0) throw new AppError('Amount exceeds the available invoice balance.', 409);
  return allocations;
}

function assertSamePayment(payment, { amountMinor, method, note, purchaseId }) {
  if (toMinorUnits(payment.amount) !== amountMinor || payment.method !== method || (payment.note ?? '') !== note
      || String(payment.targetPurchaseId ?? '') !== String(purchaseId ?? '')) {
    throw new AppError('This payment key was already used with different payment details.', 409);
  }
}

export async function postSupplierPayment({ req, supplierId, purchaseId }) {
  const method = req.body.method ?? 'cash';
  if (!PAYMENT_METHODS.includes(method)) throw new AppError('Invalid supplier payment method.', 400);
  const amountMinor = toMinorUnits(req.body.amount, 'payment amount', { allowZero: false });
  if (amountMinor <= 0) throw new AppError('Payment must be at least one paisa.', 400);
  const note = String(req.body.note || '').trim().slice(0, 300);
  const postedAt = new Date();
  const { tenantId } = req;
  const recordedBy = req.user._id;

  return runInTransaction(async (session) => {
    const purchase = purchaseId
      ? await PurchaseEntry.findOne({ _id: purchaseId, tenantId }).session(session) : null;
    if (purchaseId && !purchase) throw new AppError('Purchase not found.', 404);
    const accountId = supplierId ?? purchase?.supplierId;
    const supplier = accountId ? await Supplier.findOne({ _id: accountId, tenantId }).session(session) : null;
    if (accountId && !supplier) throw new AppError('Supplier not found.', 404);
    const paymentId = paymentIdFor(req, supplier?._id ?? purchase._id);
    const existing = supplier
      ? supplier.paymentHistory.id(paymentId)
      : purchase.accountEntries.find((entry) => entry.type === 'payment' && entry.referenceId.equals(paymentId));
    if (existing) {
      const payment = supplier ? existing : {
        _id: paymentId, amount: existing.amount, method: existing.method, note: existing.note,
        paidAt: existing.postedAt, targetPurchaseId: purchase._id,
        allocations: [{ purchaseId: purchase._id, invoiceNumber: purchase.invoiceNumber, amount: existing.amount }],
      };
      assertSamePayment(payment, { amountMinor, method, note, purchaseId: purchase?._id });
      return { supplier, purchase, payment };
    }

    let invoices = [purchase];
    if (supplier) {
      invoices = await supplierInvoices(tenantId, supplier._id, session);
      requireReconciled(supplier, invoices);
      if (purchase) invoices = invoices.map((invoice) => invoice._id.equals(purchase._id) ? purchase : invoice);
    } else if (hasInvoiceMismatch(purchase, invoiceAmounts(purchase))) {
      throw new AppError('Invoice amounts are inconsistent. Review the invoice before posting another payment.', 409);
    }

    const targets = purchase ? [purchase] : invoices;
    const outstanding = targets.reduce((sum, invoice) => sum + invoiceAmounts(invoice).pending, 0);
    if (amountMinor > outstanding) throw new AppError('Payment exceeds outstanding invoice balance.', 409);
    const allocations = await allocate({
      invoices: targets, amountMinor, session,
      entry: { type: 'payment', referenceId: paymentId, method, note, recordedBy, postedAt },
    });
    const payment = {
      _id: paymentId, amount: fromMinorUnits(amountMinor), method, note, recordedBy, paidAt: postedAt,
      targetPurchaseId: purchase?._id, allocations,
    };
    if (supplier) {
      supplier.paymentHistory.push(payment);
      setSupplierTotals(supplier, invoices);
      await supplier.save({ session });
    }
    return { supplier, purchase, payment };
  });
}

export async function recordPurchaseOpening({ purchase, supplier, paidMinor, method, recordedBy, session }) {
  if (paidMinor > 0) {
    const paymentId = new mongoose.Types.ObjectId();
    const postedAt = new Date();
    const note = 'Initial payment for ' + (purchase.invoiceNumber || purchase._id);
    const allocations = await allocate({
      invoices: [purchase], amountMinor: paidMinor, session,
      entry: { type: 'payment', referenceId: paymentId, method, recordedBy, note, postedAt },
    });
    supplier?.paymentHistory.push({
      _id: paymentId, amount: fromMinorUnits(paidMinor), method, note, recordedBy,
      paidAt: postedAt, targetPurchaseId: purchase._id, allocations,
    });
  }
  if (supplier) {
    const amounts = invoiceAmounts(purchase);
    supplier.totalPurchased = fromMinorUnits(toMinorUnits(supplier.totalPurchased) + amounts.total);
    supplier.totalPaid = fromMinorUnits(toMinorUnits(supplier.totalPaid) + amounts.paid);
    supplier.pendingAmount = fromMinorUnits(toMinorUnits(supplier.pendingAmount) + amounts.pending);
    await supplier.save({ session });
  }
}

export async function applyPurchaseReturnCredit({ returnEntry, recordedBy, session }) {
  const { tenantId, supplierId, purchaseEntryId, totalValue, _id } = returnEntry;
  const supplier = await Supplier.findOne({ _id: supplierId, tenantId }).session(session);
  if (!supplier) throw new AppError('Supplier not found.', 404);
  const invoices = await supplierInvoices(tenantId, supplierId, session);
  requireReconciled(supplier, invoices);
  const invoice = invoices.find(({ _id }) => _id.equals(purchaseEntryId));
  if (!invoice) throw new AppError('Purchase invoice not found.', 404);
  await allocate({
    invoices: [invoice, ...invoices.filter((other) => other !== invoice)],
    amountMinor: toMinorUnits(totalValue), session,
    entry: { type: 'return_credit', referenceId: _id, recordedBy, postedAt: new Date() },
  });
  setSupplierTotals(supplier, invoices);
  await supplier.save({ session });
}

export async function supplierReconciliation(tenantId, supplierId) {
  return runInTransaction(async (session) => {
    const suppliers = await Supplier.find({ tenantId, ...(supplierId && { _id: supplierId }) })
      .select('name totalPurchased totalPaid pendingAmount').sort({ name: 1, _id: 1 }).session(session).lean();
    const invoices = await PurchaseEntry.find({ tenantId, supplierId: { $in: suppliers.map(({ _id }) => _id) } })
      .select(invoiceFields).sort({ purchaseDate: 1, _id: 1 }).session(session).lean();
    const bySupplier = new Map();
    for (const invoice of invoices) {
      const key = String(invoice.supplierId);
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(invoice);
    }
    const mismatches = [];
    for (const supplier of suppliers) {
      const summary = summarizeInvoices(bySupplier.get(String(supplier._id)) ?? []);
      if (!supplierMismatch(supplier, summary)) continue;
      const invoicesToReview = summary.rows.filter(({ mismatch, amounts }) => mismatch || amounts.pending > 0);
      mismatches.push({
        supplierId: supplier._id,
        supplierName: supplier.name,
        stored: { totalPurchased: supplier.totalPurchased, totalPaid: supplier.totalPaid, pendingAmount: supplier.pendingAmount },
        expected: Object.fromEntries(Object.entries(summary.totals).map(([field, amount]) => [field, fromMinorUnits(amount)])),
        invoiceCount: invoicesToReview.length,
        invoices: invoicesToReview.map(({ invoice, amounts }) => ({
          purchaseId: invoice._id, invoiceNumber: invoice.invoiceNumber,
          storedPending: invoice.pendingAmount, expectedPending: fromMinorUnits(amounts.pending),
          storedStatus: invoice.paymentStatus, expectedStatus: amounts.status,
        })),
      });
    }
    return mismatches;
  });
}
