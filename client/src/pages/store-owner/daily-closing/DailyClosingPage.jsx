import { useSavedViewState } from '../../../offline/useSavedViewState';
import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, TrendingUp, TrendingDown, DollarSign,
  Save, ChevronLeft, ChevronRight, AlertTriangle, Clock,
  RefreshCw,
} from 'lucide-react';
import {
  useGetDailySummaryQuery,
  useSaveDailyClosingMutation,
  useFinalizeDailyClosingMutation,
  useCorrectDailyClosingMutation,
  useGetDailyClosingsQuery,
} from '../../../features/dailyClosing/dailyClosingApi';
import toast from 'react-hot-toast';
import { cn } from '../../../utils/cn';
import { accountingDate, resolveStoreTimeZone } from '../../../utils/accounting';
import { ROUTES } from '../../../constants/routes';
import { useAuth } from '../../../hooks/useAuth';
import Modal from '../../../components/ui/Modal';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';

const MOVEMENT_CHANNELS = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank'],
  ['other', 'Other non-cash'], ['unclassified', 'Method unrecorded'],
];

const toPaise = (value) => Math.round((Number(value) || 0) * 100);
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
  openingCash: Number(form.openingCash),
  closingCash: Number(form.closingCash),
  notes: form.notes,
});

function SummaryCard({ label, value, sub, color = 'text-slate-200', icon: Icon }) {
  return (
    <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
        {Icon && <Icon size={14} className="text-slate-600" />}
      </div>
      <p className={cn('text-xl font-bold', color)}>{fmt(value)}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
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
          Drawer count {fmt(snapshot.closingCash)}{correction && ` · Original ${fmt(record.closingCash)}`}
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

  const { currentData: summaryData, isFetching: summaryLoading, isError: summaryFailed, refetch: refetchSummary } = useGetDailySummaryQuery(
    { date: selectedDate },
    { refetchOnMountOrArgChange: false }
  );
  const paging = usePagination('history');
  const { data: historyData, isLoading: historyLoading } = useGetDailyClosingsQuery({ page: paging.page, limit: paging.limit });
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
  const expectedPaise = toPaise(openingCash) + toPaise(cash.net);
  const expectedClosing = isClosed ? summary.expectedClosingCash : expectedPaise / 100;
  const cashDiff = isClosed ? summary.cashDifference : (toPaise(closingCash) - expectedPaise) / 100;

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
          <p className="text-xs text-slate-500 mt-0.5">Cash reconciliation & day summary</p>
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

          {/* Auto-computed sales (read-only) */}
          {summaryLoading && !liveSummary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-navy-800 rounded-xl animate-pulse" />)}
            </div>
          ) : summaryFailed ? (
            <p role="alert" className="text-sm text-red-400">Could not load this day’s movements. Refresh to try again.</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Sales and returns</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="Cash Sales" value={summary?.cashSales} color="text-emerald-400" icon={DollarSign} />
                  <SummaryCard label="UPI Sales" value={summary?.upiSales} color="text-blue-400" icon={TrendingUp} />
                  <SummaryCard label="Udhar Added" value={summary?.creditSales} color="text-orange-400" icon={Clock}
                    sub="Credit sales today" />
                  <SummaryCard label="Returns" value={summary?.returnsTotal} color="text-red-400" icon={TrendingDown}
                    sub="Processed refunds and store credit" />
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-navy-700/60 bg-navy-800 p-4">
                <table className="w-full text-sm text-slate-300">
                  <caption className="mb-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Movements by payment method
                  </caption>
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="py-1 text-left">Method</th>
                      <th scope="col" className="px-2 py-1 text-right">Inflow</th>
                      <th scope="col" className="px-2 py-1 text-right">Outflow</th>
                      <th scope="col" className="py-1 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MOVEMENT_CHANNELS.map(([id, label], index) => {
                      const movement = summary.movements?.[id];
                      if (index >= 3 && !movement?.inflow && !movement?.outflow) return null;
                      return (
                        <tr key={id} className="border-t border-navy-700/40">
                          <th scope="row" className="py-2 text-left font-medium">{label}</th>
                          <td className="px-2 text-right">{fmt(movement?.inflow)}</td>
                          <td className="px-2 text-right">{fmt(movement?.outflow)}</td>
                          <td className="text-right font-semibold">{fmt(movement?.net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bg-navy-800 border border-navy-700/60 rounded-xl px-4 py-3 flex items-center gap-6">
                <div>
                  <p className="text-xs text-slate-500">Total Sales</p>
                  <p className="text-lg font-bold text-slate-100">{fmt(summary?.totalSales)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Orders</p>
                  <p className="text-lg font-bold text-slate-200">{summary?.ordersCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Supplier Payments</p>
                  <p className="text-lg font-bold text-slate-200">{fmt(summary?.supplierPayments)}</p>
                </div>
              </div>
            </>
          )}

          {/* Manual entries */}
          <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Manual Cash Count</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="closing-opening-cash" className="text-xs text-slate-500 block mb-1">Opening Cash (₹)</label>
                <input
                  id="closing-opening-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingCash}
                  readOnly={locked || Boolean(staleDraft)}
                  onChange={(e) => updateDraft('openingCash', e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-navy-900 border border-navy-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-gold-500/60"
                />
              </div>
              <div>
                <label htmlFor="closing-counted-cash" className="text-xs text-slate-500 block mb-1">Closing Cash — Physical Count (₹)</label>
                <input
                  id="closing-counted-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  value={closingCash}
                  readOnly={locked || Boolean(staleDraft)}
                  onChange={(e) => updateDraft('closingCash', e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-navy-900 border border-navy-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-gold-500/60"
                />
              </div>
            </div>
          </div>

          {/* Cash difference summary */}
          <div className={cn(
            'rounded-xl border p-4 space-y-2',
            cashDiff > 0 ? 'bg-emerald-500/5 border-emerald-500/30' :
              cashDiff < 0 ? 'bg-red-500/5 border-red-500/30' :
                'bg-navy-800 border-navy-700/60'
          )}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cash Reconciliation</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Opening Cash</span><span>{fmt(Number(openingCash) || 0)}</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>+ Cash Sales</span><span>{fmt(cash.sales ?? (isClosed ? summary.cashSales : undefined))}</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>+ Cash Udhar Collections</span><span>{fmt(cash.udharCollections)}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>− Cash Supplier Payments</span><span>{fmt(cash.supplierPayments)}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>− Cash Refunds</span><span>{fmt(cash.refunds)}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <Link to={ROUTES.STORE.EXPENSES} className="underline underline-offset-2">− Cash Expenses</Link>
                <span>{fmt(cash.expenses)}</span>
              </div>
              <div className="flex justify-between text-slate-300 border-t border-navy-700/40 pt-1 font-medium">
                <span>Expected Closing</span><span>{fmt(expectedClosing)}</span>
              </div>
              <div className="flex justify-between text-slate-300 font-medium">
                <span>Actual Closing</span><span>{fmt(Number(closingCash) || 0)}</span>
              </div>
              <div className={cn('flex justify-between font-bold text-base border-t border-navy-700/40 pt-1', cashDiff > 0 ? 'text-emerald-400' : cashDiff < 0 ? 'text-red-400' : 'text-slate-300')}>
                <div className="flex items-center gap-1.5">
                  {cashDiff !== 0 && (cashDiff > 0 ? <TrendingUp size={14} /> : <AlertTriangle size={14} />)}
                  <span>{cashDiff > 0 ? 'Cash Excess' : cashDiff < 0 ? 'Cash Short' : 'Balanced'}</span>
                </div>
                <span>{cashDiff >= 0 ? '+' : ''}{fmt(cashDiff)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <textarea
            value={notes}
            readOnly={locked || Boolean(staleDraft)}
            maxLength={1000}
            aria-label="Closing notes"
            onChange={(e) => updateDraft('notes', e.target.value)}
            placeholder="Notes (optional)..."
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
              <button type="button" disabled={actionsDisabled || !closing || Boolean(localDraft)}
                onClick={() => setFinalizePrompt({ id: closing._id, date: selectedDate, version, closingCash: closing.closingCash })}
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
