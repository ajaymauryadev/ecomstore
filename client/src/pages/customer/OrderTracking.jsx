import { useParams, Link } from 'react-router-dom';
import {
  CheckCircle, Clock, Package, Truck, MapPin, ShoppingBag,
  ArrowLeft, Phone, AlertCircle, RotateCcw, X, Upload,
  CreditCard, Check, Loader2, ShieldCheck, ShieldX,
  Warehouse, PackageCheck,
} from 'lucide-react';
import { useGetOrderQuery, useCancelOrderMutation, useSubmitPaymentProofMutation } from '../../features/orders/orderApi';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/useSocket';
import Modal from '../../components/ui/Modal';
import LoadError from '../../components/ui/LoadError';
import UpiPaymentDetails from '../../components/orders/UpiPaymentDetails';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) { return url?.startsWith('/') ? `${API_BASE}${url}` : url; }

const STATUS_META = {
  pending:              { label: 'Order Placed',         icon: Clock,        color: 'text-gold-400',    bg: 'bg-gold-500/20' },
  payment_pending:      { label: 'Awaiting Payment',     icon: CreditCard,   color: 'text-amber-400',   bg: 'bg-amber-500/20' },
  payment_submitted:    { label: 'Payment Submitted',    icon: Upload,       color: 'text-blue-400',    bg: 'bg-blue-500/20' },
  payment_verified:     { label: 'Payment Verified',     icon: ShieldCheck,  color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  accepted:             { label: 'Order Accepted',        icon: CheckCircle,  color: 'text-blue-400',    bg: 'bg-blue-500/20' },
  packing:              { label: 'Being Packed',          icon: Package,      color: 'text-amber-400',   bg: 'bg-amber-500/20' },
  packed:               { label: 'Packed',                icon: PackageCheck, color: 'text-amber-400',   bg: 'bg-amber-500/20' },
  ready_for_pickup:     { label: 'Ready for Pickup',     icon: MapPin,       color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  out_for_delivery:     { label: 'Out for Delivery',     icon: Truck,        color: 'text-purple-400',  bg: 'bg-purple-500/20' },
  delivered:            { label: 'Delivered',             icon: CheckCircle,  color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  partially_fulfilled:  { label: 'Partially Fulfilled',  icon: Warehouse,    color: 'text-amber-400',   bg: 'bg-amber-500/20' },
  cancelled:            { label: 'Cancelled',             icon: X,            color: 'text-red-400',     bg: 'bg-red-500/20' },
  rejected:             { label: 'Rejected',              icon: ShieldX,      color: 'text-red-400',     bg: 'bg-red-500/20' },
};

const STATUS_FLOW = {
  home_delivery:  ['pending', 'accepted', 'packing', 'packed', 'out_for_delivery', 'delivered'],
  online:         ['pending', 'accepted', 'packing', 'packed', 'out_for_delivery', 'delivered'],
  wholesale:      ['pending', 'accepted', 'packing', 'packed', 'out_for_delivery', 'delivered'],
  self_pickup:    ['pending', 'accepted', 'packing', 'packed', 'ready_for_pickup', 'delivered'],
  counter:        ['accepted', 'delivered'],
};

const PAYMENT_LABELS = {
  upi_qr: 'UPI QR', upi_id: 'UPI ID', cash_on_pickup: 'Cash on Pickup',
  cod: 'Cash on Delivery', gateway: 'Online Payment', bank_transfer: 'Bank Transfer',
  counter: 'Counter', credit: 'Credit',
};

const ORDER_TYPE_LABELS = {
  home_delivery: 'Home Delivery', self_pickup: 'Store Pickup',
  online: 'Online Order', counter: 'Counter', wholesale: 'Wholesale',
};

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ── Payment Proof Upload Panel ─────────────────── */
function PaymentPanel({ order, paymentInfo, slug, onRefresh }) {
  const [submitProof, { isLoading }] = useSubmitPaymentProofMutation();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [utrNumber, setUtrNumber] = useState('');
  const [notes, setNotes] = useState('');
  const fileRef = useRef();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const ps = paymentInfo || {};
  const isUpiQr = order.paymentMethod === 'upi_qr';
  const isUpiId = order.paymentMethod === 'upi_id';
  const isBankTransfer = order.paymentMethod === 'bank_transfer';
  const alreadySubmitted = order.status === 'payment_submitted';
  const proof = order.paymentProof;

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) {
      toast.error('Choose a JPG, PNG, or WebP image up to 5 MB.');
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!file && !utrNumber.trim()) {
      return toast.error('Upload screenshot or enter UTR/reference number');
    }
    const formData = new FormData();
    if (file) formData.append('screenshot', file);
    if (utrNumber) formData.append('utrNumber', utrNumber);
    if (notes) formData.append('notes', notes);

    try {
      await submitProof({ slug, orderId: order._id, formData }).unwrap();
      toast.success('Payment proof submitted! Admin will verify shortly.');
      onRefresh();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to submit payment proof');
    }
  };

  return (
    <div className="card space-y-4">
      <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
        <CreditCard size={14} className="text-gold-400" /> Payment
      </p>

      {/* Payment instructions */}
      {(isUpiQr || isUpiId) && (
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700 space-y-3">
          <p className="text-xs font-semibold text-gold-400 uppercase tracking-wide">Pay via UPI</p>

          <UpiPaymentDetails settings={ps} showQr={isUpiQr} amount={order.pricing.grandTotal} />

          <div className="flex items-center justify-between bg-navy-900 rounded-lg px-3 py-2">
            <div>
              <p className="text-[11px] text-slate-500">Amount to Pay</p>
              <p className="text-lg font-bold text-gold-400">{formatCurrency(order.pricing.grandTotal)}</p>
            </div>
          </div>
        </div>
      )}

      {isBankTransfer && (ps.bankAccount || ps.bankName) && (
        <div className="bg-navy-800 rounded-xl p-4 border border-navy-700 space-y-2">
          <p className="text-xs font-semibold text-gold-400 uppercase tracking-wide">Bank Transfer Details</p>
          {ps.bankAccountName && <p className="text-sm text-slate-200">Account Name: <span className="font-medium">{ps.bankAccountName}</span></p>}
          {ps.bankAccount && <p className="text-sm text-slate-200">Account No: <span className="font-mono">{ps.bankAccount}</span></p>}
          {ps.bankIfsc && <p className="text-sm text-slate-200">IFSC: <span className="font-mono">{ps.bankIfsc}</span></p>}
          {ps.bankName && <p className="text-sm text-slate-200">Bank: {ps.bankName}</p>}
          <p className="text-lg font-bold text-gold-400">{formatCurrency(order.pricing.grandTotal)}</p>
        </div>
      )}

      {/* Rejection notice */}
      {proof?.rejectedReason && order.status === 'payment_pending' && (
        <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/30">
          <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
            <X size={12} /> Payment proof rejected
          </p>
          <p className="text-xs text-red-300 mt-1">{proof.rejectedReason}</p>
          <p className="text-xs text-slate-400 mt-1">Please resubmit your payment proof.</p>
        </div>
      )}

      {/* Submitted state */}
      {alreadySubmitted && (
        <div className="bg-blue-500/10 rounded-xl p-3 border border-blue-500/30">
          <p className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Verification Pending
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Your payment proof has been submitted. Admin will verify shortly.
          </p>
          {proof?.screenshotUrl && (
            <a href={imgSrc(proof.screenshotUrl)} target="_blank" rel="noreferrer"
              className="text-xs text-blue-400 hover:underline mt-2 inline-block">
              View submitted screenshot
            </a>
          )}
          {proof?.utrNumber && (
            <p className="text-xs text-slate-400 mt-1">UTR: <span className="font-mono">{proof.utrNumber}</span></p>
          )}
        </div>
      )}

      {/* Upload form */}
      {order.status === 'payment_pending' && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-300">Submit Payment Proof</p>

          {/* Screenshot upload */}
          <div
            className={cn(
              'border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all',
              preview ? 'border-gold-500/40 bg-gold-500/5' : 'border-navy-600 hover:border-navy-500 bg-navy-800'
            )}
          >
            <input ref={fileRef} type="file" aria-label="Payment screenshot" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
            {preview ? (
              <div className="relative inline-block">
                <img src={preview} alt="Preview" className="max-h-32 mx-auto rounded-lg" />
                <button
                  type="button"
                  aria-label="Remove payment screenshot"
                  onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}
                  className="absolute -top-2 -right-2 w-11 h-11 bg-red-600 rounded-full flex items-center justify-center"
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full min-h-24 rounded-lg">
                <Upload size={24} className="mx-auto mb-2 text-slate-500" />
                <p className="text-xs text-slate-400">Tap to upload payment screenshot</p>
                <p className="text-[11px] text-slate-500 mt-0.5">JPG, PNG, WebP (max 5MB)</p>
              </button>
            )}
          </div>

          <div className="flex gap-2 items-center">
            <div className="flex-1 h-px bg-navy-700" />
            <span className="text-xs text-slate-500">or</span>
            <div className="flex-1 h-px bg-navy-700" />
          </div>

          <label htmlFor="payment-reference" className="label">UTR / Reference number</label>
          <input
            id="payment-reference"
            type="text"
            value={utrNumber}
            onChange={(e) => setUtrNumber(e.target.value)}
            placeholder="UTR / Reference number"
            className="input w-full text-sm"
          />

          <label htmlFor="payment-notes" className="label">Notes (optional)</label>
          <textarea
            id="payment-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="input resize-none w-full text-sm"
          />

          <Button fullWidth onClick={handleSubmit} isLoading={isLoading} className="gap-2">
            <Upload size={15} /> Submit Payment Proof
          </Button>
        </div>
      )}

      {/* Resubmit after rejection */}
      {order.status === 'payment_pending' && !proof?.rejectedReason && proof?.screenshotUrl && (
        <p className="text-xs text-slate-500 text-center">
          Previously submitted — you can upload again to replace.
        </p>
      )}
    </div>
  );
}

/* ── Main OrderTracking ─────────────────────────── */
export default function OrderTracking() {
  const { storeSlug, orderId } = useParams();
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const { on } = useSocket();

  const { data, isLoading, isFetching, isError, error, refetch } = useGetOrderQuery({ slug: storeSlug, orderId });
  const [cancelOrder, { isLoading: isCancelling }] = useCancelOrderMutation();

  const order = data?.data?.order;
  const paymentInfo = data?.data?.paymentInfo;

  // Realtime socket listeners
  useEffect(() => {
    const cleanupFns = [
      on('order:payment_verified', (d) => { if (d.orderId === orderId) { toast.success('Payment verified!'); refetch(); } }),
      on('order:payment_rejected', (d) => { if (d.orderId === orderId) { toast.error(`Payment rejected: ${d.reason}`); refetch(); } }),
      on('order:status_updated', (d) => { if (d.orderId === orderId) { toast(d.message || `Order status: ${d.status}`); refetch(); } }),
      on('order:cancelled', (d) => { if (d.orderId === orderId) { toast.error('Order cancelled by store'); refetch(); } }),
    ];
    return () => cleanupFns.forEach((fn) => fn?.());
  }, [orderId, on, refetch]);

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Spinner size="lg" className="text-gold-500" />
    </div>
  );

  if (isError && !order && error?.status !== 404) return <LoadError error={error} retry={refetch} title="Order could not be loaded" />;

  if (!order) return (
    <div className="text-center py-16 text-slate-500">
      <ShoppingBag size={48} strokeWidth={1} className="mx-auto mb-3" />
      <p>Order not found</p>
      <Link to={`/s/${storeSlug}/orders`} className="btn btn-secondary btn-sm mt-4 inline-block">View All Orders</Link>
    </div>
  );

  const steps = STATUS_FLOW[order.orderType] || STATUS_FLOW.online;
  const meta = STATUS_META[order.status] || {};
  const StatusIcon = meta.icon || Clock;

  const terminal = ['delivered', 'cancelled', 'rejected', 'partially_fulfilled'];
  const canCancel = !terminal.includes(order.status) && !['out_for_delivery', 'packing', 'packed'].includes(order.status);
  const needsPayment = ['payment_pending', 'payment_submitted'].includes(order.status) &&
    ['upi_qr', 'upi_id', 'bank_transfer', 'gateway'].includes(order.paymentMethod);

  const currentStepIdx = steps.indexOf(order.status);

  const handleCancel = async () => {
    try {
      await cancelOrder({ slug: storeSlug, orderId, reason: cancelReason || 'Cancelled by customer' }).unwrap();
      toast.success('Order cancelled.');
      setCancelModal(false);
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Could not cancel order.');
    }
  };

  return (
    <div className="order-tracking animate-fade-in space-y-6 pb-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/s/${storeSlug}/orders`} aria-label="Back to orders" className="workspace-row-action border border-navy-700 bg-navy-900 text-slate-400 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">Order Tracking</h1>
          <p className="mt-1 text-xs text-slate-400 font-mono break-all">{order.orderNumber}</p>
        </div>
        <button type="button" onClick={refetch} disabled={isFetching} aria-label="Refresh order" className="workspace-row-action ml-auto shrink-0 border border-navy-700 bg-navy-900 text-slate-400 transition-colors disabled:opacity-50">
          <RotateCcw size={16} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Status banner */}
      <div className="order-status rounded-2xl p-5 sm:p-6 flex flex-wrap items-center gap-4 border border-navy-600/50 bg-[var(--brand-tint)]">
        <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-sm">
          <StatusIcon size={22} className={meta.color} />
        </div>
        <div className="flex-1 min-w-0 basis-36">
          <p className={cn('font-bold text-lg', meta.color)}>{meta.label}</p>
          <p className="text-slate-400 text-xs mt-1">Updated {formatDate(order.updatedAt || order.createdAt)}</p>
        </div>
        <div className="order-status-details text-right shrink-0 space-y-1">
          <p className="text-xs text-slate-400">{ORDER_TYPE_LABELS[order.orderType]}</p>
          <p className="text-xs text-slate-500">{PAYMENT_LABELS[order.paymentMethod]}</p>
        </div>
      </div>

      <div className="order-detail-grid">
      <div className="order-activity space-y-5 min-w-0">
      {/* Payment panel (when payment is needed) */}
      {needsPayment && (
        <PaymentPanel order={order} paymentInfo={paymentInfo} slug={storeSlug} onRefresh={refetch} />
      )}

      {/* Payment verified banner */}
      {order.status === 'payment_verified' && (
        <div className="card flex items-center gap-3 bg-emerald-500/10 border-emerald-500/30">
          <ShieldCheck size={20} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-400">Payment Verified</p>
            <p className="text-xs text-slate-400">Your payment has been confirmed. Order will be processed shortly.</p>
          </div>
        </div>
      )}

      {/* Progress tracker */}
      {currentStepIdx >= 0 && (
        <section className="card space-y-6" aria-labelledby="order-progress-title">
          <h2 id="order-progress-title" className="text-base font-semibold text-slate-200">Progress</h2>
          <ol className="order-steps" aria-label="Order progress">
            {steps.map((step, idx) => {
              const sm = STATUS_META[step] || {};
              const SIcon = sm.icon || Clock;
              const done = idx < currentStepIdx;
              const active = idx === currentStepIdx;
              return (
                <li key={step} className="order-step" aria-current={active ? 'step' : undefined}>
                  {idx < steps.length - 1 && (
                    <div aria-hidden="true" className={cn('order-step-line', done ? 'bg-emerald-500' : 'bg-navy-700')} />
                  )}
                  <div className={cn(
                    'order-step-icon w-10 h-10 rounded-full flex items-center justify-center z-10 shrink-0 transition-all',
                    done ? 'bg-emerald-700 text-white' :
                    active ? 'bg-gold-500 text-white' :
                    'bg-navy-700 text-navy-500'
                  )}>
                    {done ? <Check size={14} /> : <SIcon size={14} />}
                  </div>
                  <p className={cn('order-step-label text-xs leading-snug', active ? 'text-gold-400 font-bold' : 'text-slate-400')}>
                    {sm.label}<span className="sr-only">{done ? ', completed' : active ? ', current' : ', upcoming'}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Timeline */}
      {order.timeline?.length > 0 && (
        <section className="card space-y-5" aria-labelledby="order-timeline-title">
          <h2 id="order-timeline-title" className="text-base font-semibold text-slate-200">Timeline</h2>
          <ol className="order-timeline space-y-5">
            {[...order.timeline].reverse().map((entry, idx) => {
              const em = STATUS_META[entry.status] || {};
              const EIcon = em.icon || Clock;
              return (
                <li key={idx} className="relative flex items-start gap-3">
                  <div className={cn('relative z-10 w-9 h-9 rounded-xl flex items-center justify-center shrink-0', em.bg || 'bg-navy-700')}>
                    <EIcon size={13} className={em.color || 'text-slate-400'} />
                  </div>
                  <div className="flex-1 min-w-0 break-words">
                    <p className={cn('text-sm font-medium', em.color || 'text-slate-300')}>{entry.message || em.label}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(entry.timestamp)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      </div>
      <div className="order-summary space-y-5 min-w-0">

      {/* Order items */}
      <section className="card space-y-5" aria-labelledby="order-items-title">
        <h2 id="order-items-title" className="text-base font-semibold text-slate-200 flex items-center gap-2"><ShoppingBag size={17} className="text-gold-400" />Items Ordered <span className="ml-auto badge bg-navy-700 text-slate-400">{order.items?.length || 0}</span></h2>
        <div className="space-y-4">
          {order.items?.map((item) => (
            <div key={item._id} className="flex items-center gap-3">
              {item.image ? (
                <img src={imgSrc(item.image)} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-navy-700 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 break-words">{item.name}</p>
                <p className="text-xs text-slate-500">
                  {item.variantName} × {item.fulfilledQty != null ? item.fulfilledQty : item.quantity}
                  {item.fulfilledQty != null && item.fulfilledQty < item.quantity && (
                    <span className="text-amber-400 ml-1">(ordered: {item.quantity})</span>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-slate-100">{formatCurrency(item.total)}</p>
                {item.mrp > item.price && (
                  <p className="text-xs text-slate-500 line-through">{formatCurrency(item.mrp * item.quantity)}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 text-sm border-t border-navy-700/60 pt-3">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal</span><span>{formatCurrency(order.pricing.subtotal)}</span>
          </div>
          {order.pricing.couponDiscount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>{order.couponCode}</span><span>-{formatCurrency(order.pricing.couponDiscount)}</span>
            </div>
          )}
          {order.pricing.deliveryCharge > 0 && (
            <div className="flex justify-between text-slate-400">
              <span>Delivery</span><span>{formatCurrency(order.pricing.deliveryCharge)}</span>
            </div>
          )}
          <div className="flex justify-between items-center font-bold text-slate-100 pt-3 mt-3 border-t border-navy-700/60">
            <span>Grand Total</span><span className="text-gold-400">{formatCurrency(order.pricing.grandTotal)}</span>
          </div>
        </div>
      </section>

      {/* Delivery info */}
      {order.customerInfo?.address?.line1 && (
        <section className="card" aria-labelledby="order-address-title">
          <h2 id="order-address-title" className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <MapPin size={14} className="text-gold-400" /> Delivery Address
          </h2>
          <div className="text-sm text-slate-300 space-y-1 leading-relaxed break-words">
            <p className="font-medium">{order.customerInfo.name}</p>
            <p className="flex items-center gap-1 text-slate-400"><Phone size={11} />{order.customerInfo.phone}</p>
            <p className="text-slate-400">{order.customerInfo.address.line1}</p>
            {order.customerInfo.address.landmark && <p className="text-slate-400">{order.customerInfo.address.landmark}</p>}
            <p className="text-slate-400">
              {[order.customerInfo.address.city, order.customerInfo.address.state, order.customerInfo.address.pincode].filter(Boolean).join(', ')}
            </p>
          </div>
        </section>
      )}
      </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-3 border-t border-navy-700 pt-5">
        {canCancel && (
          <Button variant="secondary" onClick={() => setCancelModal(true)} className="text-red-400">
            Cancel Order
          </Button>
        )}
        <Link to={`/s/${storeSlug}`} className="btn btn-primary btn-md flex items-center justify-center gap-1.5">
          <ShoppingBag size={15} /> Shop More
        </Link>
      </div>

      <Modal isOpen={cancelModal} onClose={() => setCancelModal(false)} title="Cancel Order?" size="sm">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} className="text-red-400" />
              <p className="font-semibold text-slate-100">This action cannot be undone.</p>
            </div>
            <p className="text-sm text-slate-400">Reserved stock will be restored.</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customer-cancel-reason" className="text-xs font-medium text-slate-300">Reason (optional)</label>
              <textarea
                id="customer-cancel-reason"
                name="reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Tell us why you're cancelling..."
                rows={2}
                className="input resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setCancelModal(false)}>Keep Order</Button>
              <Button variant="danger" fullWidth isLoading={isCancelling} onClick={handleCancel}>Cancel Order</Button>
            </div>
          </div>
      </Modal>
    </div>
  );
}
