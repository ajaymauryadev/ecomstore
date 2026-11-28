import { useSavedViewState } from '../../../offline/useSavedViewState';
import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { hasPermission, PERMISSIONS } from '../../../constants/permissions';
import {
  Receipt, Plus, Trash2, Pencil,
  Home, Zap, Truck, Package, Users, AlertTriangle, Wrench, Megaphone, MoreHorizontal,
} from 'lucide-react';
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
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDate(d, timeZone) {
  return new Date(d).toLocaleString('en-IN', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const emptyForm = (timeZone) => ({
  category: 'rent', name: '', paidTo: '', amount: '', method: 'cash', description: '', date: accountingDate(undefined, timeZone), receiptUrl: '',
});

export default function ExpensesPage() {
  const { store, user } = useAuth();
  const canManage = hasPermission(user, PERMISSIONS.ACCOUNTING_MANAGE);
  const [route, setRoute] = useSearchParams();
  const routeDate = route.get('date');
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const today = accountingDate(undefined, timeZone);
  const firstOfMonth = today.slice(0, 8) + '01';

  const [customStart, setStartDate] = useSavedViewState('expenses-start-custom', '');
  const startDate = routeDate || customStart || firstOfMonth;
  const [customEnd, setEndDate] = useSavedViewState('expenses-end-custom', '');
  const endDate = routeDate || customEnd || today;
  const [filterCat, setFilterCat] = useSavedViewState('ExpensesPage:ExpensesPage:filterCat', '');
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const settledSearch = useDebouncedValue(search.trim(), 300);
  const [showModal, setShowModal] = useState(() => canManage && route.get('new') === '1');
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState(() => ({ ...emptyForm(timeZone), date: routeDate || today, operationId: crypto.randomUUID() }));

  const expenseId = route.get('expense') || undefined;
  const paging = usePagination(`${startDate}:${endDate}:${filterCat}:${method}:${settledSearch}:${expenseId ?? ''}`, 'compact');
  const filters = { startDate, endDate, category: expenseId ? undefined : filterCat || undefined,
    method: expenseId ? undefined : method || undefined, search: expenseId ? undefined : settledSearch || undefined, expense: expenseId };
  const params = { ...filters, page: paging.page, limit: paging.limit };
  const { data: listData, isLoading, isFetching, isError, refetch } = useGetExpensesQuery(params);
  const { data: statsData } = useGetExpenseStatsQuery(filters);

  const [createExpense, { isLoading: creating }] = useCreateExpenseMutation();
  const [updateExpense, { isLoading: updating }] = useUpdateExpenseMutation();
  const [deleteExpense] = useDeleteExpenseMutation();

  const expenses = listData?.data ?? [];
  const stats = statsData?.data ?? {};
  const openCreate = () => {
    setEditingExpense(null);
    setForm({ ...emptyForm(timeZone), date: routeDate || today, operationId: crypto.randomUUID() });
    setShowModal(true);
  };

  const openEdit = (exp) => {
    setEditingExpense(exp);
    setForm({
      category: exp.category,
      name: exp.name ?? '',
      paidTo: exp.paidTo ?? '',
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
        if (payload.date === accountingDate(editingExpense.date, timeZone)) delete payload.date;
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
    if (!confirm('Archive this expense?')) return;
    try {
      await deleteExpense(id).unwrap();
      toast.success('Expense archived');
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
        {canManage && <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Add Expense
        </button>}
      </div>

      {/* Date filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">From</span>
          <input aria-label="From date" type="date" value={startDate} onChange={(e) => { setRoute({}); setStartDate(e.target.value); }} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <div className="flex items-center gap-2 bg-navy-800 border border-navy-700/40 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-500">To</span>
          <input aria-label="To date" type="date" value={endDate} onChange={(e) => { setRoute({}); setEndDate(e.target.value); }} className="bg-transparent text-sm text-slate-200 outline-none" />
        </div>
        <select
          aria-label="Expense category"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="input py-2"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0" type="search" aria-label="Search expenses" placeholder="Search expenses" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" aria-label="Filter payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All payment methods</option>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          <option value="unrecorded">Method unrecorded</option>
        </select>
        <button type="button" className="btn-secondary" onClick={() => { setRoute({}); setStartDate(''); setEndDate(''); setFilterCat(''); setMethod(''); setSearch(''); }}>This month</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Total Expenses', stats.total], ['Cash Expenses', stats.cash], ['Online / Bank', stats.online], ['Transactions', stats.count]].map(([label, value]) => (
          <div key={label} className="card p-4"><p className="text-sm text-slate-500">{label}</p>
            <strong className="text-lg">{value == null ? '—' : label === 'Transactions' ? value : fmt(value)}</strong></div>
        ))}
      </div>
      <section aria-label="Expense Records">
          <div className="bg-navy-800 border border-navy-700/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-navy-700/40">
              <p className="text-sm font-semibold text-slate-300">Expense Records</p>
            </div>
            {isError && <div className="p-4" role="status">
              {listData && <p className="mb-2 text-sm text-slate-500">Showing saved expenses.</p>}
              <button className="btn-secondary" onClick={refetch}>Retry expense download</button>
            </div>}
            {isLoading ? (
              <div className="space-y-4 p-4" role="status" aria-label="Loading expenses">
                {[0, 1, 2].map((row) => <div key={row} className="h-12 rounded-lg bg-navy-700/40" />)}
              </div>
            ) : isError && !listData ? null : expenses.length === 0 ? (
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
                          {exp.name || exp.description || cat?.label || exp.category}
                        </p>
                        <p className="text-xs text-slate-500">
                          {cat?.label} · {fmtDate(exp.date, timeZone)} · {PAYMENT_METHOD_LABELS[exp.method] ?? 'Method unrecorded'}
                        </p>
                        {exp.paidTo && <p className="text-sm">Paid to {exp.paidTo}</p>}
                        {exp.name && exp.description && <p className="text-sm">{exp.description}</p>}
                        {exp.recordedByName && <p className="text-xs text-slate-500">Recorded by {exp.recordedByName}</p>}
                      </div>
                      <p className="text-sm font-bold text-red-400 shrink-0">{fmt(exp.amount)}</p>
                      {canManage && <div className="flex gap-1 shrink-0">
                        <button aria-label="Edit expense" onClick={() => openEdit(exp)} className="p-1.5 hover:bg-navy-600 rounded-lg text-slate-400 hover:text-gold-400 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button aria-label="Archive expense" onClick={() => handleDelete(exp._id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-slate-400 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </section>

      <Pagination meta={listData?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} label="expenses" />
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingExpense ? 'Edit Expense' : 'Add Expense'} size="md">
            <div className="space-y-4">
              <label className="block text-sm">Expense name<input className="input block w-full" maxLength={120} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label className="block text-sm">Paid to<input className="input block w-full" maxLength={120} value={form.paidTo} onChange={(e) => setForm((p) => ({ ...p, paidTo: e.target.value }))} /></label>
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
