import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Store, Power, ArrowUpRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetSAStoresQuery, useCreateStoreMutation, useToggleStoreStatusMutation } from '../../features/superAdmin/superAdminApi';
import { useGetPlansQuery } from '../../features/plans/planApi';
import { formatDate } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import { SkeletonTable } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { cn } from '../../utils/cn';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';

const PLAN_VARIANTS = { trial: 'default', basic: 'info', premium: 'gold', enterprise: 'purple' };

const EMPTY_NEW = { ownerName: '', ownerPhone: '', ownerEmail: '', ownerPassword: '', storeName: '', storeSlug: '', plan: 'trial' };

export default function StoresPage() {
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY_NEW);

  const params = { page, limit: 20 };
  if (search) params.search = search;
  if (planFilter) params.plan = planFilter;

  const { data, isLoading } = useGetSAStoresQuery(params);
  const { data: plansData } = useGetPlansQuery();
  const [createStore, { isLoading: isCreating }] = useCreateStoreMutation();
  const [toggleStatus] = useToggleStoreStatusMutation();

  const stores = data?.data ?? [];
  const meta = data?.meta ?? {};
  const plans = plansData?.data?.plans ?? [];

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createStore(newForm).unwrap();
      toast.success('Store created!');
      setShowCreate(false);
      setNewForm(EMPTY_NEW);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to create store');
    }
  };

  const handleToggle = async (id, isActive) => {
    try {
      await toggleStatus(id).unwrap();
      toast.success(isActive ? 'Store deactivated' : 'Store activated');
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">All Stores</h1>
          <p className="text-slate-500 text-sm mt-0.5">{meta.total ?? 0} stores total</p>
        </div>
        <button className="btn-primary text-sm" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Store
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input aria-label="Search stores" className="input pl-9 text-sm py-2.5" placeholder="Search store name or slug..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select aria-label="Filter by plan" className="input w-40 text-sm py-2.5" value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}>
          <option value="">All Plans</option>
          {plans.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
        </select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} cols={5} />
      ) : stores.length === 0 ? (
        <EmptyState icon={Store} title="No stores found" description="Create the first store or adjust the search filters." />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Owner</th>
                  <th>Plan</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const expired = store.subscription?.expiresAt && new Date(store.subscription.expiresAt) < new Date();
                  return (
                    <tr key={store._id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-gold rounded-lg flex items-center justify-center shrink-0">
                            <span className="text-navy-950 font-bold text-xs">{store.name[0]}</span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-200 text-sm">{store.name}</p>
                            <p className="text-xs text-slate-500">/{store.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <p className="text-sm text-slate-300">{store.ownerId?.name || '—'}</p>
                        <p className="text-xs text-slate-500">{store.ownerId?.phone}</p>
                      </td>
                      <td>
                        <Badge variant={PLAN_VARIANTS[store.subscription?.plan] || 'default'}>
                          {store.subscription?.plan || 'trial'}
                        </Badge>
                      </td>
                      <td>
                        <span className={cn('text-sm', expired ? 'text-red-400' : 'text-slate-400')}>
                          {store.subscription?.expiresAt ? formatDate(store.subscription.expiresAt) : '—'}
                        </span>
                      </td>
                      <td>
                        <Badge status={store.isActive ? 'active' : 'inactive'} dot>
                          {store.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <Link to={`/super-admin/stores/${store._id}`} aria-label={`View ${store.name}`} title={`View ${store.name}`} className="min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-navy-700 text-slate-400 hover:text-gold-400 transition-colors">
                            <ArrowUpRight size={15} />
                          </Link>
                          <button onClick={() => handleToggle(store._id, store.isActive)} aria-label={`${store.isActive ? 'Deactivate' : 'Activate'} ${store.name}`} title={`${store.isActive ? 'Deactivate' : 'Activate'} ${store.name}`} className={cn('min-w-11 min-h-11 flex items-center justify-center rounded-lg transition-colors', store.isActive ? 'hover:bg-red-500/10 text-slate-400 hover:text-red-400' : 'hover:bg-green-500/10 text-slate-400 hover:text-green-400')}>
                            <Power size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-navy-700/60">
              <span className="text-xs text-slate-500">Page {page} of {meta.totalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">Prev</button>
                <button onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create New Store" size="lg">
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Store Name" name="storeName" placeholder="Sharma Kirana" value={newForm.storeName} onChange={(e) => setNewForm((f) => ({ ...f, storeName: e.target.value }))} required />
                <Input label="Store Slug" name="storeSlug" placeholder="sharma-kirana" value={newForm.storeSlug} onChange={(e) => setNewForm((f) => ({ ...f, storeSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} required />
              </div>
              <Input label="Owner Phone" name="ownerPhone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="9876543210" value={newForm.ownerPhone} onChange={(e) => setNewForm((f) => ({ ...f, ownerPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} required />
              <Input label="Owner Name" name="ownerName" autoComplete="name" placeholder="Ramesh Sharma" value={newForm.ownerName} onChange={(e) => setNewForm((f) => ({ ...f, ownerName: e.target.value }))} required />
              <Input label="Owner Email" name="ownerEmail" type="email" autoComplete="off" placeholder="owner@example.com" value={newForm.ownerEmail} onChange={(e) => setNewForm((f) => ({ ...f, ownerEmail: e.target.value }))} required />
              <Input label="Temporary Password" name="ownerPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} hint="10–128 characters. Share through a secure channel." value={newForm.ownerPassword} onChange={(e) => setNewForm((f) => ({ ...f, ownerPassword: e.target.value }))} required />
              <div>
                <label className="label" htmlFor="new-store-plan">Plan</label>
                <select id="new-store-plan" name="plan" className="input" value={newForm.plan} onChange={(e) => setNewForm((f) => ({ ...f, plan: e.target.value }))}>
                  {plans.length === 0 && <option value="trial">Trial (default)</option>}
                  {plans.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={isCreating} className="btn-primary flex-1">{isCreating ? 'Creating...' : 'Create Store'}</button>
              </div>
            </form>
      </Modal>
    </div>
  );
}
