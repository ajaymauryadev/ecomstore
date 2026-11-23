import { actorLabel } from '../../utils/orderResponsibility';

const timeLabel = (at) => at ? new Date(at).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '';

function Assignment({ label, assignee, assignedBy, completed, started, closed }) {
  return <div className="space-y-1">
    <p className="text-xs text-slate-300"><span className="text-slate-500">{label}: </span>{assignee?.name ? actorLabel(assignee) : 'Unassigned'}</p>
    {assignedBy?.name && <p className="text-[11px] text-slate-500">Assigned by {actorLabel(assignedBy)} · {timeLabel(assignedBy.at)}</p>}
    {completed?.name ? <p className="text-xs text-emerald-400">Completed by {actorLabel(completed)} · {timeLabel(completed.at)}</p>
      : started?.name ? <p className="text-xs text-amber-400">Started by {actorLabel(started)} · {timeLabel(started.at)}{closed ? ' · Closed without recorded completion' : ' · Completion pending'}</p>
        : <p className="text-[11px] text-slate-500">{closed ? 'Completion not recorded' : 'Start not recorded'}</p>}
  </div>;
}

export default function OrderResponsibility({ order, compact = false }) {
  const f = order.fulfillment || {};
  const packing = f.packingAssignedTo?.name ? f.packingAssignedTo : order.assignedTo;
  const delivery = f.deliveryAssignedTo?.name ? f.deliveryAssignedTo : order.deliveryAssignedTo;
  const hasDelivery = ['home_delivery', 'online'].includes(order.orderType);
  const counterHandover = order.orderType === 'counter' && order.saleType === 'instant' && f.deliveredBy?.name;
  if (compact) return <div className="mt-2 space-y-1 text-xs text-slate-400">
    {counterHandover ? <p>Handed over by {actorLabel(f.deliveredBy)}</p> : <p>Packing: {packing?.name ? actorLabel(packing) : 'Unassigned'}{f.packingCompletedBy?.name ? ` · Packed by ${actorLabel(f.packingCompletedBy)}` : f.packingStartedBy?.name ? ` · Started by ${actorLabel(f.packingStartedBy)}` : ''}</p>}
    {hasDelivery && <p>Delivery: {delivery?.name ? actorLabel(delivery) : 'Unassigned'}{f.deliveredBy?.name ? ` · Delivered by ${actorLabel(f.deliveredBy)}` : f.deliveryStartedBy?.name ? ` · Started by ${actorLabel(f.deliveryStartedBy)}` : ''}</p>}
  </div>;
  const closed = ['delivered', 'cancelled', 'rejected'].includes(order.status);
  return <section aria-label="Order responsibility" className="bg-navy-800 rounded-xl p-3 space-y-3">
    <h3 className="text-xs font-semibold text-slate-200">Who is responsible</h3>
    {!counterHandover && <Assignment label="Packing assigned to" assignee={packing} assignedBy={f.packingAssignedBy} completed={f.packingCompletedBy} started={f.packingStartedBy} closed={closed} />}
    {f.packingVerifiedBy?.name && <p className="text-xs text-slate-400">Verified by {actorLabel(f.packingVerifiedBy)} · {timeLabel(f.packingVerifiedBy.at)}</p>}
    {f.dispatchedBy?.name && <p className="text-xs text-slate-400">Released by {actorLabel(f.dispatchedBy)} · {timeLabel(f.dispatchedBy.at)}</p>}
    {hasDelivery ? <Assignment label="Delivery assigned to" assignee={delivery} assignedBy={f.deliveryAssignedBy} completed={f.deliveredBy} started={f.deliveryStartedBy} closed={closed} />
      : f.deliveredBy?.name && <p className="text-xs text-emerald-400">Handed over by {actorLabel(f.deliveredBy)} · {timeLabel(f.deliveredBy.at)}</p>}
  </section>;
}
