import { useState } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, Package,
  Users, Truck, AlertTriangle, RefreshCw, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import { useGetProfitLossQuery } from '../../../features/reports/reportsApi';
import { cn } from '../../../utils/cn';
import { accountingDate, resolveStoreTimeZone } from '../../../utils/accounting';
import { useAuth } from '../../../hooks/useAuth';
import LoadError from '../../../components/ui/LoadError';

function fmt(n) {
  const abs = Math.abs(n ?? 0);
  const sign = n < 0 ? '-' : '';
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}
function fmtFull(n) {
  if (n == null) return '—';
  return `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PIE_COLORS = ['#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#3b82f6'];

function MetricCard({ label, value, sub, trend, color = 'text-slate-100', icon: Icon, iconBg = 'bg-navy-700/60', iconColor = 'text-slate-400' }) {
  return (
    <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5 flex items-start gap-4">
      {Icon && (
        <div className={cn('p-3 rounded-xl shrink-0', iconBg)}>
          <Icon size={20} className={iconColor} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</p>
        <p className={cn('text-2xl font-bold', color)}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {trend !== undefined && (
        <div className={cn('flex items-center gap-1 text-xs font-medium shrink-0', trend >= 0 ? 'text-emerald-400' : 'text-red-400')}>
          {trend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 my-2">
      <div className="flex-1 border-t border-navy-700/60" />
      <span className="text-xs text-slate-600 uppercase tracking-widest">{label}</span>
      <div className="flex-1 border-t border-navy-700/60" />
    </div>
  );
}

export default function ProfitLossPage() {
  const { store } = useAuth();
  const today = accountingDate(undefined, resolveStoreTimeZone(store?.settings?.timezone));
  const firstOfMonth = today.slice(0, 8) + '01';

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);

  const { currentData, isFetching, isError, error, refetch } = useGetProfitLossQuery({ startDate, endDate }, { refetchOnMountOrArgChange: true });
  const pl = currentData?.data ?? {};

  const hasNetProfit = pl.netProfit != null;
  const isProfit = pl.netProfit >= 0;
  const margin = pl.grossMargin == null ? '—' : `${pl.grossMargin}%`;

  const deductionData = [
    { name: 'Expenses', value: pl.expenses ?? 0 },
    { name: 'Staff Salary', value: pl.salaryCost ?? 0 },
    { name: 'Damage/Loss', value: pl.damageValue ?? 0 },
  ].filter((d) => d.value > 0);

  const barData = [
    { name: 'Net Sales', value: pl.netSales, fill: '#f59e0b' },
    { name: 'COGS', value: pl.cogs, fill: '#ef4444' },
    { name: 'Gross Profit', value: pl.grossProfit, fill: pl.grossProfit >= 0 ? '#10b981' : '#ef4444' },
    { name: 'Net Profit', value: pl.netProfit, fill: isProfit ? '#10b981' : '#ef4444' },
  ].filter(({ value }) => value != null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Profit & Loss</h1>
          <p className="text-sm text-slate-500 mt-1">Financial summary for selected period</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
            <span className="text-xs text-slate-500">From</span>
            <input type="date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
          </div>
          <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
            <span className="text-xs text-slate-500">To</span>
            <input type="date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
          </div>
          <button onClick={refetch} aria-label="Refresh profit and loss" className="workspace-row-action bg-navy-800 border border-navy-700/40 text-slate-400 hover:text-gold-400">
            <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isError ? <LoadError title="Could not load profit and loss" error={error} retry={refetch} /> : isFetching && !currentData ? (
        <p role="status" className="card p-6 text-slate-500">Loading profit and loss…</p>
      ) : <>
      {pl.unknownCostLines > 0 && (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Historical unit cost is unknown for {pl.unknownCostLines} {pl.unknownCostLines === 1 ? 'line' : 'lines'}.
          {' '}Known COGS is {fmtFull(pl.knownCogs)}. Total COGS, profit and margin are unavailable.
        </p>
      )}

      {/* Net Profit Banner */}
      <div className={cn('rounded-2xl p-6 border', !hasNetProfit ? 'bg-navy-800 border-navy-700/60' : isProfit ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20')}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm text-slate-400 mb-1">Net {hasNetProfit && !isProfit ? 'Loss' : 'Profit'}</p>
            <p className={cn('text-4xl font-bold', !hasNetProfit ? 'text-slate-300' : isProfit ? 'text-emerald-400' : 'text-red-400')}>
              {fmtFull(pl.netProfit)}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Gross margin {margin}
            </p>
          </div>
          {hasNetProfit && <div className={cn('p-4 rounded-2xl', isProfit ? 'bg-emerald-500/10' : 'bg-red-500/10')}>
            {isProfit ? (
              <TrendingUp size={40} className="text-emerald-400" />
            ) : (
              <TrendingDown size={40} className="text-red-400" />
            )}
          </div>}
        </div>
      </div>

      {/* Revenue metrics */}
      <div>
        <SectionDivider label="Revenue" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard
            label="Net Sales" value={fmtFull(pl.netSales)}
            sub={pl.totalSales == null ? undefined : `${fmtFull(pl.totalSales)} sales · ${fmtFull(pl.returnsTotal)} net refunds`}
            icon={ShoppingCart} iconBg="bg-gold-500/10" iconColor="text-gold-400" color="text-gold-400"
          />
          <MetricCard
            label="Cost of Goods Sold" value={fmtFull(pl.cogs)}
            icon={Package} iconBg="bg-red-500/10" iconColor="text-red-400" color="text-red-400"
          />
          <MetricCard
            label="Gross Profit" value={fmtFull(pl.grossProfit)}
            icon={DollarSign} iconBg="bg-emerald-500/10" iconColor="text-emerald-400"
            color={pl.grossProfit == null ? 'text-slate-300' : pl.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        </div>
      </div>

      {/* Deductions */}
      <div>
        <SectionDivider label="Deductions" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard label="Expenses" value={fmtFull(pl.expenses)} icon={DollarSign} iconBg="bg-orange-500/10" iconColor="text-orange-400" color="text-orange-400" />
          <MetricCard label="Staff Salary" value={fmtFull(pl.salaryCost)} icon={Users} iconBg="bg-purple-500/10" iconColor="text-purple-400" color="text-purple-400" />
          <MetricCard label="Damage/Loss" value={fmtFull(pl.damageValue)} icon={AlertTriangle} iconBg="bg-red-500/10" iconColor="text-red-400" color="text-red-400" />
        </div>
      </div>

      {/* Outstanding dues */}
      <div>
        <SectionDivider label="Outstanding (Current)" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            label="Supplier Dues" value={fmtFull(pl.supplierDues)} sub="Amount owed to suppliers"
            icon={Truck} iconBg="bg-red-500/10" iconColor="text-red-400" color="text-red-400"
          />
          <MetricCard
            label="Customer Dues" value={fmtFull(pl.customerDues)} sub="Amount owed by customers"
            icon={Users} iconBg="bg-blue-500/10" iconColor="text-blue-400" color="text-blue-400"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Bar chart */}
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5">
          <p className="text-sm font-semibold text-slate-300 mb-4">Financial Overview</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tickFormatter={(v) => fmt(v)} tick={{ fill: '#64748b', fontSize: 10 }} width={50} />
              <Tooltip
                formatter={(v) => fmtFull(v)}
                contentStyle={{ background: '#0f2740', border: '1px solid #1e3a5f', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#f1f5f9' }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Deductions pie */}
        {deductionData.length > 0 && (
          <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5">
            <p className="text-sm font-semibold text-slate-300 mb-4">Expense Breakdown</p>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={deductionData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {deductionData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ background: '#0f2740', border: '1px solid #1e3a5f', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#f1f5f9' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
