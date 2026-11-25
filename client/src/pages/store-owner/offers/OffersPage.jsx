import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import { Plus, Edit2, Trash2, Gift, Layers, ShoppingBag, Package, Star, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetOffersQuery, useCreateOfferMutation, useUpdateOfferMutation, useDeleteOfferMutation } from '../../../features/offers/offersApi';
import { cn } from '../../../utils/cn';
import Modal from '../../../components/ui/Modal';

const OFFER_TYPES = [
  { value: 'combo', label: 'Combo Pack', icon: Layers, color: 'text-blue-400 bg-blue-500/10' },
  { value: 'festival_pack', label: 'Festival Pack', icon: Star, color: 'text-purple-400 bg-purple-500/10' },
  { value: 'ration_pack', label: 'Ration Pack', icon: Package, color: 'text-green-400 bg-green-500/10' },
  { value: 'buy_x_get_y', label: 'Buy X Get Y', icon: Gift, color: 'text-pink-400 bg-pink-500/10' },
  { value: 'wholesale', label: 'Wholesale', icon: ShoppingBag, color: 'text-orange-400 bg-orange-500/10' },
  { value: 'bulk', label: 'Bulk Discount', icon: TrendingUp, color: 'text-gold-400 bg-gold-500/10' },
];

const EMPTY = {
  title: '', description: '', type: 'combo',
  bundlePrice: '', buyQuantity: '', getQuantity: '',
  minOrderValue: 0, isActive: true,
  startsAt: '', expiresAt: '', displayOrder: 0,
  tiers: [{ minQuantity: '', pricePerUnit: '', discountPercent: '' }],
};

function TypeBadge({ type }) {
  const t = OFFER_TYPES.find((x) => x.value === type);
  if (!t) return null;
  const Icon = t.icon;
  return (
    <span className={cn('badge gap-1.5', t.color)}>
      <Icon size={11} /> {t.label}
    </span>
  );
}

export default function OffersPage() {
  const paging = usePagination('', 'cards');
  const { data, isLoading, isFetching } = useGetOffersQuery({ page: paging.page, limit: paging.limit });
  const [create] = useCreateOfferMutation();
  const [update] = useUpdateOfferMutation();
  const [del] = useDeleteOfferMutation();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  const offers = data?.data?.offers ?? [];

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const openNew = () => { setForm(EMPTY); setEditId(null); setShowForm(true); };
  const openEdit = (o) => {
    setForm({
      title: o.title, description: o.description || '', type: o.type,
      bundlePrice: o.bundlePrice || '', buyQuantity: o.buyQuantity || '',
      getQuantity: o.getQuantity || '', minOrderValue: o.minOrderValue || 0,
      isActive: o.isActive, displayOrder: o.displayOrder || 0,
      startsAt: o.startsAt ? o.startsAt.slice(0, 16) : '',
      expiresAt: o.expiresAt ? o.expiresAt.slice(0, 16) : '',
      tiers: o.tiers?.length ? o.tiers.map((t) => ({ minQuantity: t.minQuantity, pricePerUnit: t.pricePerUnit || '', discountPercent: t.discountPercent || '' })) : [{ minQuantity: '', pricePerUnit: '', discountPercent: '' }],
    });
    setEditId(o._id);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      bundlePrice: form.bundlePrice ? Number(form.bundlePrice) : undefined,
      buyQuantity: form.buyQuantity ? Number(form.buyQuantity) : undefined,
      getQuantity: form.getQuantity ? Number(form.getQuantity) : undefined,
      minOrderValue: Number(form.minOrderValue) || 0,
      displayOrder: Number(form.displayOrder) || 0,
      startsAt: form.startsAt || undefined,
      expiresAt: form.expiresAt || undefined,
      tiers: ['wholesale', 'bulk'].includes(form.type)
        ? form.tiers.filter((t) => t.minQuantity).map((t) => ({
            minQuantity: Number(t.minQuantity),
            pricePerUnit: t.pricePerUnit ? Number(t.pricePerUnit) : undefined,
            discountPercent: t.discountPercent ? Number(t.discountPercent) : undefined,
          }))
        : undefined,
    };
    try {
      if (editId) await update({ id: editId, ...payload }).unwrap();
      else await create(payload).unwrap();
      toast.success(editId ? 'Offer updated' : 'Offer created');
      setShowForm(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save offer');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this offer?')) return;
    try { await del(id).unwrap(); toast.success('Deleted'); } catch { toast.error('Delete failed'); }
  };

  const addTier = () => set('tiers', [...form.tiers, { minQuantity: '', pricePerUnit: '', discountPercent: '' }]);
  const removeTier = (i) => set('tiers', form.tiers.filter((_, idx) => idx !== i));
  const setTier = (i, key, val) => set('tiers', form.tiers.map((t, idx) => idx === i ? { ...t, [key]: val } : t));

  const showTiers = ['wholesale', 'bulk'].includes(form.type);
  const showBuyXGetY = form.type === 'buy_x_get_y';
  const showBundlePrice = ['combo', 'festival_pack', 'ration_pack'].includes(form.type);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Offers & Deals</h1>
          <p className="text-slate-500 text-sm mt-1">{offers.length} offer{offers.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={openNew}><Plus size={16} /> New Offer</button>
      </div>

      {/* Type filter chips */}
      <div className="flex gap-2 flex-wrap">
        {OFFER_TYPES.map((t) => {
          const count = offers.filter((o) => o.type === t.value).length;
          const Icon = t.icon;
          return (
            <div key={t.value} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border', t.color, 'border-current/20')}>
              <Icon size={12} /> {t.label} {count > 0 && <span className="font-bold">({count})</span>}
            </div>
          );
        })}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-16 text-slate-500">Loading...</div>
      ) : offers.length === 0 ? (
        <div className="card p-16 text-center">
          <Gift size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No offers yet. Create your first deal!</p>
        </div>
      ) : (
        <div ref={paging.contentRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((o) => (
            <div key={o._id} className={cn('card p-4 space-y-3', !o.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-100 text-sm truncate">{o.title}</h3>
                  {o.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{o.description}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(o)} className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-400 hover:text-gold-400"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(o._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <TypeBadge type={o.type} />
                <span className={cn('badge border', o.isActive ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-600')}>
                  {o.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {o.bundlePrice && <p className="text-xs text-slate-400">Bundle price: <span className="text-gold-400 font-semibold">₹{o.bundlePrice}</span></p>}
              {o.tiers?.length > 0 && <p className="text-xs text-slate-400">{o.tiers.length} price tier{o.tiers.length > 1 ? 's' : ''}</p>}
              {o.buyQuantity && o.getQuantity && <p className="text-xs text-slate-400">Buy {o.buyQuantity} Get {o.getQuantity} Free</p>}
            </div>
          ))}
        </div>
      )}

      <Pagination meta={data?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} label="offers" />
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit Offer' : 'New Offer'} size="lg">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Title</label>
                <input className="input" placeholder="e.g. Festival Combo Pack" value={form.title} onChange={(e) => set('title', e.target.value)} required />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input resize-none" rows={2} placeholder="Short description of the offer" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </div>
              <div>
                <label className="label">Offer Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {OFFER_TYPES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button key={t.value} type="button"
                        onClick={() => set('type', t.value)}
                        className={cn('flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-medium transition-all',
                          form.type === t.value ? `${t.color} border-current` : 'border-navy-600 text-slate-400 hover:border-navy-500')}>
                        <Icon size={18} />
                        <span className="text-center leading-tight">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {showBundlePrice && (
                <div>
                  <label className="label">Bundle Price (₹)</label>
                  <input className="input" type="number" min="0" placeholder="e.g. 299" value={form.bundlePrice} onChange={(e) => set('bundlePrice', e.target.value)} />
                </div>
              )}

              {showBuyXGetY && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Buy Quantity (X)</label>
                    <input className="input" type="number" min="1" placeholder="2" value={form.buyQuantity} onChange={(e) => set('buyQuantity', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Get Free (Y)</label>
                    <input className="input" type="number" min="1" placeholder="1" value={form.getQuantity} onChange={(e) => set('getQuantity', e.target.value)} />
                  </div>
                </div>
              )}

              {showTiers && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">Price Tiers</label>
                    <button type="button" onClick={addTier} className="text-xs text-gold-400 hover:text-gold-300"><Plus size={12} className="inline" /> Add Tier</button>
                  </div>
                  <div className="space-y-2">
                    {form.tiers.map((t, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input className="input text-xs py-2" placeholder="Min Qty" type="number" min="1" value={t.minQuantity} onChange={(e) => setTier(i, 'minQuantity', e.target.value)} />
                        <input className="input text-xs py-2" placeholder="₹/unit" type="number" min="0" value={t.pricePerUnit} onChange={(e) => setTier(i, 'pricePerUnit', e.target.value)} />
                        <input className="input text-xs py-2" placeholder="% off" type="number" min="0" max="100" value={t.discountPercent} onChange={(e) => setTier(i, 'discountPercent', e.target.value)} />
                        {form.tiers.length > 1 && (
                          <button type="button" onClick={() => removeTier(i)} aria-label={`Remove price tier ${i + 1}`} title="Remove tier" className="min-w-11 min-h-11 flex items-center justify-center text-red-400 hover:text-red-300 shrink-0"><Trash2 size={14} /></button>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-slate-500">Fill either price/unit OR discount %, not both</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Date</label>
                  <input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
                </div>
                <div>
                  <label className="label">End Date</label>
                  <input className="input" type="datetime-local" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Min Order (₹)</label>
                  <input className="input" type="number" min="0" value={form.minOrderValue} onChange={(e) => set('minOrderValue', e.target.value)} />
                </div>
                <div>
                  <label className="label">Display Order</label>
                  <input className="input" type="number" min="0" value={form.displayOrder} onChange={(e) => set('displayOrder', e.target.value)} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="label mb-0">Active</label>
                <button type="button" onClick={() => set('isActive', !form.isActive)}
                  aria-label={form.isActive ? 'Deactivate offer' : 'Activate offer'} aria-pressed={form.isActive}
                  className={cn('w-12 h-11 rounded-full transition-colors relative', form.isActive ? 'bg-gold-500' : 'bg-navy-600')}>
                  <span className={cn('absolute top-3 left-0.5 w-5 h-5 bg-white rounded-full transition-transform', form.isActive && 'translate-x-6')} />
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
