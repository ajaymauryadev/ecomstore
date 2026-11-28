import { useSavedViewState } from '../../../offline/useSavedViewState';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import Pagination from '../../../components/ui/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { Plus, Search, TrendingDown, CreditCard, Clock, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetPurchasesQuery, useGetPurchaseStatsQuery } from '../../../features/purchases/purchaseApi';
import { formatCurrency } from '../../../utils/formatters';
import { cn } from '../../../utils/cn';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import { ROUTES } from '../../../constants/routes';

const STATUS_META = {
  PAID:    { label: 'Paid',    color: 'status-active',   icon: CheckCircle },
  UNPAID:  { label: 'Unpaid',  color: 'text-red-400',    icon: Clock },
  PARTIAL: { label: 'Partial', color: 'text-amber-400',  icon: CreditCard },
};

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PurchaseList() {
  const [search, setSearch] = useSavedViewState('PurchaseList:PurchaseList:search', '');
  const [paymentStatus, setPaymentStatus] = useSavedViewState('PurchaseList:PurchaseList:paymentStatus', '');
  const settledSearch = useDebouncedValue(search.trim(), 250);
  const { page, setPage, limit } = usePagination(JSON.stringify([settledSearch, paymentStatus]), 'compact');

  const { data, isLoading, isFetching } = useGetPurchasesQuery({ search: settledSearch, paymentStatus, page, limit });
  const { data: statsData } = useGetPurchaseStatsQuery({});

  const purchases = data?.data?.purchases || [];
  const meta = data?.meta || {};
  const stats = statsData?.data?.stats || {};

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases</h1>
          <p className="text-slate-400 text-sm mt-0.5">{meta.total == null ? 'Entry count unavailable' : `${meta.total} total entries`}</p>
        </div>
        <Link to={ROUTES.STORE.PURCHASE_NEW} className="btn btn-primary btn-sm gap-1.5">
          <Plus size={14} /> New Purchase
        </Link>
      </div>

      {/* Stats row */}
      {stats.totalPurchases > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Purchases', value: meta.total ?? '—', color: 'text-blue-400' },
            { label: 'Total Amount', value: stats.totalAmount == null ? '—' : formatCurrency(stats.totalAmount), color: 'text-gold-400' },
            { label: 'Total Paid', value: stats.totalPaid == null ? '—' : formatCurrency(stats.totalPaid), color: 'text-emerald-400' },
            { label: 'Pending', value: stats.totalPending == null ? '—' : formatCurrency(stats.totalPending), color: 'text-red-400' },
          ].map((s) => (
            <div key={s.label} className="kpi-card py-3">
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className={cn('text-lg font-bold mt-1', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search invoice, supplier..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="input pl-8 w-full"
          />
        </div>
        <select
          value={paymentStatus}
          onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }}
          className="input min-w-[130px]"
        >
          <option value="">All Status</option>
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" className="text-gold-500" /></div>
      ) : purchases.length === 0 ? (
        <div className="card p-12 text-center">
          <TrendingDown size={40} strokeWidth={1} className="mx-auto text-navy-600 mb-3" />
          <p className="text-slate-400 font-medium">No purchases yet</p>
          <Link to={ROUTES.STORE.PURCHASE_NEW} className="btn btn-primary btn-sm mt-4 inline-flex gap-1.5">
            <Plus size={14} /> New Purchase
          </Link>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden" aria-busy={isFetching}>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Supplier</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Pending</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => {
                  const sm = STATUS_META[p.paymentStatus] || {};
                  return (
                    <tr key={p._id} className="hover:bg-navy-700/10 transition-colors">
                      <td><span className="text-xs text-slate-400">{formatDate(p.purchaseDate)}</span></td>
                      <td>
                        <span className="text-xs font-mono text-slate-300">
                          {p.invoiceNumber || <span className="text-slate-600">—</span>}
                        </span>
                      </td>
                      <td>
                        <span className="text-sm text-slate-300">
                          {p.supplierId?.name || p.supplierName || <span className="text-slate-600">Walk-in</span>}
                        </span>
                      </td>
                      <td><span className="text-sm text-slate-400">{p.items?.length ?? 0} items</span></td>
                      <td><span className="text-sm font-semibold text-slate-100">{formatCurrency(p.totalAmount)}</span></td>
                      <td><span className="text-sm text-emerald-400">{formatCurrency(p.paidAmount)}</span></td>
                      <td>
                        <span className={cn('text-sm font-medium', p.pendingAmount > 0 ? 'text-red-400' : 'text-slate-500')}>
                          {formatCurrency(p.pendingAmount)}
                        </span>
                      </td>
                      <td>
                        <Badge
                          status={p.paymentStatus === 'PAID' ? 'active' : p.paymentStatus === 'PARTIAL' ? 'warning' : 'inactive'}
                          dot
                        >
                          {sm.label}
                        </Badge>
                      </td>
                      <td>
                        <Link
                          to={ROUTES.STORE.PURCHASE_DETAIL(p._id)}
                          className="text-xs font-medium text-gold-400 hover:text-gold-300 px-2 py-1 rounded-lg hover:bg-gold-500/10 transition-colors"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination meta={meta} page={page} onPageChange={setPage} isFetching={isFetching} label="purchases" />
        </div>
      )}
    </div>
  );
}
