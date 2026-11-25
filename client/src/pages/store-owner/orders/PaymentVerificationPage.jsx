import Pagination from '../../../components/ui/Pagination';
import { usePageSize, usePageState } from '../../../hooks/usePagination';
import { useState, useEffect } from 'react';
import {
  ShieldCheck, ShieldX, RefreshCw,
  Phone, CreditCard, Clock,
} from 'lucide-react';
import {
  useGetPaymentQueueQuery,
  useVerifyPaymentMutation,
} from '../../../features/orders/orderApi';
import { useAuth } from '../../../hooks/useAuth';
import { useSocket } from '../../../hooks/useSocket';
import { formatCurrency } from '../../../utils/formatters';
import { cn } from '../../../utils/cn';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import toast from 'react-hot-toast';
import SecurePaymentProof from '../../../components/orders/SecurePaymentProof';
import Modal from '../../../components/ui/Modal';

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const PAYMENT_METHOD_LABELS = {
  upi_qr: 'UPI QR', upi_id: 'UPI ID', cash_on_pickup: 'Cash Pickup',
  cod: 'COD', gateway: 'Gateway', bank_transfer: 'Bank Transfer',
  counter: 'Counter', credit: 'Credit',
};

/* ── Reject Modal ──────────────────────────────── */
function RejectModal({ onConfirm, onClose, isLoading }) {
  const [reason, setReason] = useState('');
  return (
    <Modal isOpen onClose={onClose} title="Reject Payment" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">The customer will be notified to resubmit payment proof.</p>
        <div className="space-y-1.5">
          <label htmlFor="payment-rejection-reason" className="text-xs font-medium text-slate-300">Reason for rejection *</label>
          <textarea
            id="payment-rejection-reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Screenshot unclear, Wrong amount, Fake screenshot..."
            rows={3}
            className="input resize-none w-full text-sm"
            required
          />
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            fullWidth
            isLoading={isLoading}
            onClick={() => {
              if (!reason.trim()) return toast.error('Please provide a reason');
              onConfirm(reason);
            }}
          >
            Reject Payment
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Screenshot Lightbox ────────────────────────── */
/* ── Payment Card ─────────────────────────────── */
function PaymentCard({ order, slug, onRefresh }) {
  const [verifyPayment, { isLoading }] = useVerifyPaymentMutation();
  const [showReject, setShowReject] = useState(false);

  const proof = order.paymentProof || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const handleApprove = async () => {
    if (!window.confirm(`Approve payment for ${order.orderNumber}?`)) return;
    try {
      await verifyPayment({ slug, orderId: order._id, action: 'approve' }).unwrap();
      toast.success(`Payment approved for ${order.orderNumber}`);
      onRefresh();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to approve payment');
    }
  };

  const handleReject = async (reason) => {
    try {
      await verifyPayment({ slug, orderId: order._id, action: 'reject', reason }).unwrap();
      toast.success(`Payment rejected for ${order.orderNumber}`);
      setShowReject(false);
      onRefresh();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to reject payment');
    }
  };

  return (
    <>
      <div className="card space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-semibold text-slate-300">{order.orderNumber}</p>
            <p className="text-base font-bold text-slate-100 mt-0.5">{order.customerInfo.name}</p>
            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <Phone size={10} />{order.customerInfo.phone}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-gold-400">{formatCurrency(order.pricing.grandTotal)}</p>
            <p className="text-xs text-slate-500">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <Clock size={9} className="inline mr-0.5" />
              {formatDate(proof.submittedAt || order.updatedAt)}
            </p>
          </div>
        </div>

        {/* Items summary */}
        <div className="text-xs text-slate-400 bg-navy-800 rounded-lg px-3 py-2">
          {items.length ? <>
            {items.length} item{items.length !== 1 ? 's' : ''}:
            {' '}{items.slice(0, 3).map((i) => `${i.name} ×${i.quantity}`).join(', ')}
            {items.length > 3 && ` +${items.length - 3} more`}
          </> : 'Item details unavailable'}
        </div>

        {/* Payment proof */}
        <div className="space-y-2">
          <SecurePaymentProof slug={slug} orderId={order._id} hasScreenshot={proof.hasScreenshot} />

          {proof.utrNumber && (
            <div className="flex items-center justify-between bg-navy-800 rounded-lg px-3 py-2">
              <div>
                <p className="text-[11px] text-slate-500">UTR / Reference</p>
                <p className="text-sm font-mono font-semibold text-slate-100">{proof.utrNumber}</p>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(proof.utrNumber); toast.success('Copied!'); }}
                className="min-h-11 px-3 text-xs text-gold-400 hover:text-gold-300 rounded bg-gold-500/10"
              >
                Copy
              </button>
            </div>
          )}

          {proof.notes && (
            <p className="text-xs text-slate-400 bg-navy-800 rounded-lg px-3 py-2">
              Customer note: {proof.notes}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="danger"
            className="flex-1 gap-2"
            onClick={() => setShowReject(true)}
            isLoading={isLoading}
          >
            <ShieldX size={15} /> Reject
          </Button>
          <Button
            className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-500"
            onClick={handleApprove}
            isLoading={isLoading}
          >
            <ShieldCheck size={15} /> Approve
          </Button>
        </div>
      </div>

      {showReject && (
        <RejectModal
          onConfirm={handleReject}
          onClose={() => setShowReject(false)}
          isLoading={isLoading}
        />
      )}

    </>
  );
}

/* ── Main Page ──────────────────────────────────── */
export default function PaymentVerificationPage() {
  const { store } = useAuth();
  const slug = store?.slug;
  const { on } = useSocket();
  const { limit } = usePageSize('rows');
  const [page, setPage] = usePageState(limit);

  const { data, isLoading, isFetching, refetch } = useGetPaymentQueueQuery(
    { slug, page, limit },
    { skip: !slug, pollingInterval: 30000, skipPollingIfUnfocused: true }
  );

  const orders = data?.data || [];
  const pagination = data?.meta;

  useEffect(() => {
    const fns = [
      on('order:payment_submitted', () => { refetch(); }),
    ];
    return () => fns.forEach((fn) => fn?.());
  }, [on, refetch]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <CreditCard size={20} className="text-gold-400" /> Payment Verification
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {pagination?.total ?? '...'} orders awaiting payment verification
          </p>
        </div>
        <button
          onClick={refetch}
          aria-label="Refresh payment queue"
          title="Refresh"
          className={cn('min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-navy-800 text-slate-400 transition-colors', isFetching && 'animate-spin')}
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" className="text-gold-500" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <ShieldCheck size={48} strokeWidth={1} className="mx-auto mb-3 text-emerald-400" />
          <p className="text-slate-300 font-semibold">All clear!</p>
          <p className="text-slate-500 text-sm mt-1">No pending payment verifications</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <PaymentCard key={order._id} order={order} slug={slug} onRefresh={refetch} />
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination meta={pagination} page={page} onPageChange={setPage} isFetching={isFetching} label="orders" />
    </div>
  );
}
