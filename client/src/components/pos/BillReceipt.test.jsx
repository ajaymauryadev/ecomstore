import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ReceiptContent } from './BillReceipt';

const order = {
  orderNumber: 'BILL-001', createdAt: '2026-11-22T19:00:00Z', paymentMethod: 'counter', paymentStatus: 'paid',
  customerInfo: { name: 'Ajay' }, items: [{ name: 'Rusk', variantName: '250g', quantity: 3, price: 53, total: 159 }],
  pricing: { subtotal: 204, couponDiscount: 5, tax: 0, grandTotal: 199 },
};

test('prints saved totals and a store-local date without recomputing the bill or adding GST', () => {
  render(<ReceiptContent order={order} store={{ name: 'Kirana', settings: { timezone: 'Asia/Kolkata' } }} />);
  expect(screen.getByLabelText('Bill totals')).toHaveTextContent('₹204.00');
  expect(screen.getByLabelText('Bill totals')).toHaveTextContent('-₹5.00');
  expect(screen.getByLabelText('Bill totals')).toHaveTextContent('₹199.00');
  expect(screen.getByText(/23 Nov 2026/)).toBeInTheDocument();
  expect(screen.queryByText('Tax')).toBeNull();
  expect(screen.getByText('Paid', { exact: true })).toBeInTheDocument();
});

test('shows a credit purchase clearly and safely renders customer-provided text', () => {
  render(<ReceiptContent order={{ ...order, paymentMethod: 'credit', paymentStatus: 'pending', customerInfo: { name: '<script>alert(1)</script>' } }} store={{ name: 'Kirana' }} paper="thermal" />);
  expect(screen.getByRole('region', { name: 'Payment pending' })).toHaveTextContent('PAYMENT PENDING / उधार बाकी');
  expect(screen.getByRole('region', { name: 'Payment pending' })).toHaveTextContent('₹199.00');
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText(/Refer to the account ledger/)).toBeInTheDocument();
});

test('makes the unpaid balance clear for a split cash, UPI and Udhar bill', () => {
  render(<ReceiptContent order={{ ...order, paymentMethod: 'credit', paymentStatus: 'partial',
    pricing: { subtotal: 24098, grandTotal: 24098 }, udharAmount: 12898,
    checkoutPayments: [{ method: 'cash', amount: 1200 }, { method: 'upi', amount: 10000 }],
  }} />);
  expect(screen.getByRole('region', { name: 'Payment pending' })).toHaveTextContent('₹12,898.00');
  expect(screen.getByText('Cash received').parentElement).toHaveTextContent('₹1,200.00');
  expect(screen.getByText('UPI received').parentElement).toHaveTextContent('₹10,000.00');
  expect(screen.getByText('Pending amount (Udhar)').parentElement).toHaveTextContent('₹12,898.00');
});

test('uses the current bill balance after a later repayment', () => {
  render(<ReceiptContent order={{ ...order, paymentMethod: 'credit', paymentStatus: 'partial', udharAmount: 199,
    paymentSummary: { pending: 49, collected: 150 },
  }} />);
  expect(screen.getByRole('region', { name: 'Payment pending' })).toHaveTextContent('₹49.00');
  expect(screen.getByText('Added to Udhar').parentElement).toHaveTextContent('₹199.00');
  expect(screen.getByText('Payments after purchase').parentElement).toHaveTextContent('₹150.00');
});

test.each([
  { paymentStatus: 'paid' },
  { paymentStatus: 'paid', paymentSummary: { pending: 0 } },
  { paymentStatus: 'partial', settlement: { pending: 0 } },
  { paymentStatus: 'pending', status: 'cancelled' },
  { paymentStatus: 'refunded' },
])('does not mark a settled or closed credit bill as pending: %j', (settlement) => {
  render(<ReceiptContent order={{ ...order, paymentMethod: 'credit', udharAmount: 199, ...settlement }} />);
  expect(screen.queryByRole('region', { name: 'Payment pending' })).not.toBeInTheDocument();
  expect(screen.queryByText('Pending amount (Udhar)')).not.toBeInTheDocument();
  expect(screen.queryByText(/Please clear this Udhar balance/)).not.toBeInTheDocument();
});
