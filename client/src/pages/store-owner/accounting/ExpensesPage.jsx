import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import {
  Receipt, Plus, Trash2, Pencil, TrendingDown,
  Home, Zap, Truck, Package, Users, AlertTriangle, Wrench, Megaphone, MoreHorizontal,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  useGetExpensesQuery,
  useGetExpenseStatsQuery,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
  useDeleteExpenseMutation,
} from '../../../features/expenses/expenseApi';
import toast from 'react-hot-toast';
import Modal from '../../../components/ui/Modal';
import { accountingDate, resolveStoreTimeZone, PAYMENT_METHOD_LABELS } from '../../../utils/accounting';
import { useAuth } from '../../../hooks/useAuth';

const CATEGORIES = [
  { value: 'rent', label: 'Rent', icon: Home, color: '#6366f1' },
  { value: 'electricity', label: 'Electricity', icon: Zap, color: '#f59e0b' },
  { value: 'transport', label: 'Transport', icon: Truck, color: '#3b82f6' },
  { value: 'packaging', label: 'Packaging', icon: Package, color: '#10b981' },
  { value: 'staff_salary', label: 'Staff Salary', icon: Users, color: '#8b5cf6' },
  { value: 'damage_loss', label: 'Damage/Loss', icon: AlertTriangle, color: '#ef4444' },
  { value: 'maintenance', label: 'Maintenance', icon: Wrench, color: '#06b6d4' },
  { value: 'marketing', label: 'Marketing', icon: Megaphone, color: '#f97316' },
  { value: 'other', label: 'Other', icon: MoreHorizontal, color: '#94a3b8' },
];

const catMap = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

function fmt(n) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtDate(d, timeZone) {
  return new Date(d).toLocaleDateString('en-IN', { timeZone, day: 'numeric', month: 'short' });
}

const emptyForm = (timeZone) => ({
  category: 'rent', amount: '', method: 'cash', description: '', date: accountingDate(undefined, timeZone), receiptUrl: '',
});

export default function ExpensesPage() {
  const { store } = useAuth();
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const today = accountingDate(undefined, timeZone);
  const firstOfMonth = today.slice(0, 8) + '01';

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [filterCat, setFilterCat] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState(() => emptyForm(timeZone));

  const paging = usePagination(`${startDate}:${endDate}:${filterCat}`, 'compact');
  const params = { page: paging.page, limit: paging.limit, startDate, endDate, category: filterCat || undefined };
  const { data: listData, isLoading, isFetching } = useGetExpensesQuery(params);
  const { data: statsData } = useGetExpenseStatsQuery({ startDate, endDate });

  const [createExpense, { isLoading: creating }] = useCreateExpenseMutation();
  const [updateExpense, { isLoading: updating }] = useUpdateExpenseMutation();
  const [deleteExpense] = useDeleteExpenseMutation();

  const expenses = listData?.data ?? [];
  const stats = statsData?.data ?? {};
  const byCategory = stats.byCategory ?? [];

  const pieData = byCategory.map((b) => ({
    name: catMap[b._id]?.label ?? b._id,
    value: b.total,
    color: catMap[b._id]?.color ?? '#94a3b8',
  }));

  const openCreate = () => {
    setEditingExpense(null);
    setForm(emptyForm(timeZone));
    setShowModal(true);
  };

  const openEdit = (exp) => {
    setEditingExpense(exp);
    setForm({
      category: exp.category,
      amount: exp.amount.toString(),
      method: exp.method ?? '',
      description: exp.description || '',
      date: accountingDate(exp.date, timeZone),
      receiptUrl: exp.receiptUrl || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Enter valid amount');
    try {
      const payload = { ...form, amount: Number(form.amount), method: form.method || undefined };
      if (editingExpense) {
        await updateExpense({ id: editingExpense._id, ...payload }).unwrap();
        toast.success('Expense updated');
      } else {
        await createExpense(payload).unwrap();
        toast.success('Expense added');
      }
      setShowModal(false);
    } catch (e) {
      toast.error(e?.data?.message || 'Failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this expense?')) return;
    try {
      await deleteExpense(id).unwrap();
      toast.success('Deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Expenses</h1>
          <p className="text-sm text-slate-500 mt-1">Track all business expenses</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Add Expense
        </button>
      </div>

      {/* Date filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="input py-2"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: stats + pie */}
        <div className="space-y-4">
          <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total Expenses</p>
              <TrendingDown size={16} className="text-red-400" />
            </div>
            <p className="text-3xl font-bold text-red-400">{fmt(stats.total)}</p>
            <p className="text-xs text-slate-500 mt-1">{stats.count ?? 0} transactions</p>
          </div>

          {pieData.length > 0 && (
            <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">By Category</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: '#0f2740', border: '1px solid #1e3a5f', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#f1f5f9' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {byCategory.map((b) => {
                  const cat = catMap[b._id];
                  return (
                    <div key={b._id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat?.color ?? '#94a3b8' }} />
                        <span className="text-slate-400">{cat?.label ?? b._id}</span>
                      </div>
                      <span className="font-medium text-slate-200">{fmt(b.total)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: expense list */}
        <div className="lg:col-span-2">
          <div className="bg-navy-800 border border-navy-700/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-navy-700/40">
              <p className="text-sm font-semibold text-slate-300">Expense List</p>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
            ) : expenses.length === 0 ? (
              <div className="p-12 text-center">
                <Receipt size={40} className="mx-auto text-slate-600 mb-2" />
                <p className="text-slate-500 text-sm">No expenses in this period</p>
              </div>
            ) : (
              <div className="divide-y divide-navy-700/40 max-h-[500px] overflow-y-auto">
                {expenses.map((exp) => {
                  const cat = catMap[exp.category];
                  const Icon = cat?.icon ?? MoreHorizontal;
                  return (
                    <div key={exp._id} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-700/30 transition-colors group">
                      <div className="p-2 rounded-lg shrink-0" style={{ background: `${cat?.color ?? '#94a3b8'}20` }}>
                        <Icon size={16} style={{ color: cat?.color ?? '#94a3b8' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">
                          {exp.description || cat?.label || exp.category}
                        </p>
                        <p className="text-xs text-slate-500">
                          {cat?.label} · {fmtDate(exp.date, timeZone)} · {PAYMENT_METHOD_LABELS[exp.method] ?? 'Method unrecorded'}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-red-400 shrink-0">{fmt(exp.amount)}</p>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={() => openEdit(exp)} className="p-1.5 hover:bg-navy-600 rounded-lg text-slate-400 hover:text-gold-400 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(exp._id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-slate-400 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Pagination meta={listData?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} label="expenses" />
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingExpense ? 'Edit Expense' : 'Add Expense'} size="md">
            <div className="space-y-4">
              <div>
                <label htmlFor="expense-category" className="label">Category *</label>
                <select id="expense-category" name="category" className="input w-full" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="expense-amount" className="label">Amount (₹) *</label>
                <input id="expense-amount" name="amount" type="number" min="0.01" step="0.01" className="input w-full" placeholder="0.00" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="expense-method" className="label">Payment Method</label>
                <select id="expense-method" className="input w-full" value={form.method}
                  onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}>
                  {!form.method && <option value="">Method unrecorded</option>}
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) =>
                    <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="expense-description" className="label">Description</label>
                <input id="expense-description" name="description" className="input w-full" placeholder="What for?" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="expense-date" className="label">Date</label>
                <input id="expense-date" name="date" type="date" className="input w-full" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="expense-receipt" className="label">Receipt URL (optional)</label>
                <input id="expense-receipt" name="receiptUrl" type="url" className="input w-full" placeholder="https://..." value={form.receiptUrl} onChange={(e) => setForm((p) => ({ ...p, receiptUrl: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={creating || updating} className="flex-1 btn-primary">
                {creating || updating ? 'Saving...' : editingExpense ? 'Update' : 'Add Expense'}
              </button>
            </div>
      </Modal>
    </div>
  );
}
