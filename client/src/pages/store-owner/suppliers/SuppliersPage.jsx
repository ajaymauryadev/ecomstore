import { useRef, useState } from 'react';
import { Plus, Edit2, Trash2, Phone, MapPin, CreditCard, Search, IndianRupee } from 'lucide-react';
import {
  useGetSuppliersQuery,
  useCreateSupplierMutation,
  useUpdateSupplierMutation,
  useDeleteSupplierMutation,
  useRecordSupplierPaymentMutation,
} from '../../../features/suppliers/supplierApi';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import RecordSupplierPaymentDialog from '../../../components/purchases/RecordSupplierPaymentDialog';
import Spinner from '../../../components/ui/Spinner';
import { formatCurrency } from '../../../utils/formatters';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  name: '', phone: '', altPhone: '', email: '',
  companyName: '', gstNumber: '', notes: '',
  address: { line1: '', city: '', state: '', pincode: '' },
};

function SupplierCard({ supplier, onEdit, onDelete, onPayment }) {
  return (
    <div className="card hover:border-navy-600 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-500/20 to-gold-600/10 border border-gold-500/20 flex items-center justify-center shrink-0">
            <span className="text-gold-400 font-bold text-sm">{supplier.name?.charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200 truncate">{supplier.name}</p>
            {supplier.companyName && <p className="text-xs text-slate-500 truncate">{supplier.companyName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onEdit(supplier)} className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-400 hover:text-gold-400 transition-colors">
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(supplier)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {supplier.phone && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Phone size={11} className="shrink-0" /> {supplier.phone}
          </div>
        )}
        {(supplier.address?.city || supplier.address?.state) && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <MapPin size={11} className="shrink-0" />
            {[supplier.address.city, supplier.address.state].filter(Boolean).join(', ')}
          </div>
        )}
        {supplier.gstNumber && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <CreditCard size={11} className="shrink-0" /> GST: {supplier.gstNumber}
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-navy-700/60 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">Pending</p>
          <p className={cn('text-sm font-bold', supplier.pendingAmount > 0 ? 'text-red-400' : 'text-emerald-400')}>
            {formatCurrency(supplier.pendingAmount || 0)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Total Purchased</p>
          <p className="text-sm font-semibold text-slate-300">{formatCurrency(supplier.totalPurchased || 0)}</p>
        </div>
        {supplier.pendingAmount > 0 && (
          <button
            onClick={() => onPayment(supplier)}
            className="btn btn-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
          >
            Pay
          </button>
        )}
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const [search, setSearch] = useState('');
  const supplierNameInput = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useGetSuppliersQuery({ search });
  const [createSupplier, { isLoading: isCreating }] = useCreateSupplierMutation();
  const [updateSupplier, { isLoading: isUpdating }] = useUpdateSupplierMutation();
  const [deleteSupplier, { isLoading: isDeleting }] = useDeleteSupplierMutation();
  const [recordPayment, { isLoading: isPaying }] = useRecordSupplierPaymentMutation();

  const suppliers = data?.data?.suppliers || [];
  const isSaving = isCreating || isUpdating;

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name, phone: s.phone || '', altPhone: s.altPhone || '',
      email: s.email || '', companyName: s.companyName || '',
      gstNumber: s.gstNumber || '', notes: s.notes || '',
      address: s.address || { line1: '', city: '', state: '', pincode: '' },
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Supplier name is required');
    try {
      if (editing) {
        await updateSupplier({ id: editing._id, ...form }).unwrap();
        toast.success('Supplier updated!');
      } else {
        await createSupplier(form).unwrap();
        toast.success('Supplier created!');
      }
      setModalOpen(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Save failed.');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSupplier(deleteTarget._id).unwrap();
      toast.success('Supplier deleted.');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Delete failed.');
    }
  };

  const setAddress = (field, val) => setForm((f) => ({ ...f, address: { ...f.address, [field]: val } }));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="text-slate-400 text-sm mt-0.5">{suppliers.length} suppliers</p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={openCreate}>Add Supplier</Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by name, phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-8 w-full"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" className="text-gold-500" /></div>
      ) : suppliers.length === 0 ? (
        <div className="card p-12 text-center">
          <IndianRupee size={40} strokeWidth={1} className="mx-auto text-navy-600 mb-3" />
          <p className="text-slate-400 font-medium">No suppliers yet</p>
          <Button size="sm" leftIcon={<Plus size={14} />} className="mt-4" onClick={openCreate}>Add Supplier</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suppliers.map((s) => (
            <SupplierCard
              key={s._id}
              supplier={s}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onPayment={setPaymentTarget}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Supplier' : 'Add Supplier'} initialFocusRef={supplierNameInput} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input ref={supplierNameInput} label="Supplier Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Company Name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} type="tel" />
            <Input label="Alt Phone" value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} type="tel" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" />
            <Input label="GST Number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value.toUpperCase() })} placeholder="22XXXXX0000X1Z5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">Address</p>
            <div className="space-y-2">
              <Input placeholder="Address Line 1" value={form.address.line1} onChange={(e) => setAddress('line1', e.target.value)} />
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="City" value={form.address.city} onChange={(e) => setAddress('city', e.target.value)} />
                <Input placeholder="State" value={form.address.state} onChange={(e) => setAddress('state', e.target.value)} />
                <Input placeholder="Pincode" value={form.address.pincode} onChange={(e) => setAddress('pincode', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-300">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any notes..." rows={2} className="input resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button fullWidth isLoading={isSaving} onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Supplier" size="sm">
        <p className="text-slate-300 text-sm">Delete <strong className="text-slate-100">&quot;{deleteTarget?.name}&quot;</strong>?</p>
        {deleteTarget?.pendingAmount > 0 && (
          <p className="text-red-400 text-sm mt-1">⚠️ Supplier has pending amount of {formatCurrency(deleteTarget.pendingAmount)}.</p>
        )}
        <div className="flex gap-3 mt-4">
          <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" fullWidth isLoading={isDeleting} onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>

      {paymentTarget && (
        <RecordSupplierPaymentDialog
          key={paymentTarget._id}
          target={paymentTarget}
          accountPayment
          recordPayment={recordPayment}
          isSaving={isPaying}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}
