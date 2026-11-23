import { useGetAdminOrderPaymentsQuery } from '../../features/orders/orderApi';
import { useCursorPages } from '../../hooks/useCursorPages';
import { useAuth } from '../../hooks/useAuth';
import { PAYMENT_METHOD_LABELS, resolveStoreTimeZone } from '../../utils/accounting';
import { formatCurrency } from '../../utils/formatters';
import LoadError from '../ui/LoadError';
import Button from '../ui/Button';
import { useState } from 'react';
import { useReverseUdharPaymentMutation } from '../../features/udhar/udharApi';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import Modal from '../ui/Modal';
import toast from 'react-hot-toast';

export default function BillPaymentHistory({ orderId, customerId, fallbackPayments = [] }) {
  const { store, user } = useAuth();
  const [correcting, setCorrecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reverse, { isLoading: reversing }] = useReverseUdharPaymentMutation();
  const paging = useCursorPages(orderId);
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const { currentData, isFetching, error, refetch } = useGetAdminOrderPaymentsQuery({
    slug: store?.slug, orderId, cursor: paging.cursor, limit: 5,
  }, { skip: !store?.slug || !orderId });
  const rows = currentData?.data?.data || (!store?.slug ? fallbackPayments : []);
  const meta = currentData?.data?.meta || {};
  return <section className="ledger-payment-history space-y-3" aria-label="Bill payment history">
    <h3 className="text-sm font-semibold">Payment history <span className="font-normal text-slate-500">· Latest 5</span></h3>
    {error ? <LoadError title="Could not load bill payments" error={error} retry={refetch} /> : <>
      {isFetching && <p role="status" className="text-xs text-slate-500">Loading payments…</p>}
      {!isFetching && !rows.length && <p className="text-xs text-slate-500">No payment received for this bill yet.</p>}
      {rows.map((payment, index) => <div key={payment.receiptKey || index} className="flex justify-between gap-3 text-sm py-2 border-t border-navy-700">
        <div className="min-w-0"><p>{payment.adjustment ? 'Bill adjustment' : (PAYMENT_METHOD_LABELS[payment.method] || payment.method || 'Method not recorded') + ' · ' + (payment.legacy ? 'Original receipt' : payment.atCheckout ? 'At purchase' : 'Account repayment')}</p>
          <p className="text-xs text-slate-500">{new Date(payment.paidAt).toLocaleString('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{payment.recordedByName && ' · ' + payment.recordedByName}</p>
          {payment.receiptAmount > payment.amount && <p className="text-xs text-slate-500">This bill’s portion of receipt {formatCurrency(payment.receiptAmount)}</p>}
          {payment.reconstructed && <p className="text-xs text-slate-500">Older payment · allocated oldest first</p>}
          {payment.voidedAt && <p className="text-xs text-red-400">Corrected: {payment.voidReason}</p>}
          {customerId && payment.entryId && !payment.atCheckout && !payment.adjustment && !payment.voidedAt && hasPermission(user, PERMISSIONS.ACCOUNTING_MANAGE) && <button type="button" className="workspace-link text-xs" onClick={() => { setCorrecting(payment); setReason(''); }}>Correct payment</button>}
        </div><strong className={payment.voidedAt ? 'line-through text-slate-500' : 'text-emerald-400 tabular-nums'}>{formatCurrency(payment.amount)}</strong>
      </div>)}
      {(paging.hasPrevious || meta.hasNextPage) && <div className="flex justify-between items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!paging.hasPrevious || isFetching} onClick={paging.previous}>Previous payments</Button>
        <span className="text-xs text-slate-500">Page {paging.page}</span>
        <Button size="sm" variant="secondary" disabled={!meta.hasNextPage || isFetching} onClick={() => paging.next(meta.nextCursor)}>Next payments</Button>
      </div>}
    </>}
    {correcting && <Modal isOpen title="Correct payment" size="sm" onClose={() => setCorrecting(null)}>
      <p className="text-sm mb-3">This reverses the entire receipt of {formatCurrency(correcting.receiptAmount || correcting.amount)} and reopens every bill portion it paid. Use this for an incorrectly recorded payment.</p>
      <label htmlFor="payment-correction-reason" className="label">Reason</label><input id="payment-correction-reason" className="input" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
      <Button className="mt-4" disabled={reason.trim().length < 3 || reversing} onClick={async () => {
        try { await reverse({ id: customerId, entryId: correcting.entryId, reason: reason.trim() }).unwrap(); toast.success('Payment corrected'); setCorrecting(null); }
        catch (error) { toast.error(error?.data?.message || 'Could not correct the payment.'); }
      }}>{reversing ? 'Saving…' : 'Reverse incorrect receipt'}</Button>
    </Modal>}
  </section>;
}
