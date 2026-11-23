import { useEffect, useState } from 'react';
import { useAddUdharCreditMutation, useGetCustomerBillsQuery, usePreviewUdharPaymentQuery } from '../../features/udhar/udharApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useIdempotentSubmission } from '../../hooks/useIdempotentSubmission';
import { useRetryCountdown } from '../../hooks/useRetryCountdown';
import { useCursorPages } from '../../hooks/useCursorPages';
import { accountingDate, PAYMENT_METHOD_LABELS, resolveStoreTimeZone } from '../../utils/accounting';
import { formatCurrency } from '../../utils/formatters';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import toast from 'react-hot-toast';

export default function ReceivePaymentModal({ customer, bill, onClose, onSaved }) {
  const { user, store } = useAuth();
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const [form, setForm] = useState({ amount: '', method: 'cash', description: '', date: accountingDate(undefined, resolveStoreTimeZone(store?.settings?.timezone)), orderId: bill?._id || '' });
  const [failure, setFailure] = useState('');
  const paging = useCursorPages(customer._id);
  const [selectedBill, setSelectedBill] = useState(bill || null);
  const [record, { isLoading }] = useAddUdharCreditMutation();
  const { submit, retryPending, retryAt, pendingPayload } = useIdempotentSubmission(record, `${store?._id}:${user?._id}:payment:${customer._id}`, { persist: true });
  useEffect(() => {
    if (pendingPayload) setForm((previous) => ({ ...previous, ...pendingPayload, date: accountingDate(pendingPayload.date, timeZone), amount: String(pendingPayload.amount), orderId: pendingPayload.orderId || '' }));
  }, [pendingPayload, timeZone]);
  const retrySeconds = useRetryCountdown(retryAt);
  const locked = isLoading || retryPending;
  const amount = useDebouncedValue(form.amount);
  const validAmount = Number(amount) > 0 && Number.isFinite(Number(amount));
  const bills = useGetCustomerBillsQuery({ id: customer._id, hasDue: true, limit: 5, cursor: paging.cursor }, { skip: Boolean(bill) });
  const preview = usePreviewUdharPaymentQuery({ id: customer._id, amount, ...(form.orderId && { orderId: form.orderId }) }, { skip: !validAmount || retryPending });
  const options = bills.currentData?.data?.data || [];
  const meta = bills.currentData?.data?.meta || {};
  const save = async () => {
    if (isLoading || retrySeconds > 0) return;
    setFailure('');
    if (!retryPending && (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0)) { setFailure('Enter a valid payment amount.'); return; }
    if (!retryPending && (amount !== form.amount || preview.isFetching || preview.error || !preview.currentData)) {
      setFailure(preview.error?.data?.message || 'Wait for the bill allocation preview before saving.'); return;
    }
    try {
      const result = await submit({ id: customer._id, amount: Number(form.amount), method: form.method,
        date: form.date === accountingDate(undefined, timeZone) ? new Date().toISOString() : form.date,
        description: form.description, ...(form.orderId && { orderId: form.orderId }) });
      if (result) { toast.success('Payment recorded'); onSaved?.(result); onClose(); }
    } catch (error) { setFailure(error?.data?.message || 'Could not confirm the payment. Retry to retrieve the same receipt.'); }
  };
  return <Modal isOpen onClose={onClose} title="Record Payment" size="md">
    <p className="text-sm text-slate-500 mb-4">{customer.name} · Due {formatCurrency(customer.balance)}</p>
    <fieldset disabled={locked} className="space-y-4">
      {bill ? <p className="text-sm font-semibold">For bill {bill.orderNumber} · Pending {formatCurrency(bill.paymentSummary?.pending ?? bill.settlement?.pending)}</p> : <div className="space-y-2">
        <label className="label" htmlFor="payment-bill">Apply payment to</label>
        <select id="payment-bill" className="input" value={form.orderId} onChange={(event) => {
          setForm((old) => ({ ...old, orderId: event.target.value })); setSelectedBill(options.find((row) => row._id === event.target.value) || null);
        }}><option value="">Oldest pending bills automatically</option>
          {selectedBill && !options.some((row) => row._id === selectedBill._id) && <option value={selectedBill._id}>{selectedBill.orderNumber}</option>}
          {options.map((row) => <option key={row._id} value={row._id}>{row.orderNumber} · Pending {formatCurrency(row.paymentSummary.pending)}</option>)}
        </select>
        {bills.error && <p role="alert" className="text-xs text-red-400">Could not load bills. <button type="button" onClick={bills.refetch}>Try again</button></p>}
        {(paging.hasPrevious || meta.hasNextPage) && <div className="flex justify-between"><button className="workspace-link" disabled={!paging.hasPrevious || bills.isFetching} onClick={paging.previous}>Previous bills</button><button className="workspace-link" disabled={!meta.hasNextPage || bills.isFetching} onClick={() => paging.next(meta.nextCursor)}>More bills</button></div>}
      </div>}
      <div><label className="label" htmlFor="receive-amount">Amount (₹) *</label><input id="receive-amount" className="input" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((old) => ({ ...old, amount: event.target.value }))} /></div>
      <div><label className="label" htmlFor="receive-method">Payment Method</label><select id="receive-method" className="input" value={form.method} onChange={(event) => setForm((old) => ({ ...old, method: event.target.value }))}>{Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label className="label" htmlFor="receive-date">Payment date</label><input id="receive-date" className="input" type="date" value={form.date} onChange={(event) => setForm((old) => ({ ...old, date: event.target.value }))} /></div>
      <div><label className="label" htmlFor="receive-note">Note</label><input id="receive-note" className="input" maxLength={300} value={form.description} onChange={(event) => setForm((old) => ({ ...old, description: event.target.value }))} /></div>
    </fieldset>
    {validAmount && <section aria-label="Payment allocation preview" className="rounded-xl bg-navy-750 p-3 mt-4 text-sm space-y-2"><h3 className="font-semibold">How this payment will be applied</h3>
      {preview.isFetching || amount !== form.amount ? <p role="status">Checking pending bills…</p> : preview.error ? <p role="alert" className="text-red-400">{preview.error.data?.message || 'Could not prepare the allocation.'}</p> : preview.currentData?.data?.allocations?.map((row, i) => <p key={i} className="flex justify-between gap-3"><span>{row.orderNumber || 'Opening / manual balance'}</span><strong>{formatCurrency(row.amount)}</strong></p>)}
    </section>}
    {failure && <p role="alert" className="workspace-feedback mt-3 text-sm">{failure}</p>}
    {retryPending && <p role="status" className="text-xs text-amber-400 mt-3">Payment details are saved for retry. Retry retrieves or completes this receipt without recording it twice.</p>}
    <div className="flex gap-3 mt-5"><Button variant="secondary" onClick={onClose}>Close</Button><Button className="flex-1" disabled={isLoading || retrySeconds > 0 || (!retryPending && (!validAmount || amount !== form.amount || preview.isFetching || Boolean(preview.error) || !preview.currentData))} onClick={save}>{isLoading ? 'Saving…' : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : retryPending ? 'Retry original payment' : 'Record Payment'}</Button></div>
  </Modal>;
}
