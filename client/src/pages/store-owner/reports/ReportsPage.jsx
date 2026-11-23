import { useState } from 'react';
import LoadError from '../../../components/ui/LoadError';
import {
  BarChart2, ShoppingCart, Package, Layers, Warehouse, Truck, Users,
  DollarSign, Receipt, TrendingUp, RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, PieChart, Pie,
} from 'recharts';
import {
  useGetDailySalesQuery,
  useGetMonthlySalesQuery,
  useGetYearlySalesQuery,
  useGetProductSalesQuery,
  useGetCategorySalesQuery,
  useGetStockReportQuery,
  useGetSupplierDuesReportQuery,
  useGetCustomerDuesReportQuery,
  useGetExpenseReportQuery,
  useGetSalaryReportQuery,
  useGetPurchaseReportQuery,
} from '../../../features/reports/reportsApi';
import { cn } from '../../../utils/cn';
import { accountingDate, resolveStoreTimeZone } from '../../../utils/accounting';
import { useAuth } from '../../../hooks/useAuth';

function fmt(n) {
  const abs = Math.abs(n ?? 0);
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(abs / 1000).toFixed(1)}K`;
  return `₹${abs.toLocaleString('en-IN')}`;
}
function fmtFull(n) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const REPORT_TABS = [
  { id: 'daily', label: 'Daily Sales', icon: BarChart2 },
  { id: 'monthly', label: 'Monthly', icon: TrendingUp },
  { id: 'yearly', label: 'Yearly', icon: TrendingUp },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'categories', label: 'Categories', icon: Layers },
  { id: 'stock', label: 'Stock', icon: Warehouse },
  { id: 'purchases', label: 'Purchases', icon: ShoppingCart },
  { id: 'supplier-dues', label: 'Supplier Dues', icon: Truck },
  { id: 'customer-dues', label: 'Customer Dues', icon: Users },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'salary', label: 'Salary', icon: DollarSign },
];

const CHART_COLORS = ['#174cd0', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316'];

const tooltipStyle = {
  contentStyle: { background: '#0f2740', border: '1px solid #1e3a5f', borderRadius: 8 },
  labelStyle: { color: '#94a3b8' },
  itemStyle: { color: '#f1f5f9' },
};

function SectionCard({ title, children, className }) {
  return (
    <div className={cn('bg-navy-800 border border-navy-700/60 rounded-xl overflow-hidden', className)}>
      {title && <div className="px-4 py-3 border-b border-navy-700/40"><p className="text-sm font-semibold text-slate-300">{title}</p></div>}
      {children}
    </div>
  );
}

// --- Sub-reports ---

function DailySalesReport({ timeZone }) {
  const today = accountingDate(undefined, timeZone);
  const [date, setDate] = useState(today);
  const { data, isLoading, isError, error, refetch } = useGetDailySalesQuery({ date });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const hours = data?.data?.hours ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" aria-label="Sales date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        <button onClick={refetch} aria-label="Refresh report" className="p-2.5 bg-navy-700 border border-navy-600 rounded-xl text-slate-400 hover:text-gold-400"><RefreshCw size={16} /></button>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-bold text-gold-400">{fmtFull(total)}</p>
        </div>
      </div>
      <SectionCard>
        <div className="p-4">
          {isLoading ? <p className="text-center text-slate-500 py-8">Loading...</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hours} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tickFormatter={fmt} tick={{ fill: '#64748b', fontSize: 10 }} width={50} />
                <Tooltip {...tooltipStyle} formatter={(v) => fmtFull(v)} labelFormatter={(l) => `Hour: ${l}`} />
                <Bar dataKey="sales" fill="var(--brand-blue)" radius={[3, 3, 0, 0]} name="Sales" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </SectionCard>
      <SectionCard title="Hourly Breakdown">
        <div className="divide-y divide-navy-700/40 max-h-80 overflow-y-auto">
          {hours.filter((h) => h.sales > 0).map((h) => (
            <div key={h.hour} className="flex items-center justify-between px-4 py-2.5">
              <p className="text-sm text-slate-400">{h.label}</p>
              <div className="text-right">
                <p className="text-sm font-semibold text-gold-400">{fmtFull(h.sales)}</p>
                <p className="text-xs text-slate-500">{h.orders} orders</p>
              </div>
            </div>
          ))}
          {hours.every((h) => h.sales === 0) && <p className="text-center text-slate-500 text-sm py-6">No sales on this day</p>}
        </div>
      </SectionCard>
    </div>
  );
}

function MonthlySalesReport({ timeZone }) {
  const [currentYear, currentMonth] = accountingDate(undefined, timeZone).split('-').map(Number);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth - 1);
  const { data, isLoading, isError, error, refetch } = useGetMonthlySalesQuery({ year, month });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const days = data?.data?.days ?? [];
  const total = data?.data?.total ?? 0;

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="input">
          {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="input w-24" min="2020" max="2030" />
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-bold text-gold-400">{fmtFull(total)}</p>
        </div>
      </div>
      <SectionCard>
        <div className="p-4">
          {isLoading ? <p className="text-center text-slate-500 py-8">Loading...</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={days} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--brand-blue)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--brand-blue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tickFormatter={fmt} tick={{ fill: '#64748b', fontSize: 10 }} width={50} />
                <Tooltip {...tooltipStyle} formatter={(v) => fmtFull(v)} labelFormatter={(l) => `Day ${l}`} />
                <Area type="monotone" dataKey="sales" stroke="var(--brand-blue)" strokeWidth={2} fill="url(#salesGrad)" name="Sales" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function YearlySalesReport({ timeZone }) {
  const [year, setYear] = useState(() => Number(accountingDate(undefined, timeZone).slice(0, 4)));
  const { data, isLoading, isError, error, refetch } = useGetYearlySalesQuery({ year });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const months = data?.data?.months ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="input w-28" min="2020" max="2030" />
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Annual Total</p>
          <p className="text-xl font-bold text-gold-400">{fmtFull(total)}</p>
        </div>
      </div>
      <SectionCard>
        <div className="p-4">
          {isLoading ? <p className="text-center text-slate-500 py-8">Loading...</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={months} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tickFormatter={fmt} tick={{ fill: '#64748b', fontSize: 10 }} width={55} />
                <Tooltip {...tooltipStyle} formatter={(v) => fmtFull(v)} />
                <Bar dataKey="sales" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} name="Sales" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function ProductSalesReport({ timeZone }) {
  const today = accountingDate(undefined, timeZone);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const { data, isLoading, isError, error, refetch } = useGetProductSalesQuery({ startDate, endDate, limit: 20 });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const products = data?.data?.products ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
      </div>
      <SectionCard title="Top 20 Products by Revenue">
        {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : products.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No sales data</div>
        ) : (
          <>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={products.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 10, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmt} tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis type="category" dataKey="productName" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
                  <Tooltip {...tooltipStyle} formatter={(v) => fmtFull(v)} />
                  <Bar dataKey="totalRevenue" fill="var(--brand-blue)" radius={[0, 4, 4, 0]} name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="divide-y divide-navy-700/40 max-h-80 overflow-y-auto">
              {products.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-bold text-slate-600 w-5 shrink-0">#{i + 1}</span>
                  <p className="flex-1 text-sm text-slate-200 truncate">{p.productName}</p>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gold-400">{fmtFull(p.totalRevenue)}</p>
                    <p className="text-xs text-slate-500">{p.totalQty} units</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

function CategorySalesReport({ timeZone }) {
  const today = accountingDate(undefined, timeZone);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const { data, isLoading, isError, error, refetch } = useGetCategorySalesQuery({ startDate, endDate });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const categories = data?.data?.categories ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        {!isLoading && categories.length > 0 && (
          <SectionCard title="Sales Distribution">
            <div className="p-4">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={categories} cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={3} dataKey="totalRevenue" nameKey="categoryName">
                    {categories.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(v) => fmtFull(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}
        <SectionCard title="Category Breakdown">
          {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : categories.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No data</div>
          ) : (
            <div className="divide-y divide-navy-700/40">
              {categories.map((c, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <p className="flex-1 text-sm text-slate-200">{c.categoryEmoji} {c.categoryName || 'Uncategorized'}</p>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gold-400">{fmtFull(c.totalRevenue)}</p>
                    <p className="text-xs text-slate-500">{c.totalQty} units</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function StockReport() {
  const { data, isLoading, isError, error, refetch } = useGetStockReportQuery({});
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const products = data?.data ?? [];

  return (
    <SectionCard title="Current Stock Levels">
      {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : (
        <div className="divide-y divide-navy-700/40 max-h-[500px] overflow-y-auto">
          {products.map((p) => (
            <div key={p._id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{p.name}</p>
                <p className="text-xs text-slate-500">{p.category?.emoji} {p.category?.name}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-200">{p.totalStock ?? 0} units</p>
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                  p.stockStatus === 'in_stock' ? 'bg-emerald-500/10 text-emerald-400' :
                  p.stockStatus === 'low' ? 'bg-gold-500/10 text-gold-400' :
                  'bg-red-500/10 text-red-400'
                )}>
                  {p.stockStatus?.replace('_', ' ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SupplierDuesReport() {
  const { data, isLoading, isError, error, refetch } = useGetSupplierDuesReportQuery();
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const suppliers = data?.data?.suppliers ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Total Supplier Dues</p>
        <p className="text-2xl font-bold text-red-400">{fmtFull(total)}</p>
      </div>
      <SectionCard title="Suppliers with Pending Dues">
        {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : suppliers.length === 0 ? (
          <div className="p-8 text-center text-emerald-400 text-sm">All supplier payments clear!</div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {suppliers.map((s) => (
              <div key={s._id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-400">{fmtFull(s.pendingAmount)}</p>
                  <p className="text-xs text-slate-500">Total: {fmtFull(s.totalPurchased)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function CustomerDuesReport() {
  const { data, isLoading, isError, error, refetch } = useGetCustomerDuesReportQuery();
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const customers = data?.data?.customers ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Total Customer Dues</p>
        <p className="text-2xl font-bold text-blue-400">{fmtFull(total)}</p>
      </div>
      <SectionCard title="Customers with Outstanding Dues">
        {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : customers.length === 0 ? (
          <div className="p-8 text-center text-emerald-400 text-sm">No outstanding customer dues!</div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {customers.map((c) => (
              <div key={c._id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.phone || 'No phone'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-blue-400">{fmtFull(c.balance)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ExpenseReport({ timeZone }) {
  const today = accountingDate(undefined, timeZone);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const { data, isLoading, isError, error, refetch } = useGetExpenseReportQuery({ startDate, endDate });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const byCategory = data?.data?.byCategory ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-bold text-red-400">{fmtFull(total)}</p>
        </div>
      </div>
      <SectionCard title="Category Breakdown">
        {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : byCategory.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No expenses in this period</div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {byCategory.map((b, i) => (
              <div key={b._id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <p className="flex-1 text-sm text-slate-200 capitalize">{b._id.replace('_', ' ')}</p>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-400">{fmtFull(b.total)}</p>
                  <p className="text-xs text-slate-500">{b.count} entries</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function SalaryReport({ timeZone }) {
  const [monthYear, setMonthYear] = useState(() => accountingDate(undefined, timeZone).slice(0, 7));
  const { data, isLoading, isError, error, refetch } = useGetSalaryReportQuery({ monthYear });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const records = data?.data?.records ?? [];
  const stats = data?.data?.stats ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <input type="month" aria-label="Salary report month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className="input w-full sm:w-auto" />
        <div className="ml-auto flex gap-4 text-right">
          <div><p className="text-xs text-slate-500">Total Salary</p><p className="font-bold text-slate-200">{fmtFull(stats.totalSalary)}</p></div>
          <div><p className="text-xs text-slate-500">Paid</p><p className="font-bold text-emerald-400">{fmtFull(stats.totalPaid)}</p></div>
          <div><p className="text-xs text-slate-500">Due</p><p className="font-bold text-red-400">{fmtFull(stats.totalDue)}</p></div>
        </div>
      </div>
      <SectionCard title="Staff Salary Status">
        {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : records.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No records for this month</div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {records.map((r) => (
              <div key={r._id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200">{r.staffName}</p>
                  <p className="text-xs text-slate-500">{r.staffPhone}</p>
                </div>
                <p className="text-sm text-slate-300">{fmtFull(r.monthlySalary)}</p>
                <span className={cn('text-xs px-2.5 py-0.5 rounded-full border font-medium',
                  r.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  r.status === 'partial' ? 'bg-gold-500/10 text-gold-400 border-gold-500/20' :
                  'bg-red-500/10 text-red-400 border-red-500/20'
                )}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function PurchaseReport({ timeZone }) {
  const today = accountingDate(undefined, timeZone);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const { data, isLoading, isError, error, refetch } = useGetPurchaseReportQuery({ startDate, endDate });
  if (isError) return <LoadError title="Could not load report" error={error} retry={refetch} />;
  const bySupplier = data?.data?.bySupplier ?? [];
  const total = data?.data?.total ?? 0;
  const paid = data?.data?.paid ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="ml-auto flex gap-4 text-right">
          <div><p className="text-xs text-slate-500">Total</p><p className="font-bold text-slate-200">{fmtFull(total)}</p></div>
          <div><p className="text-xs text-slate-500">Paid</p><p className="font-bold text-emerald-400">{fmtFull(paid)}</p></div>
          <div><p className="text-xs text-slate-500">Pending</p><p className="font-bold text-red-400">{fmtFull(total - paid)}</p></div>
        </div>
      </div>
      <SectionCard title="By Supplier">
        {isLoading ? <div className="p-8 text-center text-slate-500">Loading...</div> : bySupplier.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No purchases in this period</div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {bySupplier.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200">{s.supplierName}</p>
                  <p className="text-xs text-slate-500">{s.count} purchases</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-200">{fmtFull(s.totalAmount)}</p>
                  <p className="text-xs text-emerald-400">Paid: {fmtFull(s.paidAmount)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

const REPORT_COMPONENTS = {
  daily: DailySalesReport,
  monthly: MonthlySalesReport,
  yearly: YearlySalesReport,
  products: ProductSalesReport,
  categories: CategorySalesReport,
  stock: StockReport,
  purchases: PurchaseReport,
  'supplier-dues': SupplierDuesReport,
  'customer-dues': CustomerDuesReport,
  expenses: ExpenseReport,
  salary: SalaryReport,
};

export default function ReportsPage() {
  const { store } = useAuth();
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const [activeTab, setActiveTab] = useState('daily');
  const ActiveReport = REPORT_COMPONENTS[activeTab];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Business dates in {timeZone}</p>
      </div>

      {/* Tab navigation - horizontal scroll */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Report selection">
        {REPORT_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              aria-pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex min-h-11 items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors border shrink-0',
                activeTab === tab.id
                  ? 'bg-gold-500/20 text-gold-400 border-gold-500/30'
                  : 'bg-navy-800 text-slate-400 border-navy-700/40 hover:border-navy-600 hover:text-slate-300'
              )}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active report */}
      {ActiveReport && <ActiveReport timeZone={timeZone} />}
    </div>
  );
}
