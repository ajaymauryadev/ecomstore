import { fromMinorUnits, toMinorUnits } from './money.js';

export function invoiceAmounts(invoice) {
  const total = toMinorUnits(invoice.totalAmount ?? 0, 'invoice total');
  let paid = toMinorUnits(invoice.legacyPaidAmount ?? invoice.paidAmount ?? 0, 'invoice paid');
  let credits = 0;
  for (const entry of invoice.accountEntries ?? []) {
    const amount = toMinorUnits(entry.amount, 'invoice entry');
    if (entry.type === 'return_credit') credits += amount;
    else paid += amount;
  }
  const pending = total - paid - credits;
  const status = pending <= 0 ? 'PAID' : paid + credits > 0 ? 'PARTIAL' : 'UNPAID';
  return { total, paid, credits, pending, status };
}

export function setInvoiceAmounts(invoice) {
  const amounts = invoiceAmounts(invoice);
  invoice.paidAmount = fromMinorUnits(amounts.paid);
  invoice.pendingAmount = fromMinorUnits(amounts.pending);
  invoice.paymentStatus = amounts.status;
}
