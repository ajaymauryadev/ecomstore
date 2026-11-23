import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetCustomerBillsQuery } from '../../features/udhar/udharApi';
import { useCursorPages } from '../../hooks/useCursorPages';
import { formatCurrency } from '../../utils/formatters';
import BillPaymentHistory from './BillPaymentHistory';
import Button from '../ui/Button';
import LoadError from '../ui/LoadError';
import { SETTLEMENT_LABELS } from '../../utils/settlement';

export function BillSettlementSummary({ summary, total, timeZone }) {
  return <div className="space-y-2">
    <p className={`text-sm font-semibold ${summary.pending > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{SETTLEMENT_LABELS[summary.state] || 'Pending'}{summary.clearedAt && ' · Cleared ' + new Date(summary.clearedAt).toLocaleDateString('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric' })}</p>
    <div className="ledger-bill-summary">
      <div><span>Bill total</span><strong>{formatCurrency(total)}</strong></div>
      <div><span>Total received</span><strong className="text-emerald-400">{formatCurrency(summary.totalPaid)}</strong></div>
      <div><span>Original Udhar</span><strong>{formatCurrency(summary.originalUdhar)}</strong></div>
      <div><span>Pending on this bill</span><strong className={summary.pending > 0 ? 'text-red-400' : 'text-emerald-400'}>{formatCurrency(summary.pending)}</strong></div>
    </div>
  </div>;
}

function CustomerBill({ order, timeZone, onReceive }) {
  const [open, setOpen] = useState(false);
  return <article className="ledger-entry space-y-3">
    <div className="flex justify-between flex-wrap gap-2 items-center"><div><h3 className="text-sm font-semibold break-all">{order.orderNumber}</h3><p className="text-xs text-slate-500 mt-1">Purchased {new Date(order.createdAt).toLocaleString('en-IN', { timeZone })}</p></div><Link className="workspace-link text-xs" to={'/store/orders?orderId=' + order._id}>Open order</Link></div>
    <BillSettlementSummary summary={order.paymentSummary} total={order.pricing.grandTotal} timeZone={timeZone} />
    {onReceive && order.paymentSummary.pending > 0 && !['cancelled', 'rejected'].includes(order.status) && <Button size="sm" variant="secondary" onClick={() => onReceive(order)}>Receive for this bill</Button>}
    <details className="rounded-xl border border-navy-700 bg-navy-750" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer px-3 py-3 text-sm font-medium">Purchase details · {order.orderNumber}</summary>
      <div className="p-3 space-y-3"><ul className="space-y-2">{order.items?.map((item, i) => <li key={i} className="flex justify-between gap-3 text-sm"><div><p>{item.name}</p><p className="text-xs text-slate-500">{item.variantName} · {item.quantity} × {formatCurrency(item.price)}</p></div><strong>{formatCurrency(item.total)}</strong></li>)}</ul>{open && <BillPaymentHistory orderId={order._id} customerId={order.udharCustomerId} />}</div>
    </details>
  </article>;
}

export default function CustomerBillsPanel({ customerId, timeZone, onReceive }) {
  const paging = useCursorPages(customerId);
  const { currentData, isFetching, error, refetch } = useGetCustomerBillsQuery({ id: customerId, cursor: paging.cursor, limit: 5 });
  const rows = currentData?.data?.data || [];
  const meta = currentData?.data?.meta || {};
  return <section aria-label="Customer bills" className="space-y-3">
    {error ? <LoadError title="Could not load customer bills" error={error} retry={refetch} /> : <>
      {isFetching && <p role="status" className="text-sm text-slate-500">Loading bills…</p>}
      {!isFetching && !rows.length && <p className="text-sm text-slate-500">No linked bills yet. Older manual balances appear in Account history.</p>}
      {rows.map((order) => <CustomerBill key={order._id} order={order} timeZone={timeZone} onReceive={onReceive} />)}
      {(paging.hasPrevious || meta.hasNextPage) && <div className="flex justify-between items-center gap-2"><Button size="sm" variant="secondary" onClick={paging.previous} disabled={!paging.hasPrevious || isFetching}>Previous bills</Button><span className="text-xs">Page {paging.page}</span><Button size="sm" variant="secondary" onClick={() => paging.next(meta.nextCursor)} disabled={!meta.hasNextPage || isFetching}>Next bills</Button></div>}
    </>}
  </section>;
}
