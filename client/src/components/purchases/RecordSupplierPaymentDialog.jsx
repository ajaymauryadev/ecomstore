import { useState } from 'react';
import toast from 'react-hot-toast';
import { useIdempotentSubmission } from '../../hooks/useIdempotentSubmission';
import { formatCurrency } from '../../utils/formatters';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';

export default function RecordSupplierPaymentDialog({
  target, accountPayment = false, defaultFullAmount = false, recordPayment, isSaving, onClose,
}) {
  const [form, setForm] = useState({
    amount: defaultFullAmount ? String(target.pendingAmount) : '', method: 'cash', note: '',
  });
  const { submit, retryPending } = useIdempotentSubmission(recordPayment, `${accountPayment ? 'supplier-account' : 'supplier-invoice'}:${target._id}`, { persist: true });

  const close = () => {
    if (isSaving) return;
    if (retryPending) {
      toast.error('Retry the original payment to confirm its result before closing.');
      return;
    }
    onClose();
  };

  const handlePayment = async (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!retryPending && (!Number.isFinite(amount) || amount < 0.01)) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    try {
      const response = await submit({ id: target._id, ...form, amount });
      if (!response) return;
      toast.success('Payment recorded.');
      onClose();
    } catch (error) {
      toast.error(error?.data?.message || 'Could not record payment.');
    }
  };

  return (
    <Modal isOpen onClose={close} title="Record Payment" size="sm">
      <form onSubmit={handlePayment} className="space-y-4" noValidate>
        <div className="rounded-xl bg-navy-900 p-3">
          <p className="text-sm font-semibold text-slate-100">{accountPayment ? target.name : target.invoiceNumber || 'Purchase invoice'}</p>
          <p className="text-xs text-slate-400">Pending {formatCurrency(target.pendingAmount)}</p>
        </div>
        {accountPayment && (
          <p className="text-sm text-slate-400">Payments go to the oldest open invoice first by purchase date, then to the next invoice.</p>
        )}
        <fieldset disabled={isSaving || retryPending} className="space-y-3">
          <Input label="Amount (₹)" type="number" min="0.01" step="0.01" value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })} required />
          <label className="block text-sm text-slate-300">
            Payment Method
            <select className="input mt-1 w-full" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
            </select>
          </label>
          <Input label="Note (optional)" value={form.note} maxLength={300}
            onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </fieldset>
        {retryPending && (
          <p role="status" className="text-sm text-amber-300">Could not confirm the payment. Retry to retrieve or complete the original payment.</p>
        )}
        <div className="flex gap-3">
          {!retryPending && <Button type="button" variant="secondary" fullWidth disabled={isSaving} onClick={close}>Cancel</Button>}
          <Button type="submit" fullWidth isLoading={isSaving}>{retryPending ? 'Retry original payment' : 'Record Payment'}</Button>
        </div>
      </form>
    </Modal>
  );
}
