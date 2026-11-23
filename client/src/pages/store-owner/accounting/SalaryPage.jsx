import { useState } from 'react';
import {
  Users, Plus, X, CheckCircle2, Clock, AlertTriangle,
  ChevronDown, CreditCard, Banknote, Smartphone,
} from 'lucide-react';
import {
  useGetSalaryRecordsQuery,
  useGetSalaryStatsQuery,
  useGetStaffListQuery,
  useUpsertSalaryRecordMutation,
  useRecordSalaryPaymentMutation,
} from '../../../features/salary/salaryApi';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';

function fmt(n) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const STATUS_CONFIG = {
  paid: { label: 'Paid', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  partial: { label: 'Partial', color: 'text-gold-400 bg-gold-500/10 border-gold-500/20', icon: Clock },
  unpaid: { label: 'Unpaid', color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: AlertTriangle },
};

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'upi', label: 'UPI', icon: Smartphone },
  { value: 'bank_transfer', label: 'Bank', icon: CreditCard },
];

function getMonthYears(count = 12) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    });
  }
  return result;
}

const MONTHS = getMonthYears();
const currentMonth = MONTHS[0].value;

export default function SalaryPage() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(null);
  const [addForm, setAddForm] = useState({ staffId: '', monthlySalary: '', notes: '' });
  const [payForm, setPayForm] = useState({ amount: '', type: 'salary', method: 'cash', note: '' });

  const { data: listData, isLoading } = useGetSalaryRecordsQuery({ monthYear: selectedMonth });
  const { data: statsData } = useGetSalaryStatsQuery({ monthYear: selectedMonth });
  const { data: staffData } = useGetStaffListQuery();

  const [upsert, { isLoading: upserting }] = useUpsertSalaryRecordMutation();
  const [recordPayment, { isLoading: paying }] = useRecordSalaryPaymentMutation();

  const records = listData?.data ?? [];
  const stats = statsData?.data ?? {};
  const staffList = staffData?.data?.staff ?? [];

  const handleAddRecord = async () => {
    if (!addForm.staffId || !addForm.monthlySalary) return toast.error('Select staff and enter salary');
    try {
      await upsert({ staffId: addForm.staffId, monthYear: selectedMonth, monthlySalary: Number(addForm.monthlySalary), notes: addForm.notes }).unwrap();
      toast.success('Salary record created');
      setShowAddModal(false);
      setAddForm({ staffId: '', monthlySalary: '', notes: '' });
    } catch (e) {
      toast.error(e?.data?.message || 'Failed');
    }
  };

  const handlePayment = async () => {
    if (!payForm.amount || Number(payForm.amount) <= 0) return toast.error('Enter valid amount');
    try {
      await recordPayment({ id: showPayModal._id, ...payForm, amount: Number(payForm.amount) }).unwrap();
      toast.success('Payment recorded');
      setShowPayModal(null);
      setPayForm({ amount: '', type: 'salary', method: 'cash', note: '' });
    } catch (e) {
      toast.error(e?.data?.message || 'Failed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Staff Salary</h1>
          <p className="text-sm text-slate-500 mt-1">Manage monthly salary & advances</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="input pr-8 appearance-none"
            >
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Add Record
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Salary', value: fmt(stats.totalSalary), color: 'text-slate-100' },
          { label: 'Total Paid', value: fmt(stats.totalPaid), color: 'text-emerald-400' },
          { label: 'Total Due', value: fmt(stats.totalDue), color: 'text-red-400' },
          { label: 'Staff Count', value: stats.staffCount ?? 0, color: 'text-gold-400' },
        ].map((s) => (
          <div key={s.label} className="bg-navy-800 border border-navy-700/60 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{s.label}</p>
            <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Records */}
      <div className="bg-navy-800 border border-navy-700/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-700/40 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-300">Salary Records</p>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Paid: {stats.paidCount ?? 0}</span>
            <span className="px-2 py-0.5 rounded-full bg-gold-500/10 text-gold-400">Partial: {stats.partialCount ?? 0}</span>
            <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Unpaid: {stats.unpaidCount ?? 0}</span>
          </div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center">
            <Users size={40} className="mx-auto text-slate-600 mb-2" />
            <p className="text-slate-500 text-sm">No salary records for this month</p>
            <button onClick={() => setShowAddModal(true)} className="mt-3 text-gold-400 text-sm hover:text-gold-300">Add record →</button>
          </div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {records.map((rec) => {
              const cfg = STATUS_CONFIG[rec.status];
              const StatusIcon = cfg.icon;
              const dueAmount = Math.max(0, rec.monthlySalary - rec.totalPaid);
              return (
                <div key={rec._id} className="flex items-center gap-4 px-4 py-4 hover:bg-navy-700/20 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-gold-400">{rec.staffName[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-200">{rec.staffName}</p>
                    <p className="text-xs text-slate-500">{rec.staffPhone || 'No phone'}</p>
                    {rec.advancePaid > 0 && (
                      <p className="text-xs text-gold-400 mt-0.5">Advance: {fmt(rec.advancePaid)}</p>
                    )}
                  </div>
                  <div className="text-center hidden sm:block">
                    <p className="text-xs text-slate-500">Monthly</p>
                    <p className="text-sm font-semibold text-slate-200">{fmt(rec.monthlySalary)}</p>
                  </div>
                  <div className="text-center hidden sm:block">
                    <p className="text-xs text-slate-500">Paid</p>
                    <p className="text-sm font-semibold text-emerald-400">{fmt(rec.totalPaid)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Due</p>
                    <p className={cn('text-sm font-bold', dueAmount > 0 ? 'text-red-400' : 'text-emerald-400')}>{fmt(dueAmount)}</p>
                  </div>
                  <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border flex items-center gap-1', cfg.color)}>
                    <StatusIcon size={11} /> {cfg.label}
                  </span>
                  {rec.status !== 'paid' && (
                    <button
                      onClick={() => { setShowPayModal(rec); setPayForm({ amount: String(dueAmount), type: 'salary', method: 'cash', note: '' }); }}
                      className="btn-primary text-xs px-3 py-1.5 shrink-0"
                    >
                      Pay
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Record Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-navy-800 border border-navy-700/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg text-slate-100">Add Salary Record</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-500"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">Staff Member *</label>
                <select className="input w-full" value={addForm.staffId} onChange={(e) => setAddForm((p) => ({ ...p, staffId: e.target.value }))}>
                  <option value="">Select staff...</option>
                  {staffList.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.role})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Monthly Salary (₹) *</label>
                <input type="number" className="input w-full" placeholder="0" value={addForm.monthlySalary} onChange={(e) => setAddForm((p) => ({ ...p, monthlySalary: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input w-full" placeholder="Optional notes" value={addForm.notes} onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 btn-secondary">Cancel</button>
              <button onClick={handleAddRecord} disabled={upserting} className="flex-1 btn-primary">{upserting ? 'Saving...' : 'Add Record'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPayModal(null)} />
          <div className="relative bg-navy-800 border border-navy-700/60 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-lg text-slate-100">Record Payment</h3>
                <p className="text-sm text-slate-500">{showPayModal.staffName}</p>
              </div>
              <button onClick={() => setShowPayModal(null)} className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-500"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">Payment Type</label>
                <div className="flex gap-2">
                  {['salary', 'advance', 'bonus'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setPayForm((p) => ({ ...p, type: t }))}
                      className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize', payForm.type === t ? 'bg-gold-500/20 text-gold-400 border-gold-500/30' : 'bg-navy-700 text-slate-400 border-navy-600 hover:border-navy-500')}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Amount (₹) *</label>
                <input type="number" className="input w-full" value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Payment Method</label>
                <div className="flex gap-2">
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.value}
                        onClick={() => setPayForm((p) => ({ ...p, method: m.value }))}
                        className={cn('flex-1 py-2 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1', payForm.method === m.value ? 'bg-gold-500/20 text-gold-400 border-gold-500/30' : 'bg-navy-700 text-slate-400 border-navy-600 hover:border-navy-500')}
                      >
                        <Icon size={14} /> {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="label">Note</label>
                <input className="input w-full" placeholder="Optional note" value={payForm.note} onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPayModal(null)} className="flex-1 btn-secondary">Cancel</button>
              <button onClick={handlePayment} disabled={paying} className="flex-1 btn-primary">{paying ? 'Saving...' : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
