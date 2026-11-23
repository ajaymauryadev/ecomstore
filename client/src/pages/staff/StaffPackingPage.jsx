import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, AlertTriangle, CheckCircle2, XCircle, ChevronDown,
  ChevronUp, Send, RefreshCw, ShieldAlert,
} from 'lucide-react';
import {
  useGetPackingSessionQuery,
  useUpdateItemStatusMutation,
  useCompletePackingSessionMutation,
} from '../../features/packing/packingApi';
import { ROUTES } from '../../constants/routes';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';
import Modal from '../../components/ui/Modal';
import { useAuth } from '../../hooks/useAuth';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';

const STATUS_COLORS = {
  pending: 'border-navy-600 bg-navy-800',
  picked: 'border-blue-500/40 bg-blue-500/5',
  packed: 'border-emerald-500/40 bg-emerald-500/5',
  missing: 'border-red-500/40 bg-red-500/5',
};

const STATUS_BADGE = {
  pending: 'text-slate-500 bg-navy-700',
  picked: 'text-blue-400 bg-blue-500/15',
  packed: 'text-emerald-400 bg-emerald-500/15',
  missing: 'text-red-400 bg-red-500/15',
};

function MissingReasonModal({ item, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <Modal isOpen onClose={onClose} title="Mark as Missing" size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
            <XCircle size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500">{item.name}{item.variantName ? ` · ${item.variantName}` : ''}</p>
          </div>
        </div>
        {item.isHighValue && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
            <ShieldAlert size={15} className="text-amber-400 shrink-0" />
            <p className="text-xs text-amber-300 font-medium">High-value item — admin will be notified immediately</p>
          </div>
        )}
        <div>
          <label htmlFor="missing-item-reason" className="text-xs text-slate-400 mb-1.5 block">Reason (required)</label>
          <textarea
            id="missing-item-reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Out of stock, damaged, not found..."
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
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="flex-1 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 font-semibold text-sm disabled:opacity-40"
          >
            Confirm Missing
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PackingItem({ item, onAction, loading }) {
  const [expanded, setExpanded] = useState(false);
  const [showMissingModal, setShowMissingModal] = useState(false);

  const handleMissingConfirm = (reason) => {
    setShowMissingModal(false);
    onAction(item._id, 'missing', reason);
  };

  return (
    <>
      <div className={cn('rounded-2xl border transition-all', STATUS_COLORS[item.status])}>
        {/* Item header */}
        <div className="flex items-start gap-3 p-4">
          {item.image ? (
            <img src={item.image} alt={item.name} className="w-14 h-14 rounded-xl object-cover shrink-0 bg-navy-700" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-navy-700 flex items-center justify-center shrink-0">
              <Package size={22} className="text-slate-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-100 leading-snug">{item.name}</p>
                {item.variantName && (
                  <p className="text-xs text-slate-500 mt-0.5">{item.variantName}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {item.isHighValue && (
                  <AlertTriangle size={13} className="text-amber-400" />
                )}
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', STATUS_BADGE[item.status])}>
                  {item.status}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <p className="text-xs text-slate-400">
                Qty: <span className="font-bold text-slate-200">{item.requiredQty}</span>
                {item.unit && <span className="text-slate-500"> {item.unit}</span>}
              </p>
              {item.pickedQty > 0 && item.pickedQty !== item.requiredQty && (
                <p className="text-xs text-blue-400">Picked: {item.pickedQty}</p>
              )}
            </div>
          </div>
        </div>

        {/* Missing reason */}
        {item.status === 'missing' && item.missingReason && (
          <div className="px-4 pb-3">
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              Reason: {item.missingReason}
            </p>
          </div>
        )}

        {/* Action buttons — only for pending/picked */}
        {(item.status === 'pending' || item.status === 'picked') && (
          <div className="px-4 pb-4 flex gap-2">
            {item.status === 'pending' && (
              <button
                disabled={loading}
                onClick={() => onAction(item._id, 'pick')}
                className="flex-1 py-3 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 font-semibold text-sm active:scale-[0.97] transition-all disabled:opacity-50"
              >
                Pick
              </button>
            )}
            {item.status === 'picked' && (
              <button
                disabled={loading}
                onClick={() => onAction(item._id, 'pack')}
                className="flex-1 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-semibold text-sm active:scale-[0.97] transition-all disabled:opacity-50"
              >
                Packed ✓
              </button>
            )}
            <button
              disabled={loading}
              onClick={() => setShowMissingModal(true)}
              className="py-3 px-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 font-semibold text-sm active:scale-[0.97] transition-all disabled:opacity-50"
            >
              Missing
            </button>
          </div>
        )}

        {/* Packed — collapse to show detail */}
        {item.status === 'packed' && (
          <div className="px-4 pb-3 flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-400" />
            <p className="text-xs text-emerald-400 font-medium flex-1">Packed</p>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-500 text-xs flex items-center gap-1"
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        )}
      </div>

      {showMissingModal && (
        <MissingReasonModal item={item} onConfirm={handleMissingConfirm} onClose={() => setShowMissingModal(false)} />
      )}
    </>
  );
}

export default function StaffPackingPage({ packingPath = ROUTES.STAFF.PACKING }) {
  const { user } = useAuth();
  const canPerform = hasPermission(user, PERMISSIONS.PACKING_PERFORM);
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useGetPackingSessionQuery({ orderId }, {
    pollingInterval: 30000, skipPollingIfUnfocused: true, refetchOnReconnect: true,
  });
  const [updateItem, { isLoading: updating }] = useUpdateItemStatusMutation();
  const [completeSession, { isLoading: completing }] = useCompletePackingSessionMutation();
  const [staffNotes, setStaffNotes] = useState('');
  const [showComplete, setShowComplete] = useState(false);

  const session = data?.data?.session;
  const order = data?.data?.order;

  const handleAction = async (itemId, action, reason) => {
    try {
      await updateItem({ orderId, itemId, action, missingReason: reason }).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update item');
    }
  };

  const handleComplete = async () => {
    const remaining = session?.items?.filter((i) => !['packed', 'missing'].includes(i.status)).length ?? 0;
    if (remaining > 0) {
      toast.error(`${remaining} item${remaining > 1 ? 's' : ''} still pending — mark as packed or missing first`);
      return;
    }
    try {
      await completeSession({ orderId, staffNotes }).unwrap();
      toast.success('Packing complete! Awaiting admin verification.');
      navigate(packingPath);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to complete session');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-navy-800 rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400">Session not found</p>
        <button onClick={() => navigate(packingPath)} className="mt-4 text-gold-400 text-sm">
          ← Back to orders
        </button>
      </div>
    );
  }

  const items = session.items ?? [];
  const pendingCount = items.filter((i) => !['packed', 'missing'].includes(i.status)).length;
  const packedCount = items.filter((i) => i.status === 'packed').length;
  const missingCount = items.filter((i) => i.status === 'missing').length;
  const highValueMissing = items.filter((i) => i.isHighValue && i.status === 'missing').length;
  const isCompleted = session.status === 'completed' || session.status === 'verified';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(packingPath)}
          className="p-2 rounded-xl hover:bg-navy-700 text-slate-400"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gold-400 mb-1">Packing workspace</p><h1 className="text-lg font-bold text-slate-100">Pack order</h1><p className="mt-1 text-sm font-mono text-slate-400 break-all">{order?.orderNumber || session.orderNumber}</p>
          <p className="text-xs text-slate-500">{items.length} items total</p>
        </div>
        <button onClick={refetch} className="p-2 rounded-xl hover:bg-navy-700 text-slate-400">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Progress summary */}
      <div className="bg-navy-800 border border-navy-700/60 rounded-2xl p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-emerald-400">{packedCount}</p>
            <p className="text-xs text-slate-500 uppercase tracking-wide mt-0.5">Packed</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-400">{pendingCount}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Pending</p>
          </div>
          <div>
            <p className={cn('text-2xl font-bold', missingCount > 0 ? 'text-red-400' : 'text-slate-600')}>
              {missingCount}
            </p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Missing</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-2 bg-navy-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${items.length ? Math.round(((packedCount + missingCount) / items.length) * 100) : 0}%`,
              background: missingCount > 0 ? 'linear-gradient(90deg, #10b981, #f59e0b)' : '#10b981',
            }}
          />
        </div>

        {highValueMissing > 0 && (
          <div className="flex items-center gap-2 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            <ShieldAlert size={14} className="text-amber-400" />
            <p className="text-xs text-amber-300 font-medium">
              {highValueMissing} high-value item{highValueMissing > 1 ? 's' : ''} missing — admin notified
            </p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="space-y-3">
        {/* Pending first, then picked, then packed, then missing */}
        {[
          ...items.filter((i) => i.status === 'pending'),
          ...items.filter((i) => i.status === 'picked'),
          ...items.filter((i) => i.status === 'packed'),
          ...items.filter((i) => i.status === 'missing'),
        ].map((item) => (
          <PackingItem key={item._id} item={item} onAction={handleAction} loading={updating || isCompleted || !canPerform} />
        ))}
      </div>

      {/* Complete section */}
      {canPerform && !isCompleted && pendingCount === 0 && (
        <div className="packing-actions">
          {showComplete ? (
            <Modal isOpen onClose={() => !completing && setShowComplete(false)} title="Submit packing for verification" size="lg"><div className="space-y-4">
              <p className="text-sm font-semibold text-slate-200">Ready to submit for verification?</p>
              {missingCount > 0 && (
                <p className="text-xs text-amber-400">{missingCount} item{missingCount > 1 ? 's' : ''} marked as missing</p>
              )}
              <textarea
                value={staffNotes}
                onChange={(e) => setStaffNotes(e.target.value)}
                placeholder="Optional notes for admin..."
                rows={2}
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60 resize-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowComplete(false)}
                  className="flex-1 py-3 rounded-xl border border-navy-600 text-slate-400 font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  disabled={completing}
                  onClick={handleComplete}
                  className="flex-1 py-3 rounded-xl bg-gold-500 text-navy-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {completing ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                  Submit for verification
                </button>
              </div>
            </div></Modal>
          ) : (
            <button
              onClick={() => setShowComplete(true)}
              className="w-full py-4 rounded-2xl bg-gold-500 text-navy-950 font-bold text-base shadow-xl active:scale-[0.98] transition-transform"
            >
              Complete Packing
            </button>
          )}
        </div>
      )}

      {isCompleted && (
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-4">
          <CheckCircle2 size={20} className="text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-emerald-400">Packing Complete</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {session.status === 'verified' ? 'Verified by admin' : 'Awaiting admin verification'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
