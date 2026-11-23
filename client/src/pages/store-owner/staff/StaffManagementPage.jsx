import { useMemo, useState } from 'react';
import { Edit2, Plus, Search, ShieldCheck, UserRound, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useCreateStaffMutation,
  useDeactivateStaffMutation,
  useGetStaffQuery,
  useUpdateStaffMutation,
} from '../../../features/staff/staffApi';
import {
  ROLE_ALLOWED_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  PERMISSIONS,
  permissionDependencies,
  withPermissionDependencies,
} from '../../../constants/permissions';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Badge from '../../../components/ui/Badge';
import EmptyState from '../../../components/ui/EmptyState';
import { SkeletonTable } from '../../../components/ui/Skeleton';

const EMPTY_FORM = {
  name: '', email: '', password: '', phone: '', role: 'staff', permissions: [], isActive: true,
};

const PERMISSION_LABELS = {
  'dashboard.view': 'View dashboard',
  'pos.access': 'Create POS bills',
  'pos.discount': 'Apply POS discounts',
  'pos.price_override': 'Override POS prices',
  'products.create': 'Create products',
  'products.edit': 'Edit products',
  'products.view': 'View products',
  'products.delete': 'Delete products',
  'categories.view': 'View categories',
  'categories.manage': 'Manage categories',
  'orders.view': 'View all orders',
  'orders.status.update': 'Accept and update orders',
  'orders.assign': 'Assign packing and delivery',
  'orders.cancel': 'Cancel orders',
  'orders.reject': 'Reject orders',
  'orders.partial_fulfill': 'Adjust fulfillment quantities',
  'orders.payment.verify': 'Verify payments',
  'packing.view': 'View packing orders',
  'packing.perform': 'Pick and pack assigned orders',
  'packing.manage': 'Work on all packing orders',
  'packing.verify': 'Verify completed packing',
  'packing.reports': 'View packing activity and reports',
  'delivery.view': 'View assigned deliveries',
  'delivery.update': 'Update assigned deliveries',
  'delivery.manage': 'Work on all store deliveries',
  'inventory.view': 'View inventory',
  'inventory.adjust': 'Adjust stock',
  'purchases.view': 'View purchases',
  'purchases.manage': 'Create purchases',
  'purchases.pay': 'Record purchase payments',
  'suppliers.view': 'View suppliers',
  'suppliers.manage': 'Manage suppliers',
  'suppliers.pay': 'Record supplier payments',
  'returns.view': 'View returns',
  'returns.create': 'Create returns',
  'returns.process': 'Approve or reject returns',
  'staff.view': 'View team for assignments',
  'accounting.view': 'View accounts and daily closing',
  'accounting.manage': 'Manage accounts and daily closing',
  'salary.view': 'View salaries',
  'salary.manage': 'Manage salaries',
  'reports.view': 'View reports',
  'reports.sensitive': 'View sales and profit reports',
  'coupons.view': 'View coupons',
  'coupons.manage': 'Manage coupons',
  'offers.view': 'View offers',
  'offers.manage': 'Manage offers',
  'settings.view': 'View store settings',
  'settings.manage': 'Update store settings',
  'backup.export': 'Export store backups',
  'audit_logs.view': 'View store audit logs',
  'notifications.view': 'View notifications',
  'pos.refund': 'Refund POS sales',
};

const roleLabel = (role) => ({ staff: 'Staff', packer: 'Packer', delivery: 'Delivery' }[role] || role);
const additionalPermissionCount = (member) => {
  const defaults = ROLE_DEFAULT_PERMISSIONS[member.role] || [];
  const allowed = ROLE_ALLOWED_PERMISSIONS[member.role] || [];
  return new Set((member.permissions || []).filter((permission) => allowed.includes(permission) && !defaults.includes(permission))).size;
};

function PermissionEditor({ role, selected, onChange }) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || [];
  const optional = (ROLE_ALLOWED_PERMISSIONS[role] || []).filter((permission) =>
    !defaults.includes(permission));
  const extraOnly = (permissions) => withPermissionDependencies(permissions).filter((permission) => !defaults.includes(permission));
  const addDuties = (permissions) => onChange(extraOnly([...selected, ...permissions]));
  const toggle = (permission, checked) => {
    if (checked) return addDuties([permission]);
    const removed = new Set([permission]);
    let next = selected;
    // Removing a view also removes dependent actions so the saved access stays usable.
    let changed = true;
    while (changed) {
      const filtered = next.filter((value) => value !== permission && !permissionDependencies(value).some((dependency) => removed.has(dependency)));
      changed = filtered.length !== next.length;
      next.filter((value) => !filtered.includes(value)).forEach((value) => removed.add(value));
      next = filtered;
    }
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-300">Permissions</legend>
      <p className="text-xs text-slate-500">
        Choosing {roleLabel(role)} automatically includes the permissions below. No manual ticking is needed for standard work in this role.
      </p>
      <div role="group" aria-label="Included with role" className="rounded-xl border border-navy-600 p-3 space-y-2">
        <p className="text-sm font-semibold text-slate-300">Included with {roleLabel(role)} — automatic</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {defaults.map((permission) => (
            <label key={permission} className="min-h-11 flex items-center gap-2 rounded-xl bg-navy-900/60 px-3 text-sm text-slate-300">
              <input type="checkbox" aria-label={PERMISSION_LABELS[permission] || permission} checked disabled readOnly className="h-4 w-4 accent-gold-500" />
              {PERMISSION_LABELS[permission] || permission}
            </label>
          ))}
        </div>
      </div>
      <p className="text-sm font-medium text-slate-300 pt-2">Extra permissions — optional</p>
      <p className="text-xs text-slate-500">Select these only for additional duties. Required related permissions are selected automatically. Only the owner can grant extra access.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => addDuties([
          PERMISSIONS.ORDERS_STATUS_UPDATE, PERMISSIONS.PACKING_MANAGE, PERMISSIONS.PACKING_VERIFY,
          PERMISSIONS.DELIVERY_MANAGE, PERMISSIONS.NOTIFICATIONS_VIEW,
        ])}>Packing + delivery</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onChange(extraOnly(optional))}>All shop duties</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>Clear extra access</Button>
      </div>
      {optional.length === 0 ? (
        <p className="rounded-xl bg-navy-900/60 p-3 text-xs text-slate-400">
          This role has no optional privileges. Its access is intentionally limited to assigned duties.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {optional.map((permission) => (
            <label key={permission} className="min-h-11 flex items-center gap-2 rounded-xl bg-navy-900/60 px-3 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(permission)}
                onChange={(event) => toggle(permission, event.target.checked)}
                className="h-4 w-4 accent-gold-500"
              />
              {PERMISSION_LABELS[permission] || permission}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export default function StaffManagementPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const params = useMemo(() => ({ page, limit: 20, ...(search ? { search } : {}), ...(role ? { role } : {}) }), [page, search, role]);
  const { data, isLoading, isError, refetch } = useGetStaffQuery(params);
  const [createStaff, { isLoading: creating }] = useCreateStaffMutation();
  const [updateStaff, { isLoading: updating }] = useUpdateStaffMutation();
  const [deactivateStaff, { isLoading: deactivating }] = useDeactivateStaffMutation();
  const staff = data?.data || [];
  const meta = data?.meta || {};

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (member) => {
    setEditing(member);
    setForm({
      name: member.name || '',
      email: member.email || '',
      password: '',
      phone: member.phone || '',
      role: member.role,
      permissions: member.permissions || [],
      isActive: member.isActive,
    });
    setModalOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    try {
      if (editing) {
        await updateStaff({
          id: editing._id,
          name: form.name,
          phone: form.phone || undefined,
          permissions: form.permissions,
          isActive: form.isActive,
        }).unwrap();
        toast.success('Staff member updated.');
      } else {
        await createStaff({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone || undefined,
          role: form.role,
          permissions: form.permissions,
        }).unwrap();
        toast.success('Staff member created.');
      }
      setModalOpen(false);
    } catch (error) {
      toast.error(error?.data?.message || 'Staff member could not be saved.');
    }
  };

  const deactivate = async () => {
    try {
      await deactivateStaff(deactivateTarget._id).unwrap();
      toast.success('Staff access deactivated and sessions revoked.');
      setDeactivateTarget(null);
    } catch (error) {
      toast.error(error?.data?.message || 'Staff member could not be deactivated.');
    }
  };

  const changeRole = (nextRole) => setForm((current) => ({
    ...current,
    role: nextRole,
    permissions: [],
  }));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header gap-3">
        <div>
          <h1 className="page-title">Staff and Fulfillment</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage roles, optional permissions, and account status</p>
        </div>
        <Button size="sm" leftIcon={<Plus size={16} />} onClick={openCreate}>Add staff</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-56">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            className="input pl-9 w-full min-h-11"
            aria-label="Search staff"
            placeholder="Search name or email"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
        </div>
        <select
          className="input min-h-11 min-w-40"
          aria-label="Filter by staff role"
          value={role}
          onChange={(event) => { setRole(event.target.value); setPage(1); }}
        >
          <option value="">All roles</option>
          <option value="staff">Staff</option>
          <option value="packer">Packer</option>
          <option value="delivery">Delivery</option>
        </select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : isError ? (
        <EmptyState icon={UserRound} title="Staff could not be loaded" description="Try the request again." action={<Button size="sm" variant="secondary" onClick={refetch}>Retry</Button>} />
      ) : staff.length === 0 ? (
        <EmptyState icon={UserRound} title="No staff members found" description="Add a staff, packing, or delivery account." action={<Button size="sm" onClick={openCreate}>Add staff</Button>} />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {staff.map((member) => (
              <article key={member._id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-100">{member.name}</h2>
                    <p className="text-xs text-slate-400 break-all">{member.email}</p>
                  </div>
                  <Badge status={member.isActive ? 'active' : 'inactive'}>{member.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize text-slate-300">{member.role}</span>
                  <span className="text-slate-500">{(ROLE_DEFAULT_PERMISSIONS[member.role] || []).length} included · {additionalPermissionCount(member)} extra</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" leftIcon={<Edit2 size={15} />} onClick={() => openEdit(member)}>Edit</Button>
                  {member.isActive && <Button variant="danger" size="sm" leftIcon={<UserX size={15} />} onClick={() => setDeactivateTarget(member)}>Deactivate</Button>}
                </div>
              </article>
            ))}
          </div>

          <div className="card p-0 overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="table min-w-[760px]">
                <thead><tr><th>Staff member</th><th>Role</th><th>Phone</th><th>Permissions</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {staff.map((member) => (
                    <tr key={member._id}>
                      <td><p className="font-medium text-slate-200">{member.name}</p><p className="text-xs text-slate-500">{member.email}</p></td>
                      <td><Badge variant="info">{roleLabel(member.role)}</Badge></td>
                      <td className="text-slate-400">{member.phone || '—'}</td>
                      <td className="text-slate-400">{(ROLE_DEFAULT_PERMISSIONS[member.role] || []).length} included · {additionalPermissionCount(member)} extra</td>
                      <td><Badge status={member.isActive ? 'active' : 'inactive'} dot>{member.isActive ? 'Active' : 'Inactive'}</Badge></td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-gold-400 hover:bg-navy-700" aria-label={`Edit ${member.name}`} title="Edit staff" onClick={() => openEdit(member)}><Edit2 size={16} /></button>
                          {member.isActive && <button className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10" aria-label={`Deactivate ${member.name}`} title="Deactivate staff" onClick={() => setDeactivateTarget(member)}><UserX size={16} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.totalPages}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={!meta.hasPrevPage} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={!meta.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit staff member' : 'Add staff member'} size="lg">
        <form onSubmit={save} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Input name="name" label="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            <Input name="phone" label="Mobile number" inputMode="numeric" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <Input name="email" label="Email" type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required disabled={Boolean(editing)} />
            {!editing && <Input name="password" label="Temporary password" type="password" autoComplete="new-password" hint="10–128 characters. Share it through a secure channel." minLength={10} maxLength={128} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />}
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-300 mb-2">Role</legend>
            <div className="grid grid-cols-3 gap-2">
              {['staff', 'packer', 'delivery'].map((item) => (
                <label key={item} className={`min-h-11 rounded-xl border px-3 flex items-center justify-center text-sm cursor-pointer ${form.role === item ? 'border-gold-500 bg-gold-500/10 text-gold-300' : 'border-navy-600 text-slate-400'}`}>
                  <input type="radio" name="role" value={item} checked={form.role === item} onChange={() => changeRole(item)} className="sr-only" disabled={Boolean(editing)} />
                  {roleLabel(item)}
                </label>
              ))}
            </div>
          </fieldset>
          <PermissionEditor role={form.role} selected={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
          {editing && (
            <label className="min-h-11 flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-gold-500" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Account active
            </label>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={creating || updating} leftIcon={<ShieldCheck size={16} />}>{editing ? 'Save changes' : 'Create account'}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(deactivateTarget)} onClose={() => setDeactivateTarget(null)} title="Deactivate staff access" size="sm">
        <p className="text-sm text-slate-300">Deactivate {deactivateTarget?.name}? Their refresh sessions will be revoked immediately. Historical orders and activity will be retained.</p>
        <div className="flex gap-3 mt-5">
          <Button variant="secondary" fullWidth onClick={() => setDeactivateTarget(null)}>Keep active</Button>
          <Button variant="danger" fullWidth isLoading={deactivating} onClick={deactivate}>Deactivate</Button>
        </div>
      </Modal>
    </div>
  );
}
