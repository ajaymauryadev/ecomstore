import { useState } from 'react';
import { Plus, Edit2, Trash2, Tag, Copy, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetCouponsQuery, useCreateCouponMutation, useUpdateCouponMutation, useDeleteCouponMutation } from '../../../features/coupons/couponsApi';
import { format } from 'date-fns';
import { cn } from '../../../utils/cn';
import Modal from '../../../components/ui/Modal';

const EMPTY = {
  code: '', description: '', type: 'flat', value: '', maxDiscount: '',
  minOrderValue: '', usageLimitTotal: '', usageLimitPerUser: 1,
  applicableOrderTypes: [], isActive: true,
  startsAt: '', expiresAt: '',
};

const ORDER_TYPES = ['home_delivery', 'self_pickup', 'online', 'counter', 'wholesale'];

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function CouponsPage() {
  const { data, isLoading } = useGetCouponsQuery();
  const [create] = useCreateCouponMutation();
  const [update] = useUpdateCouponMutation();
  const [del] = useDeleteCouponMutation();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [copiedCode, setCopiedCode] = useState(null);

  const coupons = data?.data?.coupons ?? [];

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const openNew = () => { setForm(EMPTY); setEditId(null); setShowForm(true); };
  const openEdit = (c) => {
    setForm({
      code: c.code, description: c.description || '', type: c.type, value: c.value,
      maxDiscount: c.maxDiscount || '', minOrderValue: c.minOrderValue || 0,
      usageLimitTotal: c.usageLimitTotal || '', usageLimitPerUser: c.usageLimitPerUser ?? 1,
      applicableOrderTypes: c.applicableOrderTypes || [], isActive: c.isActive,
      startsAt: c.startsAt ? c.startsAt.slice(0, 16) : '',
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 16) : '',
    });
    setEditId(c._id);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      value: Number(form.value),
      maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : undefined,
      minOrderValue: Number(form.minOrderValue) || 0,
      usageLimitTotal: form.usageLimitTotal ? Number(form.usageLimitTotal) : undefined,
      usageLimitPerUser: Number(form.usageLimitPerUser) || 1,
      startsAt: form.startsAt || undefined,
      expiresAt: form.expiresAt || undefined,
    };
    try {
      if (editId) await update({ id: editId, ...payload }).unwrap();
      else await create(payload).unwrap();
      toast.success(editId ? 'Coupon updated' : 'Coupon created');
      setShowForm(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save coupon');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this coupon?')) return;
    try { await del(id).unwrap(); toast.success('Deleted'); } catch { toast.error('Delete failed'); }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const toggleOrderType = (t) => {
    set('applicableOrderTypes', form.applicableOrderTypes.includes(t)
      ? form.applicableOrderTypes.filter((x) => x !== t)
      : [...form.applicableOrderTypes, t]
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Coupons</h1>
          <p className="text-slate-500 text-sm mt-1">{coupons.length} coupon{coupons.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          <Plus size={16} /> Add Coupon
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-16 text-slate-500">Loading...</div>
      ) : coupons.length === 0 ? (
        <div className="card p-16 text-center">
          <Tag size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No coupons yet. Create your first one!</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coupons.map((c) => {
            const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
            return (
              <div key={c._id} className={cn('card p-4 space-y-3', !c.isActive && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-gold-400 text-base">{c.code}</span>
                      <button onClick={() => copyCode(c.code)} className="text-slate-500 hover:text-slate-300">
                        {copiedCode === c.code ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                    {c.description && <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-400 hover:text-gold-400">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(c._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge bg-gold-500/20 text-gold-400 border border-gold-500/20">
                    {c.type === 'percent' ? `${c.value}% OFF` : `₹${c.value} OFF`}
                  </span>
                  {c.maxDiscount && <span className="badge bg-navy-700 text-slate-400 border border-navy-600">Max ₹{c.maxDiscount}</span>}
                  <span className={cn('badge border', c.isActive && !expired ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20')}>
                    {expired ? 'Expired' : c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="text-xs text-slate-500 space-y-0.5">
                  {c.minOrderValue > 0 && <p>Min order: ₹{c.minOrderValue}</p>}
                  <p>Used: {c.usedCount}{c.usageLimitTotal ? ` / ${c.usageLimitTotal}` : ''} times</p>
                  {c.expiresAt && <p>Expires: {format(new Date(c.expiresAt), 'dd MMM yyyy')}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit Coupon' : 'Create Coupon'} size="lg">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Code */}
              <div>
                <label className="label">Coupon Code</label>
                <div className="flex gap-2">
                  <input className="input flex-1 font-mono uppercase" placeholder="e.g. SAVE50" value={form.code}
                    onChange={(e) => set('code', e.target.value.toUpperCase())} required />
                  <button type="button" onClick={() => set('code', generateCode())} className="btn-secondary px-3 py-2 text-xs whitespace-nowrap">
                    Generate
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Description (optional)</label>
                <input className="input" placeholder="Brief description" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </div>

              {/* Type + Value */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Discount Type</label>
                  <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
                    <option value="flat">Flat (₹)</option>
                    <option value="percent">Percent (%)</option>
                  </select>
                </div>
                <div>
                  <label className="label">{form.type === 'percent' ? 'Percentage' : 'Amount (₹)'}</label>
                  <input className="input" type="number" min="0" placeholder={form.type === 'percent' ? '10' : '50'} value={form.value} onChange={(e) => set('value', e.target.value)} required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {form.type === 'percent' && (
                  <div>
                    <label className="label">Max Discount (₹)</label>
                    <input className="input" type="number" min="0" placeholder="e.g. 200" value={form.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="label">Min Order Value (₹)</label>
                  <input className="input" type="number" min="0" placeholder="0" value={form.minOrderValue} onChange={(e) => set('minOrderValue', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Total Usage Limit</label>
                  <input className="input" type="number" min="1" placeholder="Unlimited" value={form.usageLimitTotal} onChange={(e) => set('usageLimitTotal', e.target.value)} />
                </div>
                <div>
                  <label className="label">Per-User Limit</label>
                  <input className="input" type="number" min="1" placeholder="1" value={form.usageLimitPerUser} onChange={(e) => set('usageLimitPerUser', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Date</label>
                  <input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
                </div>
                <div>
                  <label className="label">Expiry Date</label>
                  <input className="input" type="datetime-local" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
                </div>
              </div>

              {/* Applicable order types */}
              <div>
                <label className="label">Applicable Order Types (leave empty = all)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ORDER_TYPES.map((t) => (
                    <button key={t} type="button"
                      onClick={() => toggleOrderType(t)}
                      className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-colors', form.applicableOrderTypes.includes(t) ? 'bg-gold-500/20 text-gold-400 border-gold-500/30' : 'bg-navy-700 text-slate-400 border-navy-600 hover:border-navy-500')}>
                      {t.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between">
                <label className="label mb-0">Active</label>
                <button type="button" onClick={() => set('isActive', !form.isActive)} aria-label={form.isActive ? 'Deactivate coupon' : 'Activate coupon'} aria-pressed={form.isActive} className="min-w-11 min-h-11 flex items-center justify-center">
                  {form.isActive ? <ToggleRight size={28} className="text-gold-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1">{editId ? 'Update' : 'Create'}</button>
              </div>
            </form>
      </Modal>
    </div>
  );
}
