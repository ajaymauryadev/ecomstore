export const SETTLEMENT_LABELS = { paid: 'Fully paid', partial: 'Partially paid', unpaid: 'Unpaid', closed: 'Closed / adjusted' };

export function paymentMethodLabel(order) {
  const labels = { counter: 'Cash', cash: 'Cash', cod: 'Cash on delivery', cash_on_pickup: 'Cash on pickup', upi: 'UPI', upi_id: 'UPI', upi_qr: 'UPI QR', credit: 'Udhar', bank_transfer: 'Bank transfer', gateway: 'Gateway' };
  const methods = [...new Set((order.checkoutPayments || []).map((payment) => payment.method))].map((method) => labels[method] || method);
  if (order.udharAmount > 0) methods.push('Udhar');
  return methods.length ? methods.join(' + ') : labels[order.paymentMethod] || order.paymentMethod;
}
