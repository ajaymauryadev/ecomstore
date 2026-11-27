import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState, useEffect } from 'react';
import {
  Package, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ChevronRight, ShieldAlert, Clock, User,
} from 'lucide-react';
import {
  useGetPackingQueueQuery,
  useGetAdminPackingSessionQuery,
  useVerifyPackingSessionMutation,
} from '../../../features/packing/packingApi';
import toast from 'react-hot-toast';
import { cn } from '../../../utils/cn';
import Modal from '../../../components/ui/Modal';

const ITEM_STATUS_COLOR = {
  packed: 'text-emerald-400',
  missing: 'text-red-400',
  pending: 'text-slate-500',
  picked: 'text-blue-400',
};

function RejectModal({ onConfirm, onClose, loading }) {
  const [reason, setReason] = useState('');
  return (
    <Modal isOpen onClose={onClose} title="Reject Packing Session" size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Staff will be notified and must redo the packing.</p>
        <div>
          <label htmlFor="packing-rejection-reason" className="text-xs text-slate-400 mb-1.5 block">Rejection reason (required)</label>
          <textarea
            id="packing-rejection-reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe what needs to be corrected..."
            rows={3}
            className="w-full bg-navy-900 border border-navy-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60 resize-none"
            required
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-navy-600 text-slate-400 font-medium text-sm"
          >
            Cancel
          </button>
          <button
            disabled={!reason.trim() || loading}
            onClick={() => onConfirm(reason.trim())}
            className="flex-1 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading && <RefreshCw size={13} className="animate-spin" />}
            Reject
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SessionDetailPanel({ sessionId, onVerified }) {
  const { data, isLoading } = useGetAdminPackingSessionQuery({ sessionId });
  const [verifySession, { isLoading: verifying }] = useVerifyPackingSessionMutation();
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState('ready_for_pickup');

  const session = data?.data?.session;
  const order = data?.data?.order;
  const nextStatus = ['self_pickup', 'counter'].includes(order?.orderType) ? 'ready_for_pickup' : 'out_for_delivery';
  useEffect(() => { setDeliveryMethod(nextStatus); }, [nextStatus]);

  const handleVerify = async (action, rejectionReason) => {
    try {
      await verifySession({
        sessionId,
        action,
        rejectionReason,
        nextStatus: action === 'approve' ? deliveryMethod : undefined,
      }).unwrap();
      toast.success(action === 'approve' ? 'Session verified! Order status updated.' : 'Session rejected.');
      if (action === 'approve') onVerified?.();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to verify session');
    } finally {
      setShowRejectModal(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-navy-800 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (!session) return <p className="text-slate-500 text-sm">Session not found</p>;

  const items = session.items ?? [];
  const packed = items.filter((i) => i.status === 'packed').length;
  const missing = items.filter((i) => i.status === 'missing').length;
  const highValueMissing = items.filter((i) => i.isHighValue && i.status === 'missing');
  const isAlreadyVerified = session.status === 'verified' || session.status === 'rejected';

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-200">Order #{order?.orderNumber}</p>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <User size={11} /> {session.staffName}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Completed</p>
            <p className="text-xs text-slate-400">{new Date(session.completedAt).toLocaleString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-navy-700/40">
          <div>
            <p className="text-lg font-bold text-emerald-400">{packed}</p>
            <p className="text-[10px] text-slate-500">Packed</p>
          </div>
          <div>
            <p className={cn('text-lg font-bold', missing > 0 ? 'text-red-400' : 'text-slate-600')}>{missing}</p>
            <p className="text-[10px] text-slate-500">Missing</p>
          </div>
          <div>
            <p className="text-lg font-bold text-slate-400">{items.length}</p>
            <p className="text-[10px] text-slate-500">Total</p>
          </div>
        </div>

        {highValueMissing.length > 0 && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
            <ShieldAlert size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-amber-300 font-semibold">High-value items missing:</p>
              {highValueMissing.map((i) => (
                <p key={i._id} className="text-xs text-amber-400 mt-0.5">• {i.name} — {i.missingReason}</p>
              ))}
            </div>
          </div>
        )}

        {session.staffNotes && (
          <div className="bg-navy-700/60 rounded-xl px-3 py-2.5">
            <p className="text-xs text-slate-500 mb-0.5">Staff notes</p>
            <p className="text-xs text-slate-300">{session.staffNotes}</p>
          </div>
        )}
      </div>

      {/* Items list */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item._id} className="flex items-center gap-3 bg-navy-800 border border-navy-700/40 rounded-xl p-3">
            {item.image ? (
              <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover bg-navy-700 shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-navy-700 flex items-center justify-center shrink-0">
                <Package size={16} className="text-slate-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
              <p className="text-xs text-slate-500">
                {item.variantName && `${item.variantName} · `}Qty: {item.requiredQty}
              </p>
              {item.missingReason && (
                <p className="text-xs text-red-400 mt-0.5">Missing: {item.missingReason}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {item.isHighValue && <AlertTriangle size={12} className="text-amber-400" />}
              <span className={cn('text-xs font-semibold capitalize', ITEM_STATUS_COLOR[item.status])}>
                {item.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Verify controls */}
      {!isAlreadyVerified && (
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">After approval, move order to:</label>
            <div className="flex gap-2">
              {[
                { value: 'ready_for_pickup', label: 'Ready for Pickup' },
                { value: 'out_for_delivery', label: 'Out for Delivery' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  disabled={opt.value !== nextStatus}
                  onClick={() => setDeliveryMethod(opt.value)}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl border text-xs font-medium transition-all',
                    deliveryMethod === opt.value
                      ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                      : 'border-navy-600 text-slate-400'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              disabled={verifying}
              onClick={() => setShowRejectModal(true)}
              className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <XCircle size={15} /> Reject
            </button>
            <button
              disabled={verifying}
              onClick={() => handleVerify('approve')}
              className="flex-1 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {verifying ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Approve
            </button>
          </div>
        </div>
      )}

      {isAlreadyVerified && (
        <div className={cn(
          'flex items-center gap-3 rounded-xl px-4 py-3 border',
          session.status === 'verified'
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-red-500/10 border-red-500/30'
        )}>
          {session.status === 'verified'
            ? <CheckCircle2 size={16} className="text-emerald-400" />
            : <XCircle size={16} className="text-red-400" />
          }
          <p className={cn('text-sm font-medium', session.status === 'verified' ? 'text-emerald-400' : 'text-red-400')}>
            {session.status === 'verified' ? 'Verified' : `Rejected — ${session.rejectionReason}`}
          </p>
        </div>
      )}

      {showRejectModal && (
        <RejectModal
          loading={verifying}
          onConfirm={(reason) => handleVerify('reject', reason)}
          onClose={() => setShowRejectModal(false)}
        />
      )}
    </div>
  );
}

function QueueCard({ session, isSelected, onClick }) {
  const highValueMissing = session.highValueMissingCount > 0;
  const completedAt = new Date(session.completedAt);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-navy-800 border rounded-xl p-4 transition-all',
        isSelected ? 'border-gold-500/50 bg-gold-500/5' : 'border-navy-700/60 hover:border-navy-600',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-200">Order #{session.orderNumber}</p>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            <User size={11} /> {session.staffName}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {highValueMissing && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
              <ShieldAlert size={10} /> HIGH VALUE
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Clock size={10} /> {completedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs">
        <span className="text-emerald-400">{session.totalPacked} packed</span>
        {session.totalMissing > 0 && <span className="text-red-400">{session.totalMissing} missing</span>}
        <span className="text-slate-500">{session.totalRequired} total</span>
        <ChevronRight size={12} className="text-slate-600 ml-auto" />
      </div>
    </button>
  );
}

export default function PackingVerificationPage() {
  const paging = usePagination();
  const { data, isLoading, isFetching, refetch } = useGetPackingQueueQuery(
    { page: paging.page, limit: paging.limit },
    { skip: false }
  );
  const [selectedId, setSelectedId] = useState(null);
  const sessions = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-navy-800 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Packing Queue</h1>
          <p className="text-xs text-slate-500 mt-0.5">{data?.meta?.total ?? sessions.length} session{sessions.length !== 1 ? 's' : ''} awaiting verification</p>
        </div>
        <button onClick={refetch} className="p-2 rounded-xl hover:bg-navy-700 text-slate-400">
          <RefreshCw size={16} />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 size={48} className="text-slate-600 mb-4" />
          <p className="text-slate-400 font-medium">All clear</p>
          <p className="text-slate-600 text-sm mt-1">No packing sessions awaiting verification</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Queue list */}
          <div className="space-y-2">
            {sessions.map((session) => (
              <QueueCard
                key={session._id}
                session={session}
                isSelected={selectedId === session._id}
                onClick={() => setSelectedId(session._id)}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:sticky lg:top-6">
            {selectedId ? (
              <div className="bg-navy-850 border border-navy-700/60 rounded-2xl p-4">
                <SessionDetailPanel
                  sessionId={selectedId}
                  onVerified={() => {
                    setSelectedId(null);
                    refetch();
                  }}
                />
              </div>
            ) : (
              <div className="hidden lg:flex flex-col items-center justify-center h-64 bg-navy-800 border border-navy-700/40 rounded-2xl text-center">
                <Package size={32} className="text-slate-600 mb-3" />
                <p className="text-slate-500 text-sm">Select a session to review</p>
              </div>
            )}
          </div>
        </div>
      )}
      <Pagination meta={data?.meta} page={paging.page} onPageChange={(page) => { paging.setPage(page); setSelectedId(null); }} isFetching={isFetching} label="packing sessions" />
    </div>
  );
}
