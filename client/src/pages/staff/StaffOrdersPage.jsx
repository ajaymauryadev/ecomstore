import { useSavedViewState } from '../../offline/useSavedViewState';
import OrderResponsibility from '../../components/orders/OrderResponsibility';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, ChevronRight, Clock, AlertTriangle, CheckCircle2, RefreshCw, Search } from 'lucide-react';
import { useGetMyPackingOrdersQuery, useStartPackingSessionMutation, useAcceptPackingOrderMutation } from '../../features/packing/packingApi';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { ROUTES } from '../../constants/routes';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';
import { useAuth } from '../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';

const STATUS_META = {
  pending: { label: 'Awaiting Acceptance', color: 'text-slate-400', bg: 'bg-navy-700 border-navy-600' },
  payment_pending: { label: 'Awaiting Payment', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  payment_submitted: { label: 'Payment Under Review', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  accepted: { label: 'Ready to Pack', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', dot: 'bg-blue-400' },
  payment_verified: { label: 'Payment Verified', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  packing: { label: 'In Progress', color: 'text-gold-400', bg: 'bg-gold-500/10 border-gold-500/30', dot: 'bg-gold-400' },
  packed: { label: 'Awaiting Verify', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30', dot: 'bg-purple-400' },
};

const ORDER_TYPE_LABEL = {
  home_delivery: 'Delivery',
  self_pickup: 'Pickup',
  online: 'Online',
  wholesale: 'Wholesale',
  counter: 'Counter',
};

function OrderCard({ order, onStart, onAccept, starting, packingPath, canPerform }) {
  const navigate = useNavigate();
  const meta = STATUS_META[order.status] || STATUS_META.accepted;
  const hasSession = !!order.packingSession;
  const waiting = ['pending', 'payment_pending', 'payment_submitted'].includes(order.status);
  const canAccept = canPerform && order.status === 'pending'
    && (['cod', 'cash_on_pickup', 'counter'].includes(order.paymentMethod) || order.paymentStatus === 'paid');
  const itemCount = order.items?.length ?? 0;
  const highValueCount = order.items?.filter((i) => i.isHighValue)?.length ?? 0;

  const handlePress = () => {
    if (canAccept) {
      onAccept(order);
    } else if (hasSession) {
      navigate(`${packingPath}/${order._id}`);
    } else {
      onStart(order._id);
    }
  };

  return (
    <article className="card packing-order-card p-0 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-navy-700/40">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold font-mono text-slate-100 break-all">{order.orderNumber}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {ORDER_TYPE_LABEL[order.orderType] || order.orderType}
            {order.customerInfo?.name && ` · ${order.customerInfo.name}`}
          </p>
        </div>
        <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full border', meta.bg, meta.color)}>
          <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1.5', meta.dot)} />
          {meta.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Package size={14} />
            <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
          </div>
          {highValueCount > 0 && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle size={14} />
              <span>{highValueCount} high-value</span>
            </div>
          )}
          {hasSession && order.packingSession && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <Clock size={14} />
              <span>
                {order.packingSession.totalPacked ?? 0}/{order.packingSession.totalRequired ?? itemCount} packed
              </span>
            </div>
          )}
        </div>

        {/* Progress bar when session exists */}
        {hasSession && order.packingSession?.totalRequired > 0 && (
          <div className="mt-3">
            <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gold-500 rounded-full transition-all"
                style={{
                  width: `${Math.round(
                    ((order.packingSession.totalPacked ?? 0) / order.packingSession.totalRequired) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-3"><OrderResponsibility order={order} compact /></div>
      {/* CTA */}
      <div className="px-4 pb-4">
        {waiting && !canAccept ? <p className="packing-waiting-note"><Clock size={15} className="shrink-0" aria-hidden="true" />
          {order.status === 'pending' ? 'The store owner must accept this order or verify its payment before packing.'
            : order.status === 'payment_submitted' ? 'Payment proof is under review. The owner or payment verifier must approve it before packing.'
            : 'Waiting for payment. Packing becomes available after payment verification.'}
        </p> : <button
          onClick={handlePress}
          disabled={starting || (!canPerform && !hasSession)}
          className={cn(
            'btn min-h-11 w-full sm:w-auto sm:min-w-44 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all',
            hasSession
              ? 'bg-gold-500/10 border border-gold-500/40 text-gold-400 hover:bg-gold-500/20'
              : 'btn-primary',
            starting && 'opacity-60 cursor-not-allowed'
          )}
        >
          {starting ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : canAccept ? <>Accept order <CheckCircle2 size={16} aria-hidden="true" /></> : hasSession ? (
            <>{canPerform ? 'Open Packing' : 'View Packing'} <ChevronRight size={16} /></>
          ) : (
            <>Start Packing <ChevronRight size={16} /></>
          )}
        </button>}
      </div>
    </article>
  );
}

export default function StaffOrdersPage({ packingPath = ROUTES.STAFF.PACKING }) {
  const { user } = useAuth();
  const managesAll = hasPermission(user, PERMISSIONS.PACKING_MANAGE);
  const canPerform = hasPermission(user, PERMISSIONS.PACKING_PERFORM);
  const { data, isLoading, isError, refetch } = useGetMyPackingOrdersQuery(undefined, {
    pollingInterval: 0, skipPollingIfUnfocused: true, refetchOnFocus: true, refetchOnReconnect: true,
  });
  const [startSession, { isLoading: starting }] = useStartPackingSessionMutation();
  const [acceptOrder, { isLoading: accepting }] = useAcceptPackingOrderMutation();
  const [acceptTarget, setAcceptTarget] = useState(null);
  const [search, setSearch] = useSavedViewState('StaffOrdersPage:StaffOrdersPage:search', '');
  const [statusFilter, setStatusFilter] = useSavedViewState('StaffOrdersPage:StaffOrdersPage:statusFilter', 'all');
  const [startingId, setStartingId] = useState(null);
  const navigate = useNavigate();

  const handleStart = async (orderId) => {
    setStartingId(orderId);
    try {
      await startSession({ orderId }).unwrap();
      navigate(`${packingPath}/${orderId}`);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to start session');
    } finally {
      setStartingId(null);
    }
  };

  const handleAccept = async () => {
    if (!acceptTarget || accepting) return;
    try {
      await acceptOrder({ orderId: acceptTarget._id }).unwrap();
      toast.success('Order accepted. You can start packing.');
      setAcceptTarget(null);
    } catch (error) { toast.error(error?.data?.message || 'Could not accept this order.'); }
  };

  const allOrders = data?.data?.orders ?? [];
  const statusGroups = { all: null, waiting: ['pending', 'payment_pending', 'payment_submitted'], ready: ['accepted', 'payment_verified'], packing: ['packing'], packed: ['packed'] };
  const orders = allOrders.filter((order) => (!statusGroups[statusFilter] || statusGroups[statusFilter].includes(order.status))
    && `${order.orderNumber} ${order.customerInfo?.name || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const active = orders.filter((o) => o.status === 'packing');
  const ready = orders.filter((o) => o.status === 'accepted' || o.status === 'payment_verified');
  const done = orders.filter((o) => o.status === 'packed');
  const waiting = orders.filter((o) => ['pending', 'payment_pending', 'payment_submitted'].includes(o.status));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 bg-navy-800 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError || allOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 size={48} className="text-slate-600 mb-4" />
        <p className="text-slate-400 font-medium">{isError ? 'Packing orders could not be loaded' : managesAll ? 'No orders to pack' : 'No orders assigned'}</p>
        <p className="text-slate-600 text-sm mt-1">{isError ? 'Check your connection and try again.' : managesAll ? 'Accepted orders will appear here without needing a staff assignment.' : 'Check back later or contact your manager'}</p>
        <button onClick={refetch} className="mt-6 flex items-center gap-2 text-gold-400 text-sm font-medium">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
    );
  }

  const Section = ({ title, items }) =>
    items.length === 0 ? null : (
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">{title}</p>
        <div className="space-y-3">
          {items.map((order) => (
            <OrderCard
              key={order._id}
              order={order}
              onStart={handleStart}
              onAccept={setAcceptTarget}
              starting={starting && startingId === order._id}
              packingPath={packingPath}
              canPerform={canPerform}
            />
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-5 fulfillment-workspace">
      <div className="page-header">
        <div><h1 className="page-title">{managesAll ? 'Pack Orders' : 'My Orders'}</h1>
          <p className="text-sm text-slate-400 mt-1">{allOrders.length} order{allOrders.length === 1 ? '' : 's'} · {managesAll ? 'All store packing work' : 'Your assigned packing work'}</p></div>
        <button type="button" aria-label="Refresh packing orders" onClick={refetch} className="workspace-row-action text-slate-400">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="relative"><Search size={17} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="search" aria-label="Search packing orders" placeholder="Search by order number or customer name…" value={search}
          onChange={(event) => setSearch(event.target.value)} className="input w-full pl-10" /></div>
      <div className="fulfillment-tabs" role="group" aria-label="Packing order status">
        {[['all', 'All'], ['waiting', 'New & payment'], ['ready', 'Ready to pack'], ['packing', 'Packing'], ['packed', 'Verification']].map(([value, label]) => (
          <button type="button" key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}
            className={cn('category-all', statusFilter === value && 'is-selected')}>{label}</button>
        ))}
      </div>

      <Section title="In Progress" items={active} />
      <Section title="Ready to Pack" items={ready} />
      <Section title="Awaiting acceptance or payment" items={waiting} />
      <Section title="Completed — Awaiting Verify" items={done} />
      {!orders.length && <div className="card p-8 text-center text-sm text-slate-500">No matching packing orders.</div>}
      <Modal isOpen={Boolean(acceptTarget)} onClose={() => !accepting && setAcceptTarget(null)} title="Accept order" size="sm">
        <p className="text-sm text-slate-400">Accept <strong className="text-slate-100 break-all">{acceptTarget?.orderNumber}</strong> for fulfillment? Packing will become available.</p>
        <div className="flex gap-3 mt-5"><Button fullWidth variant="secondary" disabled={accepting} onClick={() => setAcceptTarget(null)}>Cancel</Button>
          <Button fullWidth isLoading={accepting} onClick={handleAccept}>Confirm acceptance</Button></div>
      </Modal>
    </div>
  );
}
