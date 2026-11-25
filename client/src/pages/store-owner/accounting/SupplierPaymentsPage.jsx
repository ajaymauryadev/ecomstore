import { usePagination, useClientPagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import RecordSupplierPaymentDialog from '../../../components/purchases/RecordSupplierPaymentDialog';
import SupplierReconciliationDialog from '../../../components/purchases/SupplierReconciliationDialog';
import Button from '../../../components/ui/Button';
import { ROUTES } from '../../../constants/routes';
import { Truck, X, DollarSign, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  useGetSuppliersQuery,
  useRecordSupplierPaymentMutation,
} from '../../../features/suppliers/supplierApi';
import { cn } from '../../../utils/cn';

function fmt(n) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SupplierPaymentsPage() {
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);

  const paging = usePagination();
  const { data: listData, isLoading, isFetching } = useGetSuppliersQuery({ page: paging.page, limit: paging.limit });
  const [recordPayment, { isLoading: paying }] = useRecordSupplierPaymentMutation();

  const suppliers = listData?.data?.suppliers ?? [];
  const selectedSupplier = suppliers.find((supplier) => supplier._id === selectedSupplierId);
  const totalDue = listData?.data?.summary?.totalDue ?? 0;
  const historyPaging = useClientPagination([...(selectedSupplier?.paymentHistory || [])].reverse(), selectedSupplierId);
  const suppliersWithDue = suppliers.filter((s) => (s.pendingAmount ?? 0) > 0);

  const openPayModal = (supplier) => {
    setSelectedSupplierId(supplier._id);
    setShowPayModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Supplier Payments</h1>
          <p className="text-sm text-slate-500 mt-1">Manage supplier dues and payment ledger</p>
        </div>
        <Button variant="secondary" onClick={() => setShowReconciliation(true)}>Reconciliation</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Suppliers</p>
          <p className="text-2xl font-bold text-slate-100">{listData?.meta?.total ?? suppliers.length}</p>
        </div>
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">With Pending Due</p>
          <p className="text-2xl font-bold text-gold-400">{listData?.data?.summary?.withDue ?? suppliersWithDue.length}</p>
        </div>
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Due</p>
          <p className="text-2xl font-bold text-red-400">{fmt(totalDue)}</p>
        </div>
      </div>

      {/* Supplier list */}
      <div className="bg-navy-800 border border-navy-700/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-700/40">
          <p className="text-sm font-semibold text-slate-300">Supplier Ledger</p>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
        ) : suppliers.length === 0 ? (
          <div className="p-12 text-center">
            <Truck size={40} className="mx-auto text-slate-600 mb-2" />
            <p className="text-slate-500 text-sm">No suppliers found</p>
          </div>
        ) : (
          <div className="divide-y divide-navy-700/40">
            {suppliers.map((sup) => {
              const hasDue = (sup.pendingAmount ?? 0) > 0;
              return (
                <div
                  key={sup._id}
                  className={cn('flex items-center gap-4 px-4 py-4 cursor-pointer hover:bg-navy-700/20 transition-colors', selectedSupplier?._id === sup._id && 'bg-navy-700/30')}
                  onClick={() => setSelectedSupplierId((previous) => previous === sup._id ? null : sup._id)}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-blue-400">{sup.name[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-200">{sup.name}</p>
                    <p className="text-xs text-slate-500">{sup.phone || sup.companyName || 'No contact'}</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-slate-500">Total Purchased</p>
                    <p className="text-sm font-medium text-slate-300">{fmt(sup.totalPurchased)}</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-slate-500">Total Paid</p>
                    <p className="text-sm font-medium text-emerald-400">{fmt(sup.totalPaid)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Pending</p>
                    <p className={cn('text-sm font-bold', hasDue ? 'text-red-400' : 'text-emerald-400')}>
                      {fmt(sup.pendingAmount)}
                    </p>
                  </div>
                  {hasDue ? (
                    <AlertCircle size={18} className="text-red-400 shrink-0" />
                  ) : (
                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                  )}
                  {hasDue && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openPayModal(sup); }}
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

      <Pagination meta={listData?.meta} page={paging.page} onPageChange={(page) => { paging.setPage(page); setSelectedSupplierId(null); }} isFetching={isFetching} label="suppliers" />
      {/* Payment History for selected supplier */}
      {selectedSupplier && (
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-700/40 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-300">Payment History — {selectedSupplier.name}</p>
            <button onClick={() => setSelectedSupplierId(null)} className="p-1 hover:bg-navy-700 rounded-lg text-slate-500">
              <X size={16} />
            </button>
          </div>
          {(selectedSupplier.paymentHistory ?? []).length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No payments recorded yet</div>
          ) : (
            <div className="divide-y divide-navy-700/40 max-h-64 overflow-y-auto">
              {historyPaging.items.map((p) => (
                <div key={p._id} className="flex items-center gap-3 px-4 py-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0">
                    <DollarSign size={14} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">{p.note || 'Payment'}</p>
                    <p className="text-xs text-slate-500">{fmtDate(p.paidAt ?? p.createdAt)} · {p.method}</p>
                    {p.allocations?.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-x-3 text-xs text-gold-400">
                        {p.allocations.map((allocation) => (
                          <li key={allocation.purchaseId}>
                            <Link to={ROUTES.STORE.PURCHASE_DETAIL(allocation.purchaseId)}>
                              {allocation.invoiceNumber || 'Invoice'} · {fmt(allocation.amount)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-sm font-bold text-emerald-400 shrink-0">{fmt(p.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showPayModal && selectedSupplier && (
        <RecordSupplierPaymentDialog
          key={selectedSupplier._id}
          target={selectedSupplier}
          accountPayment
          defaultFullAmount
          recordPayment={recordPayment}
          isSaving={paying}
          onClose={() => setShowPayModal(false)}
        />
      )}
      {showReconciliation && <SupplierReconciliationDialog onClose={() => setShowReconciliation(false)} />}
      {selectedSupplier && <Pagination meta={historyPaging.meta} page={historyPaging.page} onPageChange={historyPaging.setPage} label="supplier payments" />}
    </div>
  );
}
