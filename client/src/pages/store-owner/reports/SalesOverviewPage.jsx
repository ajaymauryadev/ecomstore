import { usePageSize } from '../../../hooks/usePagination';
import { Link } from 'react-router-dom';
import { useSavedSearchParams } from '../../../offline/useSavedSearchParams';
import { ShoppingCart, Truck, Wallet, TrendingUp, BookOpen, RefreshCw, Receipt } from 'lucide-react';
import { useGetSalesOverviewQuery } from '../../../features/reports/reportsApi';
import { useAuth } from '../../../hooks/useAuth';
import { accountingDate, resolveStoreTimeZone } from '../../../utils/accounting';
import { formatCurrency } from '../../../utils/formatters';
import { ROUTES } from '../../../constants/routes';
import LoadError from '../../../components/ui/LoadError';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import { useCursorPages } from '../../../hooks/useCursorPages';

const SOURCES = {
  pos: { label: 'POS / counter', icon: ShoppingCart, tone: 'bg-blue-500/10 text-blue-400' },
  delivery: { label: 'Online / delivery', icon: Truck, tone: 'bg-purple-500/10 text-purple-400' },
  pickup: { label: 'Self pickup', icon: Receipt, tone: 'bg-emerald-500/10 text-emerald-400' },
  wholesale: { label: 'Wholesale', icon: BookOpen, tone: 'bg-amber-500/10 text-amber-400' },
  udhar: { label: 'Udhar collections', icon: Wallet, tone: 'bg-emerald-500/10 text-emerald-400' },
  other: { label: 'Other sales', icon: Receipt, tone: 'bg-navy-700 text-slate-400' },
};
const METHODS = { counter: 'Cash', cod: 'Cash on delivery', cash_on_pickup: 'Cash on pickup', cash: 'Cash', upi: 'UPI', upi_id: 'UPI', upi_qr: 'UPI QR', bank_transfer: 'Bank transfer', gateway: 'Gateway', cheque: 'Cheque', unclassified: 'Method not recorded' };

export default function SalesOverviewPage() {
  const { store } = useAuth();
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const [params, setParams] = useSavedSearchParams();
  const today = accountingDate(undefined, timeZone);
  const startDate = params.get('startDate') || today;
  const endDate = params.get('endDate') || startDate;
  const { limit } = usePageSize('rows');
  const paging = useCursorPages(`${startDate}:${endDate}:${limit}`);
  const page = paging.page;
  const invalidRange = startDate > endDate;
  const { currentData, isLoading, isFetching, isError, error, refetch } = useGetSalesOverviewQuery({ startDate, endDate, page, cursor: paging.cursor, limit }, { skip: invalidRange });
  const report = currentData?.data;
  const summary = report?.summary || {};
  const setDate = (key, value) => { paging.reset(); setParams({ startDate, endDate, [key]: value || today }, { replace: true }); };
  const bySource = (rows, key) => rows?.find((row) => row.key === key)?.amount || 0;
  const money = (value) => report ? formatCurrency(value || 0) : '—';

  return <div className="space-y-6" aria-busy={isFetching}>
    <header className="page-header">
      <div><p className="text-sm text-gold-400 font-semibold mb-1">Sales & collections</p><h1>Where your money comes from</h1><p className="text-sm text-slate-500 mt-2">Track completed sales, received payments and customer dues.</p></div>
      <Button variant="secondary" onClick={refetch} disabled={isFetching || invalidRange} leftIcon={<RefreshCw size={16} />}>Refresh</Button>
    </header>
    <div className="card p-4 flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-40 sm:flex-none"><span className="label">From</span><input type="date" className="input" value={startDate} onChange={(event) => setDate('startDate', event.target.value)} /></label>
      <label className="flex-1 min-w-40 sm:flex-none"><span className="label">To</span><input type="date" className="input" value={endDate} onChange={(event) => setDate('endDate', event.target.value)} /></label>
      <Button variant="secondary" onClick={() => { paging.reset(); setParams({ startDate: today, endDate: today }, { replace: true }); }}>Today</Button>
      <p className="text-xs text-slate-500 sm:ml-auto">Store timezone: {timeZone}</p>
    </div>
    {invalidRange ? <p role="alert" className="workspace-feedback">From date must be on or before To date.</p> : isError ? <LoadError title="Could not load sales and collections" error={error} retry={refetch} /> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Completed sales', money(summary.sales), `${summary.orderCount || 0} completed bills · Includes credit sales`, TrendingUp, 'text-gold-400'],
          ['Payments received', money(summary.received), 'POS + online + Udhar collections', Wallet, 'text-emerald-400'],
          ['Cash / UPI refunds', money(summary.refunds), `Net received: ${money(summary.netReceived)}`, Receipt, 'text-amber-400'],
          ['Outstanding Udhar', money(summary.outstandingUdhar), 'Current balance across all accounts', BookOpen, 'text-red-400'],
        ].map(([label, value, detail, Icon, tone]) => <article key={label} className="card p-5 min-w-0">
          <div className="flex justify-between items-center gap-2"><p className="text-sm text-slate-500">{label}</p><Icon size={18} className={tone} aria-hidden="true" /></div>
          <p className={`text-2xl font-bold mt-3 break-words tabular-nums ${tone}`}>{value}</p><p className="text-xs text-slate-500 mt-2">{detail}</p>
          {label === 'Outstanding Udhar' && <Link to={ROUTES.STORE.UDHAR} className="workspace-link mt-1">View customer accounts</Link>}
        </article>)}
      </div>
      <section className="card p-5 space-y-4" aria-labelledby="sales-sources">
        <div><h2 id="sales-sources" className="font-bold text-lg">Sales by source</h2><p className="text-sm text-slate-500 mt-1">Sales use completion dates. Collections use the date money was received, including payments for older bills.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(SOURCES).filter(([key]) => ['pos', 'delivery', 'udhar'].includes(key) || bySource(report?.salesBySource, key) || bySource(report?.receiptsBySource, key)).map(([key, { label, icon: Icon, tone }]) => <article key={key} className="border border-navy-700 rounded-xl p-4 min-w-0">
            <div className="flex items-center gap-3"><span className={`grid place-items-center h-10 w-10 rounded-xl shrink-0 ${tone}`}><Icon size={19} aria-hidden="true" /></span><h3 className="font-semibold text-sm">{label}</h3></div>
            <dl className="mt-4 space-y-2 text-sm">
              {key !== 'udhar' && <div className="flex justify-between flex-wrap gap-2"><dt className="text-slate-500">Completed sales</dt><dd className="font-semibold tabular-nums">{money(bySource(report?.salesBySource, key))}</dd></div>}
              <div className="flex justify-between flex-wrap gap-2"><dt className="text-slate-500">Received</dt><dd className="font-bold text-emerald-400 tabular-nums">{money(bySource(report?.receiptsBySource, key))}</dd></div>
            </dl>
            <div className="mt-3 h-1.5 bg-navy-700 rounded-full overflow-hidden" aria-hidden="true"><div className="bg-gold-500 h-full rounded-full" style={{ width: `${summary.received ? Math.min(100, bySource(report?.receiptsBySource, key) / summary.received * 100) : 0}%` }} /></div>
          </article>)}
        </div>
        <p className="text-xs text-slate-500">Credit bills in completed sales: {money(summary.creditSales)}. Udhar collections are counted once, when received.</p>
      </section>
      <section className="card p-5 space-y-3"><h2 className="font-bold">Payment methods</h2><div className="flex flex-wrap gap-2">{report?.receiptsByMethod?.length ? report.receiptsByMethod.map((row) => <p key={row.key} className="rounded-xl border border-navy-700 px-3 py-2 text-sm"><span className="text-slate-500">{METHODS[row.key] || row.key}</span><strong className="ml-3 tabular-nums">{formatCurrency(row.amount)}</strong></p>) : <p className="text-sm text-slate-500">{isLoading ? 'Loading payment methods…' : 'No payments in this period.'}</p>}</div></section>
      <section className="card p-0 overflow-hidden" aria-labelledby="received-payments">
        <div className="p-5 border-b border-navy-700"><h2 id="received-payments" className="font-bold text-lg">Received payments</h2><p className="text-sm text-slate-500 mt-1">{report?.meta?.total || 0} receipts in this period · Showing 5 per page</p></div>
        {isLoading || (isFetching && !report) ? <p role="status" className="p-6 text-slate-500">Loading collections…</p> : !report?.transactions?.length ? <EmptyState icon={Wallet} title="No payments received" description="Received payments will appear here for the selected dates." /> : <ul className="divide-y divide-navy-700">{report.transactions.map((row) => <li key={row.receiptKey || `${row.source}-${row._id}`} className="p-4 sm:px-5 flex flex-wrap gap-3 items-start">
          <div className="min-w-0 flex-1 basis-40"><p className="font-semibold text-sm break-words">{row.customerName || 'Walk-in customer'}</p><p className="text-xs text-slate-500 mt-1">{SOURCES[row.source]?.label || 'Other'} · {METHODS[row.method] || row.method}</p><p className="text-xs text-slate-500 mt-1">{new Date(row.receivedAt).toLocaleString('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>{row.recordedByName && <p className="text-xs text-slate-500 mt-1">Recorded by {row.recordedByName}</p>}</div>
          <div className="text-right"><p className="font-bold text-emerald-400 tabular-nums">{formatCurrency(row.amount)}</p>{row.orderId ? <Link className="workspace-link text-xs break-all" to={`${ROUTES.STORE.ORDERS}?orderId=${row.orderId}`}>{row.orderNumber || 'View bill'}</Link> : row.customerId && <Link className="workspace-link" to={`${ROUTES.STORE.UDHAR}?customerId=${row.customerId}`}>View ledger</Link>}</div>
        </li>)}</ul>}
      </section>
      {report?.meta?.totalPages > 1 && <div className="flex items-center justify-between gap-2"><Button variant="secondary" size="sm" disabled={!report.meta.hasPrevPage || isFetching} onClick={() => paging.previous()}>Previous</Button><p className="text-sm text-slate-500">Page {page} of {report.meta.totalPages}</p><Button variant="secondary" size="sm" disabled={!report.meta.hasNextPage || isFetching} onClick={() => paging.next(report.meta.nextCursor)}>Next</Button></div>}
    </>}
  </div>;
}
