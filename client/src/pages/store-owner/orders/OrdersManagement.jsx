import { usePageSize } from '../../../hooks/usePagination';
import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, RefreshCw, ChevronRight, ChevronLeft,
  Package, MapPin, Phone,
  FileText,
} from 'lucide-react';
import {
  useGetAdminOrdersQuery,
  useGetAdminOrderQuery,
  useUpdateOrderStatusMutation,
  useAdminCancelOrderMutation,
  useAssignStaffMutation,
  useAssignDeliveryMutation,
} from '../../../features/orders/orderApi';
import OrderResponsibility from '../../../components/orders/OrderResponsibility';
import { actorLabel } from '../../../utils/orderResponsibility';
import WorkAssigneePicker from '../../../components/orders/WorkAssigneePicker';
import { useAuth } from '../../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatCurrency } from '../../../utils/formatters';
import { cn } from '../../../utils/cn';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import LoadError from '../../../components/ui/LoadError';
import toast from 'react-hot-toast';
import SecurePaymentProof from '../../../components/orders/SecurePaymentProof';
import { ORDER_ADMIN_STATUS_TRANSITIONS } from '../../../constants/orderStatus';
import Modal from '../../../components/ui/Modal';
import BillPaymentHistory from '../../../components/orders/BillPaymentHistory';
import ReceivePaymentModal from '../../../components/orders/ReceivePaymentModal';
import { BillSettlementSummary } from '../../../components/orders/CustomerBillsPanel';
import { SETTLEMENT_LABELS, paymentMethodLabel } from '../../../utils/settlement';
import { useCursorPages } from '../../../hooks/useCursorPages';
import { useStartPackingSessionMutation } from '../../../features/packing/packingApi';
import { resolveStoreTimeZone } from '../../../utils/accounting';

const STATUS_META = {
  pending:              { label: 'Pending',            color: 'text-gold-400',    bg: 'bg-gold-500/10',    border: 'border-gold-500/30' },
  payment_pending:      { label: 'Awaiting Payment',   color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  payment_submitted:    { label: 'Proof Submitted',    color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30' },
  payment_verified:     { label: 'Payment Verified',   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  accepted:             { label: 'Accepted',            color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30' },
  packing:              { label: 'Packing',             color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  packed:               { label: 'Packed',              color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  ready_for_pickup:     { label: 'Ready Pickup',       color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  out_for_delivery:     { label: 'Out for Delivery',   color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30' },
  delivered:            { label: 'Delivered',            color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  partially_fulfilled:  { label: 'Partial',             color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  cancelled:            { label: 'Cancelled',            color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30' },
  rejected:             { label: 'Rejected',             color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30' },
};


const PAYMENT_STATUS_META = {
  pending:   { label: 'Pending',   color: 'text-slate-400' },
  partial:   { label: 'Partially paid', color: 'text-amber-400' },
  submitted: { label: 'Submitted', color: 'text-blue-400' },
  paid:      { label: 'Paid',      color: 'text-emerald-400' },
  failed:    { label: 'Failed',    color: 'text-red-400' },
  refunded:  { label: 'Refunded',  color: 'text-amber-400' },
};

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) { return url?.startsWith('/') ? `${API_BASE}${url}` : url; }

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || {};
  return (
    <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', m.color, m.bg, m.border)}>
      {m.label || status}
    </span>
  );
}

/* ── Order Detail Drawer ─────────────────────────── */
function OrderDetailDrawer({ orderId, slug, onClose }) {
  const { user, store } = useAuth();
  const navigate = useNavigate();
  const [receiving, setReceiving] = useState(false);
  const [startPacking, { isLoading: startingPacking }] = useStartPackingSessionMutation();
  const canAssign = hasPermission(user, PERMISSIONS.ORDERS_ASSIGN) && hasPermission(user, PERMISSIONS.STAFF_VIEW);
  const { data, isLoading, refetch } = useGetAdminOrderQuery({ slug, orderId }, { skip: !orderId });
  const [updateStatus, { isLoading: isUpdating }] = useUpdateOrderStatusMutation();
  const [cancelOrder, { isLoading: isCancelling }] = useAdminCancelOrderMutation();
  const [assignStaff, { isLoading: isAssigningStaff }] = useAssignStaffMutation();
  const [assignDelivery, { isLoading: isAssigningDelivery }] = useAssignDeliveryMutation();

  const [statusPick, setStatusPick] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [activeTab, setActiveTab] = useState('details'); // details | payment | items | timeline

  const order = data?.data?.order;
  const validNext = order ? ORDER_ADMIN_STATUS_TRANSITIONS[order.status] || [] : [];
  const saveAssignment = async (kind, assigneeId) => {
    try {
      if (kind === 'packing') await assignStaff({ slug, orderId, staffId: assigneeId }).unwrap();
      else await assignDelivery({ slug, orderId, deliveryId: assigneeId }).unwrap();
      toast.success(`${kind === 'packing' ? 'Packing' : 'Delivery'} assignment updated.`);
      refetch();
    } catch (error) {
      toast.error(error?.data?.message || 'Assignment could not be updated.');
    }
  };

  const handleStatusUpdate = async () => {
    if (!statusPick) return toast.error('Select a status');
    try {
      await updateStatus({ slug, orderId, status: statusPick, message: statusMsg || undefined }).unwrap();
      toast.success(`Status updated to ${statusPick}`);
      setStatusPick(''); setStatusMsg('');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update status');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm(`Cancel ${order?.orderNumber || 'this order'} and restore its reserved stock?`)) return;
    try {
      await cancelOrder({ slug, orderId, reason: cancelReason }).unwrap();
      toast.success('Order cancelled');
      setCancelReason('');
      onClose();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to cancel order');
    }
  };

  const proof = order?.paymentProof;
  const ps = order?.status;

  return (
    <Modal isOpen onClose={onClose} title={order?.orderNumber || 'Order details'} size="2xl">
      <div className="space-y-4">
        {order && <StatusBadge status={order.status} />}

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size="lg" className="text-gold-500" />
          </div>
        ) : !order ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">Order not found</div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-0 border-b border-navy-700/60 shrink-0">
              {['details', 'items', 'payment', 'timeline'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'flex-1 py-2.5 text-xs font-semibold capitalize transition-colors',
                    activeTab === tab ? 'text-gold-400 border-b-2 border-gold-500' : 'text-slate-500 hover:text-slate-300'
                  )}
                >{tab}</button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Details tab */}
              {activeTab === 'details' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-navy-800 rounded-xl p-3">
                      <p className="text-[11px] text-slate-500 mb-1">Customer</p>
                      <p className="font-medium text-slate-200">{order.customerInfo.name}</p>
                      <p className="text-slate-400 flex items-center gap-1 mt-0.5"><Phone size={11} />{order.customerInfo.phone}</p>
                    </div>
                    <div className="bg-navy-800 rounded-xl p-3">
                      <p className="text-[11px] text-slate-500 mb-1">Order Info</p>
                      <p className="text-slate-200 capitalize">{order.orderType?.replace('_', ' ')}</p>
                      <p className="text-slate-400">{formatDate(order.createdAt)}</p>
                    </div>
                  </div>

                  {order.customerInfo.address?.line1 && (
                    <div className="bg-navy-800 rounded-xl p-3 text-sm">
                      <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><MapPin size={10} /> Delivery Address</p>
                      <p className="text-slate-300">{order.customerInfo.address.line1}</p>
                      {order.customerInfo.address.landmark && <p className="text-slate-400">{order.customerInfo.address.landmark}</p>}
                      <p className="text-slate-400">{[order.customerInfo.address.city, order.customerInfo.address.state, order.customerInfo.address.pincode].filter(Boolean).join(', ')}</p>
                    </div>
                  )}

                  {order.note && (
                    <div className="bg-navy-800 rounded-xl p-3 text-sm">
                      <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><FileText size={10} /> Note</p>
                      <p className="text-slate-300">{order.note}</p>
                    </div>
                  )}

                  <OrderResponsibility order={order} />
                  {hasPermission(user, PERMISSIONS.PACKING_PERFORM) && ['accepted', 'packing'].includes(order.status) && <Button variant="secondary" isLoading={startingPacking} onClick={async () => {
                    try { await startPacking({ orderId }).unwrap(); navigate('/store/packing/work/' + orderId); }
                    catch (error) { toast.error(error?.data?.message || 'Could not start packing.'); }
                  }}>Open packing work</Button>}
                  {canAssign && <div className="bg-navy-800 rounded-xl p-3 space-y-3">
                    <p className="text-xs font-semibold text-slate-300">Fulfillment assignments</p>
                    <WorkAssigneePicker kind="packing" current={order.assignedTo} snapshot={order.fulfillment?.packingAssignedTo} saving={isAssigningStaff} onSave={(id) => saveAssignment('packing', id)} disabled={['packing', 'packed', 'delivered', 'cancelled', 'rejected', 'ready_for_pickup', 'out_for_delivery'].includes(order.status)} />
                    {['home_delivery', 'online'].includes(order.orderType) && <WorkAssigneePicker kind="delivery" current={order.deliveryAssignedTo} snapshot={order.fulfillment?.deliveryAssignedTo} saving={isAssigningDelivery} onSave={(id) => saveAssignment('delivery', id)} disabled={['delivered', 'cancelled', 'rejected'].includes(order.status)} />}
                  </div>}

                  {/* Status update */}
                  {hasPermission(user, PERMISSIONS.ORDERS_STATUS_UPDATE) && validNext.length > 0 && (
                    <div className="bg-navy-800 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-300">Update Status</p>
                      <select
                        value={statusPick}
                        onChange={(e) => setStatusPick(e.target.value)}
                        className="input w-full text-sm"
                      >
                        <option value="">— Select next status —</option>
                        {validNext.map((s) => (
                          <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={statusMsg}
                        onChange={(e) => setStatusMsg(e.target.value)}
                        placeholder="Custom message (optional)"
                        className="input w-full text-sm"
                      />
                      <Button fullWidth size="sm" onClick={handleStatusUpdate} isLoading={isUpdating} disabled={!statusPick}>
                        Update Status
                      </Button>
                    </div>
                  )}

                  {/* Cancel */}
                  {hasPermission(user, PERMISSIONS.ORDERS_CANCEL) && !['delivered', 'cancelled', 'rejected'].includes(ps) && (
                    <div className="bg-navy-800 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-semibold text-red-400">Cancel Order</p>
                      <input
                        type="text"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Reason for cancellation"
                        className="input w-full text-sm"
                      />
                      <Button variant="danger" fullWidth size="sm" onClick={handleCancel} isLoading={isCancelling}>
                        Cancel Order
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Items tab */}
              {activeTab === 'items' && (
                <div className="space-y-3">
                  {order.items.map((item) => (
                    <div key={item._id} className="flex items-center gap-3 bg-navy-800 rounded-xl p-3">
                      {item.image ? (
                        <img src={imgSrc(item.image)} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-navy-700 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 line-clamp-1">{item.name}</p>
                        <p className="text-xs text-slate-400">{item.variantName} × {item.quantity}</p>
                        {item.fulfilledQty != null && item.fulfilledQty < item.quantity && (
                          <p className="text-xs text-amber-400">Fulfilled: {item.fulfilledQty}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-slate-100">{formatCurrency(item.total)}</p>
                        <p className="text-[11px] text-slate-500">{formatCurrency(item.price)}/unit</p>
                      </div>
                    </div>
                  ))}

                  <div className="bg-navy-800 rounded-xl p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-400"><span>Subtotal</span><span>{formatCurrency(order.pricing.subtotal)}</span></div>
                    {order.pricing.couponDiscount > 0 && <div className="flex justify-between text-emerald-400"><span>Coupon</span><span>-{formatCurrency(order.pricing.couponDiscount)}</span></div>}
                    {order.pricing.deliveryCharge > 0 && <div className="flex justify-between text-slate-400"><span>Delivery</span><span>{formatCurrency(order.pricing.deliveryCharge)}</span></div>}
                    <div className="flex justify-between font-bold text-slate-100 pt-1.5 border-t border-navy-700"><span>Grand Total</span><span className="text-gold-400">{formatCurrency(order.pricing.grandTotal)}</span></div>
                  </div>
                </div>
              )}

              {/* Payment tab */}
              {activeTab === 'payment' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-navy-800 rounded-xl p-3">
                      <p className="text-[11px] text-slate-500">Method</p>
                      <p className="font-medium text-slate-200">{paymentMethodLabel(order)}</p>
                    </div>
                    <div className="bg-navy-800 rounded-xl p-3">
                      <p className="text-[11px] text-slate-500">Payment Status</p>
                      <p className={cn('font-medium', PAYMENT_STATUS_META[order.paymentStatus]?.color)}>
                        {PAYMENT_STATUS_META[order.paymentStatus]?.label || order.paymentStatus}
                      </p>
                    </div>
                  </div>

                  {order.paymentSummary && <BillSettlementSummary summary={order.paymentSummary} total={order.pricing.grandTotal} timeZone={resolveStoreTimeZone(store?.settings?.timezone)} />}
                  {order.udharCustomerId && order.paymentSummary?.pending > 0 && !['cancelled', 'rejected'].includes(order.status) && hasPermission(user, PERMISSIONS.ACCOUNTING_MANAGE) && <Button onClick={() => setReceiving(true)}>Receive payment for this bill</Button>}
                  <BillPaymentHistory orderId={order._id} customerId={order.udharCustomerId} fallbackPayments={order.checkoutPayments} />

                  {proof && hasPermission(user, PERMISSIONS.ORDERS_PAYMENT_VERIFY) && (
                    <div className="bg-navy-800 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-300">Payment Proof</p>
                      <SecurePaymentProof slug={slug} orderId={orderId} hasScreenshot={proof.hasScreenshot} />
                      {proof.utrNumber && <p className="text-xs text-slate-300">UTR: <span className="font-mono">{proof.utrNumber}</span></p>}
                      {proof.notes && <p className="text-xs text-slate-400">{proof.notes}</p>}
                      {proof.submittedAt && <p className="text-xs text-slate-500">Submitted: {formatDate(proof.submittedAt)}</p>}
                      {proof.rejectedReason && <p className="text-xs text-red-400">Rejected: {proof.rejectedReason}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* Timeline tab */}
              {activeTab === 'timeline' && (
                <div className="space-y-3">
                  {[...(order.timeline || [])].reverse().map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-3 bg-navy-800 rounded-xl p-3">
                      <div className="w-2 h-2 rounded-full bg-gold-500 mt-2 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-slate-200">{entry.message}</p>
                        {entry.performedBy?.name && <p className="text-xs text-slate-400">By {actorLabel(entry.performedBy)}</p>}
                        {entry.assignee?.name && <p className="text-xs text-slate-400">Assigned to {actorLabel(entry.assignee)}</p>}
                        {entry.previousAssignee?.name && <p className="text-xs text-slate-500">Previously assigned to {actorLabel(entry.previousAssignee)}</p>}
                        <p className="text-xs text-slate-500">{formatDate(entry.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {receiving && order && <ReceivePaymentModal customer={{ _id: order.udharCustomerId, name: order.customerInfo.name, balance: order.paymentSummary.pending }} bill={order} onClose={() => setReceiving(false)} onSaved={refetch} />}
    </Modal>
  );
}

/* ── Filter chips ─────────────────────────────────── */
const FILTER_TABS = [
  { label: 'All', value: '' },
  { label: 'New', value: 'pending' },
  { label: 'Payment', value: 'payment_pending,payment_submitted' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Packing', value: 'packing,packed' },
  { label: 'Delivery', value: 'out_for_delivery,ready_for_pickup' },
  { label: 'Done', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled,rejected' },
];

/* ── Main Page ───────────────────────────────────── */
export default function OrdersManagement() {
  const { store } = useAuth();
  const slug = store?.slug;

  const [search, setSearch] = useState('');
  const settledSearch = useDebouncedValue(search.trim());
  const [statusFilter, setStatusFilter] = useState('');
  const { limit } = usePageSize('rows');
  const paging = useCursorPages(`${slug}:${statusFilter}:${settledSearch}:${limit}`);
  const page = paging.page;
  const [params, setParams] = useSearchParams();
  const selectedOrderId = params.get('orderId');
  const selectOrder = (id) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (id) next.set('orderId', id);
    else next.delete('orderId');
    return next;
  }, { replace: true });

  const { data, isLoading, isFetching, isError, error, refetch } = useGetAdminOrdersQuery(
    { slug, status: statusFilter, search: settledSearch || undefined, page, cursor: paging.cursor, limit },
    { skip: !slug }
  );

  const orders = data?.data || [];
  const pagination = data?.meta;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Orders</h1>
          {pagination && (
            <p className="text-sm text-slate-400">{pagination.total} total orders</p>
          )}
        </div>
        <button
          onClick={refetch}
          aria-label="Refresh orders"
          className="workspace-row-action text-slate-400"
        >
          <RefreshCw size={18} className={cn(isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          aria-label="Search orders"
          value={search}
          onChange={(e) => { setSearch(e.target.value); paging.reset(); }}
          placeholder="Search by order number, customer name or phone..."
          className="input pl-9 w-full"
        />
      </div>

      {/* Status filter chips */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map(({ label, value }) => (
          <button
            key={value}
            aria-pressed={statusFilter === value}
            onClick={() => { setStatusFilter(value); paging.reset(); }}
            className={cn(
              'min-h-11 px-3 py-1.5 rounded-xl text-sm font-semibold border transition-colors',
              statusFilter === value
                ? 'bg-gold-500/20 border-gold-500/40 text-gold-400'
                : 'bg-navy-800 border-navy-700 text-slate-400 hover:border-navy-600'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Orders list */}
      {isError ? <LoadError title="Could not load orders" error={error} retry={refetch} /> : isLoading ? (
        <div role="status" aria-label="Loading orders"><SkeletonTable /></div>
      ) : orders.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">
          <Package size={40} strokeWidth={1} className="mx-auto mb-3" />
          <p>No orders found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const pm = PAYMENT_STATUS_META[order.paymentStatus] || {};
            return (
              <button
                key={order._id}
                onClick={() => selectOrder(order._id)}
                className="w-full card hover:border-navy-600 transition-all text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-slate-300">{order.orderNumber}</span>
                      <StatusBadge status={order.status} />
                      <span className={cn('text-[11px] font-medium', pm.color)}>{order.paymentSummary ? SETTLEMENT_LABELS[order.paymentSummary.state] : pm.label}</span>
                    </div>
                    <p className="text-sm text-slate-200 mt-1 font-medium">{order.customerInfo.name}</p>
                    <p className="text-xs text-slate-400">{order.customerInfo.phone}</p>
                    <OrderResponsibility order={order} compact />
                    <p className="text-xs text-slate-500 mt-0.5">
                      {order.items.length} item{order.items.length !== 1 ? 's' : ''} ·{' '}
                      {order.orderType?.replace('_', ' ')} · {paymentMethodLabel(order)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-bold text-gold-400">{formatCurrency(order.pricing.grandTotal)}</p>
                    {order.paymentSummary && <p className="text-xs text-slate-500 mt-1">Pending {formatCurrency(order.paymentSummary.pending)}</p>}
                    <p className="text-[11px] text-slate-500 mt-0.5">{formatDate(order.createdAt)}</p>
                    <ChevronRight size={14} className="ml-auto mt-1 text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => paging.previous()}
            disabled={!paging.hasPrevious || isFetching}
            className="p-2 rounded-xl hover:bg-navy-800 text-slate-400 disabled:opacity-40"
          >
            <ChevronLeft size={18} /><span>Previous</span>
          </button>
          <span className="text-sm text-slate-400">Page {page} of {pagination.totalPages}</span>
          <button
            onClick={() => paging.next(pagination.nextCursor)}
            disabled={!pagination.hasNextPage || isFetching}
            className="p-2 rounded-xl hover:bg-navy-800 text-slate-400 disabled:opacity-40"
          >
            <ChevronRight size={18} /><span>Next</span>
          </button>
        </div>
      )}

      {/* Order detail drawer */}
      {selectedOrderId && (
        <OrderDetailDrawer
          orderId={selectedOrderId}
          slug={slug}
          onClose={() => selectOrder(null)}
        />
      )}
    </div>
  );
}
