import { useClientPagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { useState } from 'react';
import { Plus, Edit2, Trash2, CreditCard, Zap, Check, Package, Crown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetPlansQuery, useCreatePlanMutation, useUpdatePlanMutation, useDeletePlanMutation, useSeedPlansMutation } from '../../features/plans/planApi';
import { cn } from '../../utils/cn';
import Modal from '../../components/ui/Modal';
import { formatCurrency } from '../../utils/formatters';
import { SkeletonCard } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';

const ALL_MODULES = ['pos', 'inventory', 'purchases', 'suppliers', 'packing', 'returns', 'daily_closing', 'accounting', 'reports', 'storefront', 'coupons', 'offers'];

const PLAN_ICONS = { trial: Zap, basic: Package, premium: CreditCard, enterprise: Crown };
const PLAN_COLORS = {
  trial: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  basic: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  premium: 'text-gold-400 bg-gold-500/10 border-gold-500/20',
  enterprise: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
};

const EMPTY = {
  name: 'basic', displayName: '', description: '', price: 0,
  billingCycle: 'monthly', durationDays: 30, trialDays: 0,
  isActive: true, isPublic: true, sortOrder: 0, color: '#f59e0b', badge: '',
  limits: { maxProducts: 500, maxOrdersPerMonth: 1000, maxStaff: 5, maxStorageGB: 2, maxCustomers: 1000 },
  modules: ['pos', 'inventory', 'storefront'],
};

export default function PlansPage() {
  const { data, isLoading } = useGetPlansQuery();
  const [create] = useCreatePlanMutation();
  const [update] = useUpdatePlanMutation();
  const [del] = useDeletePlanMutation();
  const [seedPlans, { isLoading: isSeeding }] = useSeedPlansMutation();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  const plans = data?.data?.plans ?? [];

  const paging = useClientPagination(plans, '', 'cards');
  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setLimit = (key, val) => setForm((f) => ({ ...f, limits: { ...f.limits, [key]: val } }));
  const toggleModule = (m) => set('modules', form.modules.includes(m) ? form.modules.filter((x) => x !== m) : [...form.modules, m]);

  const openEdit = (p) => {
    setForm({
      name: p.name, displayName: p.displayName, description: p.description || '',
      price: p.price, billingCycle: p.billingCycle, durationDays: p.durationDays,
      trialDays: p.trialDays, isActive: p.isActive, isPublic: p.isPublic,
      sortOrder: p.sortOrder, color: p.color || '#f59e0b', badge: p.badge || '',
      limits: { ...EMPTY.limits, ...p.limits },
      modules: p.modules || [],
    });
    setEditId(p._id);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      price: Number(form.price),
      durationDays: Number(form.durationDays),
      trialDays: Number(form.trialDays),
      sortOrder: Number(form.sortOrder),
      limits: {
        maxProducts: Number(form.limits.maxProducts),
        maxOrdersPerMonth: Number(form.limits.maxOrdersPerMonth),
        maxStaff: Number(form.limits.maxStaff),
        maxStorageGB: Number(form.limits.maxStorageGB),
        maxCustomers: Number(form.limits.maxCustomers),
      },
    };
    try {
      if (editId) await update({ id: editId, ...payload }).unwrap();
      else await create(payload).unwrap();
      toast.success(editId ? 'Plan updated' : 'Plan created');
      setShowForm(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this plan?')) return;
    try { await del(id).unwrap(); toast.success('Deleted'); } catch (err) { toast.error(err?.data?.message || 'Delete failed'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Plans & Pricing</h1>
          <p className="text-slate-500 text-sm mt-0.5">{plans.length} plans configured</p>
        </div>
        <div className="flex gap-2">
          {plans.length === 0 && (
            <button className="btn-secondary text-sm" onClick={() => seedPlans()} disabled={isSeeding}>
              {isSeeding ? 'Seeding...' : 'Seed Defaults'}
            </button>
          )}
          <button className="btn-primary text-sm" onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(true); }}>
            <Plus size={15} /> New Plan
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} lines={5} />)}
        </div>
      ) : plans.length === 0 ? (
        <EmptyState icon={CreditCard} title="No plans yet" description="Click Seed Defaults to add the 4 standard plans, or create a custom one." />
      ) : (
        <div className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
          {paging.items.map((p) => {
            const Icon = PLAN_ICONS[p.name] || CreditCard;
            const colorCls = PLAN_COLORS[p.name] || PLAN_COLORS.basic;
            return (
              <div key={p._id} className={cn('card p-0 min-w-0 border overflow-hidden [overflow-wrap:anywhere]', !p.isActive && 'opacity-60', colorCls.split(' ')[2])}>
                <div className={cn('p-4 border-b border-navy-700/60', colorCls.split(' ')[1])}>
                  <div className="flex items-start justify-between">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center border', colorCls)}>
                      <Icon size={18} />
                    </div>
                    <div className="flex gap-1">
                      <button type="button" aria-label={`Edit ${p.displayName}`} onClick={() => openEdit(p)} className="workspace-row-action hover:bg-navy-800/60 text-slate-400 hover:text-gold-400"><Edit2 size={16} /></button>
                      <button type="button" aria-label={`Delete ${p.displayName}`} onClick={() => handleDelete(p._id)} className="workspace-row-action hover:bg-navy-800/60 text-slate-400 hover:text-red-400"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2 break-words">
                      <h3 className="font-bold text-slate-100">{p.displayName}</h3>
                      {p.badge && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-navy-800 text-gold-400 border border-gold-500/20">{p.badge}</span>}
                    </div>
                    <p className="text-2xl font-bold text-slate-100 mt-2">
                      {p.price === 0 ? 'Free' : formatCurrency(p.price)}
                      {p.price > 0 && <span className="text-sm font-normal text-slate-400">/{p.billingCycle === 'monthly' ? 'mo' : 'yr'}</span>}
                    </p>
                    {p.description && <p className="text-xs text-slate-500 mt-1">{p.description}</p>}
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {[
                      ['Products', p.limits?.maxProducts >= 999999 ? '∞' : p.limits?.maxProducts],
                      ['Orders/mo', p.limits?.maxOrdersPerMonth >= 999999 ? '∞' : p.limits?.maxOrdersPerMonth],
                      ['Staff', p.limits?.maxStaff >= 999 ? '∞' : p.limits?.maxStaff],
                      ['Storage', `${p.limits?.maxStorageGB}GB`],
                    ].map(([label, val]) => (
                      <div key={label} className="bg-navy-700/40 rounded-lg p-2">
                        <p className="text-slate-500">{label}</p>
                        <p className="font-semibold text-slate-200">{val}</p>
                      </div>
                    ))}
                  </div>
                  <div className="pt-1">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Modules</p>
                    <div className="flex flex-wrap gap-1">
                      {(p.modules || []).slice(0, 6).map((m) => (
                        <span key={m} className="text-[10px] bg-navy-700 text-slate-400 px-1.5 py-0.5 rounded border border-navy-600">{m}</span>
                      ))}
                      {(p.modules?.length || 0) > 6 && (
                        <span className="text-[10px] text-slate-500">+{p.modules.length - 6} more</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit Plan' : 'New Plan'} size="2xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Plan Key</label>
                  <select className="input" value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!!editId}>
                    <option value="trial">trial</option>
                    <option value="basic">basic</option>
                    <option value="premium">premium</option>
                    <option value="enterprise">enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="label">Display Name</label>
                  <input className="input" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} required />
                </div>
                <div>
                  <label className="label">Price (₹)</label>
                  <input className="input" type="number" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} />
                </div>
                <div>
                  <label className="label">Billing Cycle</label>
                  <select className="input" value={form.billingCycle} onChange={(e) => set('billingCycle', e.target.value)}>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="lifetime">Lifetime</option>
                  </select>
                </div>
                <div>
                  <label className="label">Duration (days)</label>
                  <input className="input" type="number" min="1" value={form.durationDays} onChange={(e) => set('durationDays', e.target.value)} />
                </div>
                <div>
                  <label className="label">Badge Text</label>
                  <input className="input" placeholder="e.g. Popular" value={form.badge} onChange={(e) => set('badge', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </div>

              <div>
                <label className="label mb-3">Limits</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { key: 'maxProducts', label: 'Max Products' },
                    { key: 'maxOrdersPerMonth', label: 'Orders/Month' },
                    { key: 'maxStaff', label: 'Max Staff' },
                    { key: 'maxStorageGB', label: 'Storage (GB)' },
                    { key: 'maxCustomers', label: 'Max Customers' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="label">{label}</label>
                      <input className="input" type="number" min="0" value={form.limits[key]} onChange={(e) => setLimit(key, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="label mb-2">Enabled Modules</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_MODULES.map((m) => (
                    <button key={m} type="button" onClick={() => toggleModule(m)}
                      className={cn('flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all', form.modules.includes(m) ? 'bg-gold-500/20 text-gold-400 border-gold-500/30' : 'bg-navy-700 text-slate-400 border-navy-600 hover:border-navy-500')}>
                      {form.modules.includes(m) && <Check size={10} />}
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1">{editId ? 'Update' : 'Create'}</button>
              </div>
            </form>
      </Modal>
      <Pagination meta={paging.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isLoading} label="plans" />
    </div>
  );
}
