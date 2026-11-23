import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetSupplierReconciliationQuery } from '../../features/suppliers/supplierApi';
import { ROUTES } from '../../constants/routes';
import { formatCurrency } from '../../utils/formatters';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

const fields = [
  ['pendingAmount', 'Pending due'],
  ['totalPaid', 'Total paid'],
  ['totalPurchased', 'Net purchases'],
];

export default function SupplierReconciliationDialog({ onClose }) {
  const [page, setPage] = useState(1);
  const { currentData, isFetching, error } = useGetSupplierReconciliationQuery({ page });
  const rows = currentData?.data ?? [];
  const meta = currentData?.meta;

  return (
    <Modal isOpen title="Supplier Reconciliation" size="lg" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-400">Read-only comparison of supplier account totals and invoice entries.</p>
      {error ? (
        <p role="alert" className="text-sm text-red-400">{error.data?.message || 'Could not load reconciliation.'}</p>
      ) : isFetching ? (
        <p role="status" className="text-sm text-slate-400">Checking supplier balances…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No supplier or invoice mismatches found.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <section key={row.supplierId} className="space-y-2 rounded-xl border border-navy-700 p-3">
              <h3 className="text-sm font-semibold">{row.supplierName}</h3>
              <dl className="grid gap-2 sm:grid-cols-3">
                {fields.map(([field, label]) => (
                  <div key={field} className="text-xs text-slate-400">
                    <dt className="font-medium text-slate-300">{label}</dt>
                    <dd>Account {formatCurrency(row.stored[field])}</dd>
                    <dd>Invoices {formatCurrency(row.expected[field])}</dd>
                  </div>
                ))}
              </dl>
              {row.invoiceCount > 0 && (
                <ul className="space-y-1 text-xs">
                  {row.invoices.map((invoice) => (
                    <li key={invoice.purchaseId} className="flex flex-wrap justify-between gap-2">
                      <Link className="text-gold-400" to={ROUTES.STORE.PURCHASE_DETAIL(invoice.purchaseId)}>
                        {invoice.invoiceNumber || 'Invoice ' + invoice.purchaseId}
                      </Link>
                      <span className="text-slate-400">
                        {formatCurrency(invoice.storedPending)} {invoice.storedStatus}
                        {invoice.storedPending !== invoice.expectedPending || invoice.storedStatus !== invoice.expectedStatus
                          ? ' → ' + formatCurrency(invoice.expectedPending) + ' ' + invoice.expectedStatus
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {meta?.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button variant="secondary" size="sm" disabled={!meta.hasPrevPage} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-xs text-slate-400">Page {page} of {meta.totalPages}</span>
              <Button variant="secondary" size="sm" disabled={!meta.hasNextPage} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
