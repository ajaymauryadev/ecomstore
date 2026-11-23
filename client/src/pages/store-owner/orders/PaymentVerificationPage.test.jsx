import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import PaymentVerificationPage from './PaymentVerificationPage';

const api = vi.hoisted(() => ({ queue: vi.fn() }));
vi.mock('../../../features/orders/orderApi', () => ({
  useGetPaymentQueueQuery: api.queue,
  useVerifyPaymentMutation: () => [vi.fn(), {}],
}));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ store: { slug: 'test' } }) }));
vi.mock('../../../components/orders/SecurePaymentProof', () => ({ default: () => <p>No screenshot was uploaded.</p> }));

const order = {
  _id: 'order', orderNumber: 'ORD-123', customerInfo: { name: 'Buyer', phone: '9876543210' },
  pricing: { grandTotal: 200 }, paymentMethod: 'upi_id', updatedAt: '2026-11-23T08:00:00Z',
};

test.each([undefined, [{ name: 'Rice', quantity: 2 }]])('renders pending payments safely with item data %j', (items) => {
  api.queue.mockReturnValue({ data: { data: [{ ...order, items }], meta: { total: 1 } }, refetch: vi.fn() });
  render(<PaymentVerificationPage />);
  expect(screen.getByRole('heading', { name: 'Payment Verification' })).toBeInTheDocument();
  expect(screen.getByText('ORD-123')).toBeInTheDocument();
  expect(screen.getByText(items ? '1 item: Rice ×2' : 'Item details unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
});
