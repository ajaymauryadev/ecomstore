import { useSavedViewState } from '../../../offline/useSavedViewState';
import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, Save, ChevronLeft, ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  useGetDailySummaryQuery,
  useGetDailyTransactionsQuery,
  useSaveDailyClosingMutation,
  useFinalizeDailyClosingMutation,
  useCorrectDailyClosingMutation,
  useGetDailyClosingsQuery,
} from '../../../features/dailyClosing/dailyClosingApi';
import toast from 'react-hot-toast';
import { cn } from '../../../utils/cn';
import { accountingDate, resolveStoreTimeZone, PAYMENT_METHOD_LABELS } from '../../../utils/accounting';
import { ROUTES } from '../../../constants/routes';
import { useAuth } from '../../../hooks/useAuth';
import Modal from '../../../components/ui/Modal';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';

const MOVEMENT_CHANNELS = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank'],
  ['other', 'Other non-cash'], ['unclassified', 'Method unrecorded'],
];

const toPaise = (value) => Math.round((Number(value) || 0) * 100);
const hasCashAmount = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
const shiftDate = (date, offset) => {
  const day = new Date(date + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};

function fmt(n) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const formValues = (closing) => ({
  openingCash: String(closing?.openingCash ?? ''),
  closingCash: String(closing?.closingCash ?? ''),
  notes: closing?.notes ?? '',
});
const cashPayload = (form) => ({
  openingCash: form.openingCash === '' ? null : Number(form.openingCash),
  closingCash: form.closingCash === '' ? null : Number(form.closingCash),
  notes: form.notes,
});

const received = [['sales', 'Sales payments'], ['udharCollections', 'Udhar collections'], ['otherReceived', 'Other receipts and transfers']];
const paid = [['supplierPayments', 'Supplier payments'], ['expenses', 'Shop expenses'], ['salaries', 'Salary paid'], ['refunds', 'Customer refunds'], ['otherPaid', 'Other payments and transfers']];
const manualTypes = {
  in: [['owner_addition', 'Owner added cash'], ['external_sale', 'Sale outside the app'], ['external_upi', 'External UPI receipt'], ['bank_withdrawal', 'Bank withdrawal into drawer'], ['other_receipt', 'Other receipt']],
  out: [['owner_withdrawal', 'Owner took cash out'], ['bank_deposit', 'Cash deposited in bank'], ['other_payment', 'Other payment']],
};
const labels = Object.fromEntries([...received, ...paid, ...manualTypes.in, ...manualTypes.out, ['creditSales', 'Udhar sale']]);

function TransactionDetails({ date, detail, timeZone, closed }) {
  const [page, setPage] = useState(1);
  const { user } = useAuth();
  const { data, isLoading, isFetching, isError, refetch } = useGetDailyTransactionsQuery({
    date, kind: detail.kind, channel: detail.channel, page,
  });
  const sources = {
    sales: ROUTES.STORE.SALES, creditSales: ROUTES.STORE.ORDERS, udharCollections: ROUTES.STORE.UDHAR,
    supplierPayments: ROUTES.STORE.SUPPLIER_PAYMENTS, expenses: ROUTES.STORE.EXPENSES,
    salaries: ROUTES.STORE.SALARY, refunds: ROUTES.STORE.RETURNS,
  };
  const sourceLink = (row) => {
    if (row.type === 'salaries' && !hasPermission(user, PERMISSIONS.SALARY_VIEW)) return undefined;
    if (row.type === 'expenses') return `${sources.expenses}?date=${date}&expense=${row.id}`;
    if (row.type === 'supplierPayments' && row.id) return ROUTES.STORE.PURCHASE_DETAIL(row.id);
    if (row.type === 'supplierPayments' && row.supplierId) return `${sources.supplierPayments}?supplierId=${row.supplierId}`;
    if (['sales', 'creditSales', 'refunds'].includes(row.type) && row.id) return `${ROUTES.STORE.ORDERS}?orderId=${row.id}`;
    if (row.type === 'udharCollections' && row.id) return `${sources.udharCollections}?customerId=${row.id}`;
    if (row.type === 'salaries' && row.id && row.month) return `${sources.salaries}?month=${row.month}&staffId=${row.id}`;
    return sources[row.type];
  };
  return <div className="space-y-3">
    {closed && <p className="text-sm text-slate-500">These are current source records. Later changes may differ from the finalized totals.</p>}
    {isLoading && <p role="status">Loading transactions…</p>}
    {isError && <button className="btn-secondary" onClick={refetch}>Retry download</button>}
    {data?.data?.length === 0 && <p>No recorded transactions in this group.</p>}
    <ul className="divide-y divide-navy-700">
      {data?.data?.map((row, index) => <li key={`${row.reference}-${index}`} className="py-3">
        <div className="flex justify-between gap-3"><strong>{labels[row.name] ?? row.name ?? labels[row.type]}</strong><strong>{fmt(row.amount)}</strong></div>
        <p className="text-sm text-slate-500">{[row.party, PAYMENT_METHOD_LABELS[row.method] ?? row.method ?? 'Method unrecorded',
          row.date && new Date(row.date).toLocaleString('en-IN', { timeZone })].filter(Boolean).join(' · ')}</p>
        {row.description && <p className="text-sm">{row.description}</p>}
        {row.actor && <p className="text-sm text-slate-500">Recorded by {row.actor}</p>}
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          {row.reference && <span className="break-all text-slate-500">Ref {row.reference}</span>}
          {sourceLink(row) && <Link className="underline" to={sourceLink(row)}>Open source</Link>}
        </div>
      </li>)}
    </ul>
    <Pagination meta={data?.meta} page={page} onPageChange={setPage} isFetching={isFetching} label="transactions" />
  </div>;
}

function AmountButton({ label, value, onClick }) {
  return <button type="button" onClick={onClick} className="card p-3 text-left hover:border-blue-400">
    <span className="block text-sm text-slate-500">{label}</span><strong className="text-lg">{fmt(value)}</strong>
  </button>;
}

function HistoryRow({ record, onClick }) {
  const correction = record.corrections?.at(-1);
  const snapshot = correction?.revised ?? record;
  const diff = snapshot.cashDifference ?? 0;
  const date = new Date(record.businessDate ? record.businessDate + 'T00:00:00Z' : record.date);
  return (
    <button
      onClick={() => onClick(record)}
      disabled={!record.businessDate}
      className="w-full flex items-center gap-3 bg-navy-800 border border-navy-700/40 rounded-xl px-4 py-3 hover:border-navy-600 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-200">
          {date.toLocaleDateString('en-IN', {
            timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
          })}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {snapshot.closingCash == null ? 'Drawer count pending' : `Drawer count ${fmt(snapshot.closingCash)}`}{correction && ` · Original ${fmt(record.closingCash)}`}
          {!record.businessDate && ' · Legacy date needs review'}
        </p>
      </div>
      <div className="text-right shrink-0">
        {diff !== 0 && (
          <p className={cn('text-sm font-semibold', diff > 0 ? 'text-emerald-400' : 'text-red-400')}>
            {diff > 0 ? '+' : ''}{fmt(diff)}
          </p>
        )}
        <span className={cn(
          'text-[10px] font-semibold px-2 py-0.5 rounded-full',
          record.status === 'closed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gold-500/15 text-gold-400'
        )}>
          {record.status}
        </span>
      </div>
    </button>
  );
}

export default function DailyClosingPage() {
  const { isStoreOwner, store, user } = useAuth();
  const canManage = isStoreOwner || hasPermission(user, PERMISSIONS.ACCOUNTING_MANAGE);
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const today = accountingDate(undefined, timeZone);
  const [selectedDate, setSelectedDate] = useSavedViewState('DailyClosingPage:DailyClosingPage:selectedDate', today);
  const [activeTab, setActiveTab] = useSavedViewState('DailyClosingPage:DailyClosingPage:activeTab', 'close'); // 'close' | 'history'
  const [localDraft, setLocalDraft] = useSavedViewState('DailyClosingPage:DailyClosingPage:localDraft', null);
  const [finalizePrompt, setFinalizePrompt] = useState(null);
  const [correctionForm, setCorrectionForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [movement, setMovement] = useState(null);

  const { currentData: summaryData, isFetching: summaryLoading, isError: summaryFailed, refetch: refetchSummary } = useGetDailySummaryQuery(
    { date: selectedDate },
    { skip: activeTab !== 'close' }
  );
  const paging = usePagination('history');
  const { data: historyData, isLoading: historyLoading } = useGetDailyClosingsQuery({ page: paging.page, limit: paging.limit }, { skip: activeTab !== 'history' });
  const [saveClosing, { isLoading: saving }] = useSaveDailyClosingMutation();
  const [finalizeClosing, { isLoading: finalizing }] = useFinalizeDailyClosingMutation();
  const [correctClosing, { isLoading: correcting }] = useCorrectDailyClosingMutation();

  const liveSummary = summaryData?.data;
  const closing = liveSummary?.closing;
  const isClosed = closing?.status === 'closed';
  const latestCorrection = closing?.corrections?.at(-1);
  const summary = (isClosed ? latestCorrection?.revised ?? closing : liveSummary) ?? {};
  const records = historyData?.data ?? [];
  const version = closing?.version ?? 0;
  const form = (!isClosed && localDraft) || formValues(isClosed ? summary : closing);
  const { openingCash, closingCash, notes } = form;
  const staleDraft = localDraft && localDraft.version !== version;
  const locked = !canManage || isClosed || saving || finalizing || !liveSummary || summaryFailed;
  const actionsDisabled = locked || summaryLoading;

  const cash = summary.movements?.cash ?? {};
  const expectedPaise = !liveSummary || !hasCashAmount(openingCash) ? null : toPaise(openingCash) + toPaise(cash.net);
  const expectedClosing = isClosed ? summary.expectedClosingCash : expectedPaise == null ? null : expectedPaise / 100;
  const cashDiff = expectedClosing == null || expectedClosing < 0 || !hasCashAmount(closingCash) ? null
    : isClosed ? summary.cashDifference : (toPaise(closingCash) - expectedPaise) / 100;
  const openDetails = (title, kind, channel) => setDetail({ title, kind, channel });
  const sum = (key) => Object.values(summary.movements ?? {}).reduce((total, row) => total + toPaise(row[key]), 0) / 100;
  const openMovement = (direction) => setMovement({ direction, operationId: crypto.randomUUID(),
    type: direction === 'in' ? 'owner_addition' : 'owner_withdrawal', method: 'cash', amount: '', party: '', description: '' });

  const selectDate = (date) => {
    setLocalDraft(null);
    setSelectedDate(date);
  };
  const updateDraft = (field, value) => {
    setLocalDraft((prev) => ({ ...(prev ?? { ...formValues(closing), version }), [field]: value }));
  };
  const reportError = (err, fallback) => {
    toast.error(err?.data?.message || fallback);
    if (err?.status === 409) refetchSummary();
  };

  const handleSave = async () => {
    try {
      await saveClosing({
        date: selectedDate,
        ...cashPayload(form),
        version: localDraft?.version ?? version,
        status: 'draft',
      }).unwrap();
      setLocalDraft(null);
      toast.success('Draft saved');
    } catch (err) {
      reportError(err, 'Failed to save draft');
    }
  };

  const handleMovement = async (event) => {
    event.preventDefault();
    const { direction: _direction, ...entry } = movement;
    try {
      await saveClosing({ date: selectedDate, ...cashPayload(form), version, status: 'draft', movement: entry }).unwrap();
      setLocalDraft(null);
      setMovement(null);
      toast.success('Money movement recorded');
    } catch (error) { reportError(error, 'Could not record money movement'); }
  };

  const handleFinalize = async () => {
    try {
      const { data } = await finalizeClosing(finalizePrompt).unwrap();
      setFinalizePrompt(null);
      toast.success(`Closing finalized. Cash difference ${fmt(data.closing.cashDifference)}`);
    } catch (err) {
      if (err?.status === 409) setFinalizePrompt(null);
      reportError(err, 'Failed to finalize closing');
    }
  };

  const handleCorrect = async (event) => {
    event.preventDefault();
    try {
      await correctClosing({
        id: closing._id, date: selectedDate, version: correctionForm.version,
        ...cashPayload(correctionForm), reason: correctionForm.reason,
      }).unwrap();
      setCorrectionForm(null);
      toast.success('Correction recorded');
    } catch (err) {
      reportError(err, 'Failed to record correction');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Daily Closing</h1>
          <p className="text-xs text-slate-500 mt-0.5">Review the day’s money and count your drawer</p>
        </div>
        <div className="flex gap-2">
          {['close', 'history'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors',
                activeTab === tab ? 'bg-gold-500/15 text-gold-400 border border-gold-500/30' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {tab === 'close' ? 'Close Day' : 'History'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'close' && (
        <div className="space-y-4">
          {/* Date picker */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => selectDate(shiftDate(selectedDate, -1))}
              className="workspace-row-action shrink-0 hover:bg-navy-700 text-slate-400"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              aria-label="Closing date"
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => { if (e.target.value) selectDate(e.target.value); }}
              className="min-w-0 w-0 flex-1 bg-navy-800 border border-navy-700/60 rounded-xl px-2 sm:px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-gold-500/60"
            />
            <button
              type="button"
              aria-label="Next day"
              onClick={() => selectDate(shiftDate(selectedDate, 1))}
              disabled={selectedDate >= today}
              className="workspace-row-action shrink-0 hover:bg-navy-700 text-slate-400 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
            <button type="button" aria-label="Refresh daily summary" onClick={refetchSummary} className="workspace-row-action shrink-0 hover:bg-navy-700 text-slate-400">
              <RefreshCw size={14} />
            </button>
          </div>

          {isClosed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div>
                <p className="text-sm font-semibold text-emerald-400">Finalized</p>
                <p className="text-xs text-slate-400">
                  Closed by {closing.closedByName}
                  {latestCorrection && ` · Original drawer count ${fmt(closing.closingCash)}`}
                </p>
              </div>
              {canManage && (
                <button type="button" className="btn-secondary" onClick={() => setCorrectionForm({
                  ...formValues(summary), version: latestCorrection?.version ?? version, reason: '',
                })}>
                  Record Correction
                </button>
              )}
            </div>
          )}
          {!isClosed && staleDraft && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-gold-400">
              <p>A newer draft was saved. Load it before making more changes.</p>
              <button type="button" className="underline" onClick={() => setLocalDraft(null)}>Load Saved Draft</button>
            </div>
          )}

          {summaryFailed && <p role="alert">Could not load this day’s money movements. Try refreshing.</p>}
          {!liveSummary && !summaryFailed && <div role="status" className="card p-4">Loading day summary…</div>}
          {liveSummary && <>
            {!isClosed && <p className="text-sm text-slate-500">{closing ? 'Draft saved' : 'Day open'}</p>}
            <section className="space-y-2">
              <h2 className="font-semibold">Sales on this day</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  [`Total Sales · ${summary.ordersCount ?? 0} orders placed`, summary.totalSales, 'totalSales'],
                  ['Cash Sales', summary.cashSales, 'sales', 'cash'],
                  ['Online Sales', Number(summary.upiSales ?? 0) + Number(summary.onlineSales ?? 0), 'sales', 'digital'],
                  ['Udhar Sales', summary.creditSales, 'creditSales'],
                ].map(([label, value, kind, channel]) => <AmountButton key={label} label={label} value={value} onClick={() => openDetails(label, kind, channel)} />)}
              </div>
            </section>
            <section className="card p-4 space-y-2">
              <h2 className="font-semibold">Opening Cash</h2>
              <label className="block text-sm" htmlFor="closing-opening-cash">Cash in the drawer when you opened (₹)</label>
              <input id="closing-opening-cash" className="input w-full sm:w-56" type="number" min="0" step="0.01" value={openingCash}
                placeholder="Enter amount" readOnly={locked || Boolean(staleDraft)} onChange={(e) => updateDraft('openingCash', e.target.value)} />
              {!locked && !staleDraft && openingCash === '' && liveSummary.suggestedOpeningCash != null &&
                (liveSummary.suggestedOpeningCash >= 0
                  ? <button className="btn-secondary block" type="button" onClick={() => updateDraft('openingCash', String(liveSummary.suggestedOpeningCash))}>Use suggested {fmt(liveSummary.suggestedOpeningCash)}</button>
                  : <p className="text-sm text-red-600">Recorded movements leave the suggested opening cash below zero. Check earlier cash entries.</p>)}
            </section>
            <div className="grid lg:grid-cols-2 gap-3">
              {[[received, 'Money Received', 'received', 'in', 'inflow'], [paid, 'Money Paid', 'paid', 'out', 'outflow']].map(([rows, title, kind, direction, total]) => (
                <section key={kind} className="card p-4 space-y-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h2 className="font-semibold">{title}</h2>
                    {!locked && <button className="btn-secondary" type="button" disabled={actionsDisabled || Boolean(staleDraft)} onClick={() => openMovement(direction)}>Record {direction === 'in' ? 'money received' : 'money paid'}</button>}
                  </div>
                  <button type="button" className="text-xl font-bold underline" onClick={() => openDetails(title, kind)}>{fmt(sum(total))}</button>
                  {rows.map(([key, label]) => <button key={key} type="button" className="flex w-full justify-between gap-3 border-t border-navy-700 py-2 text-left text-sm hover:underline"
                    onClick={() => openDetails(label, key)}><span>{label}</span><strong>{fmt(sum(key))}</strong></button>)}
                </section>
              ))}
            </div>
            <section className="card p-4">
              <h2 className="mb-2 font-semibold">Payment Method Summary</h2>
              {sum('otherPaid') + sum('otherReceived') > 0 && <p className="mb-2 text-sm text-slate-500">Cash moved between your drawer and bank appears on both sides of the transfer.</p>}
              <table className="w-full text-sm">
                <thead><tr><th className="text-left">Method</th><th className="text-right">Received</th><th className="text-right">Paid</th></tr></thead>
                <tbody>{MOVEMENT_CHANNELS.filter(([id], index) => index < 3 || summary.movements?.[id]?.inflow || summary.movements?.[id]?.outflow)
                  .map(([id, label]) => <tr key={id} className="border-t border-navy-700">
                    <th className="py-2 text-left">{label}</th>
                    {[[ 'received', 'inflow'], ['paid', 'outflow']].map(([kind, field]) =>
                      <td key={kind} className="text-right"><button type="button" className="underline" onClick={() => openDetails(`${label} ${kind}`, kind, id)}>{fmt(summary.movements?.[id]?.[field])}</button></td>)}
                  </tr>)}</tbody>
              </table>
            </section>
            <section className="card p-4 space-y-3">
              <h2 className="font-semibold">Cash Verification</h2>
              <div className="flex justify-between gap-3 text-sm"><span>Expected Cash in Drawer</span><strong>{expectedClosing == null ? 'Confirm opening cash' : fmt(expectedClosing)}</strong></div>
              {expectedClosing < 0 && <p role="alert" className="text-red-600">Expected cash is below zero. Check your opening cash, missing cash receipts or incorrect payment methods.</p>}
              <label htmlFor="closing-counted-cash" className="block text-sm">Actual Cash in Drawer (physical count)</label>
              <input id="closing-counted-cash" className="input w-full sm:w-56" type="number" min="0" step="0.01" value={closingCash}
                placeholder="Enter counted cash" readOnly={locked || Boolean(staleDraft)} onChange={(e) => updateDraft('closingCash', e.target.value)} />
              <p className="font-semibold">{cashDiff == null ? 'Cash Difference Pending' : cashDiff === 0 ? 'Cash Matched' :
                `${cashDiff < 0 ? 'Cash Short' : 'Extra Cash'} · ${fmt(Math.abs(cashDiff))}`}</p>
              {cashDiff == null && closingCash === '' && <p className="text-sm text-slate-500">Awaiting Cash Count</p>}
            </section>
          </>}

          {/* Notes */}
          <textarea
            value={notes}
            readOnly={locked || Boolean(staleDraft)}
            maxLength={1000}
            aria-label="Closing notes"
            onChange={(e) => updateDraft('notes', e.target.value)}
            placeholder={cashDiff ? "Explain the cash difference before finalizing" : "Notes (optional)"}
            rows={2}
            className="w-full bg-navy-800 border border-navy-700/60 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60 resize-none"
          />

          {isClosed ? (
            Boolean(closing.corrections?.length) && (
              <div className="space-y-2 rounded-xl border border-navy-700/60 bg-navy-800 p-4">
                <h2 className="text-sm font-semibold text-slate-200">Correction History</h2>
                {[...closing.corrections].reverse().map((correction) => (
                  <details key={correction._id} className="border-t border-navy-700/60 py-2 text-sm text-slate-300">
                    <summary className="cursor-pointer">
                      {correction.actorName} · {new Date(correction.correctedAt).toLocaleString('en-IN', {
                        timeZone, dateStyle: 'medium', timeStyle: 'short',
                      })}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap">{correction.reason}</p>
                    <dl className="mt-2 space-y-1 text-xs">
                      {[
                        ['openingCash', 'Opening cash'], ['closingCash', 'Drawer count'],
                        ['expectedClosingCash', 'Expected cash'], ['cashDifference', 'Cash difference'],
                      ].map(([key, label]) => (
                        <div key={key} className="flex justify-between gap-3">
                          <dt>{label}</dt>
                          <dd>{fmt(correction.previous[key])} → {fmt(correction.revised[key])}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ))}
              </div>
            )
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={actionsDisabled || staleDraft} onClick={handleSave}
                className="btn-secondary flex items-center gap-2">
                {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                Save Draft
              </button>
              <button type="button" disabled={actionsDisabled || !closing || Boolean(localDraft) || cashDiff == null || (Boolean(cashDiff) && !notes.trim())}
                onClick={() => setFinalizePrompt({ id: closing._id, date: selectedDate, version, reviewKey: liveSummary.reviewKey, closingCash: closing.closingCash })}
                className="btn-primary">
                Finalize Closing
              </button>
              {localDraft && !staleDraft && <p className="self-center text-xs text-slate-400">Save your changes before finalizing.</p>}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-3">
          {historyLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-navy-800 rounded-xl animate-pulse" />)}
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays size={40} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500">No daily closings recorded yet</p>
            </div>
          ) : (
            records.map((rec) => (
              <HistoryRow
                key={rec._id}
                record={rec}
                onClick={(r) => {
                  selectDate(r.businessDate);
                  setActiveTab('close');
                }}
              />
            ))
          )}
        </div>
      )}
      <Modal isOpen={Boolean(detail)} title={detail?.title ?? 'Transactions'} size="lg" onClose={() => setDetail(null)}>
        {detail && <TransactionDetails key={`${selectedDate}:${detail.kind}:${detail.channel}`} date={selectedDate} detail={detail} timeZone={timeZone} closed={isClosed} />}
      </Modal>
      <Modal isOpen={Boolean(movement)} title={movement?.direction === 'in' ? 'Money Received' : 'Money Paid'} onClose={() => { if (!saving) setMovement(null); }}>
        {movement && <form className="space-y-3" onSubmit={handleMovement}>
          <p className="text-sm text-slate-500">Record money that is missing from the app. Sales, collections and payments already recorded are included automatically.</p>
          {movement.direction === 'out' && <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" to={`${ROUTES.STORE.EXPENSES}?date=${selectedDate}&new=1`}>Add shop expense</Link>
            <Link className="btn-secondary" to={ROUTES.STORE.SALARY}>Pay salary</Link>
            <Link className="btn-secondary" to={ROUTES.STORE.SUPPLIER_PAYMENTS}>Pay supplier</Link>
          </div>}
          <label className="block text-sm">Transaction type<select className="input block w-full" value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value, method: 'cash' })}>
            {manualTypes[movement.direction].map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </select></label>
          <label className="block text-sm">Amount (₹)<input className="input block w-full" required type="number" min="0.01" step="0.01" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} /></label>
          {['external_sale', 'other_receipt', 'other_payment'].includes(movement.type) && <label className="block text-sm">Payment method<select className="input block w-full" value={movement.method} onChange={(e) => setMovement({ ...movement, method: e.target.value })}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank</option>
          </select></label>}
          <label className="block text-sm">{movement.direction === 'in' ? 'Received from' : 'Paid to'}<input className="input block w-full" maxLength={120} value={movement.party} onChange={(e) => setMovement({ ...movement, party: e.target.value })} /></label>
          <label className="block text-sm">Reason or description<input className="input block w-full" required maxLength={500} value={movement.description} onChange={(e) => setMovement({ ...movement, description: e.target.value })} /></label>
          <button className="btn-primary" type="submit" disabled={actionsDisabled || Boolean(staleDraft)}>{saving ? 'Saving…' : 'Save money movement'}</button>
        </form>}
      </Modal>
      <Modal isOpen={Boolean(finalizePrompt)} title="Finalize Daily Closing"
        onClose={() => { if (!finalizing) setFinalizePrompt(null); }}>
        <div className="space-y-4 p-4">
          <p className="text-sm text-slate-300">Finalize the saved drawer count of {fmt(finalizePrompt?.closingCash)} for {finalizePrompt?.date}?</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={finalizing} onClick={() => setFinalizePrompt(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={finalizing} onClick={handleFinalize}>Finalize Closing</button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={Boolean(correctionForm)} title="Record Closing Correction"
        onClose={() => { if (!correcting) setCorrectionForm(null); }}>
        {correctionForm && (
          <form onSubmit={handleCorrect} className="space-y-3 p-4">
            {[
              ['openingCash', 'Opening cash (₹)'], ['closingCash', 'Drawer count (₹)'],
            ].map(([key, label]) => (
              <label key={key} className="block text-sm text-slate-300">
                {label}
                <input className="input mt-1 w-full" type="number" min="0" step="0.01" required
                  value={correctionForm[key]}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, [key]: e.target.value })} />
              </label>
            ))}
            <label className="block text-sm text-slate-300">
              Revised notes
              <textarea className="input mt-1 w-full" maxLength={1000} value={correctionForm.notes}
                onChange={(e) => setCorrectionForm({ ...correctionForm, notes: e.target.value })} />
            </label>
            <label className="block text-sm text-slate-300">
              Reason for correction
              <textarea className="input mt-1 w-full" maxLength={1000} required value={correctionForm.reason}
                onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={correcting} onClick={() => setCorrectionForm(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={correcting || !correctionForm.reason.trim()}>Record Correction</button>
            </div>
          </form>
        )}
      </Modal>
      {activeTab === 'history' && <Pagination meta={historyData?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={historyLoading} label="closings" />}
    </div>
  );
}
