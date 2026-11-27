import { useSavedViewState } from '../../../offline/useSavedViewState';
import { useState } from 'react';
import { Download, Package, ShoppingBag, Users, Warehouse, BookOpen, Database, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { selectAccessToken } from '../../../features/auth/authSlice';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

const EXPORTS = [
  {
    id: 'full', label: 'Full Backup', desc: 'Store settings, linked business records, ledger history, and uploads with an integrity manifest',
    icon: Database, color: 'text-purple-400 bg-purple-500/10', endpoint: '/backup/full',
  },
  {
    id: 'products', label: 'Products', desc: 'All product catalogue with variants, pricing, images',
    icon: Package, color: 'text-blue-400 bg-blue-500/10', endpoint: '/backup/products',
  },
  {
    id: 'orders', label: 'Orders', desc: 'Order history with customer info, items, payment status',
    icon: ShoppingBag, color: 'text-gold-400 bg-gold-500/10', endpoint: '/backup/orders',
    hasDateFilter: true,
  },
  {
    id: 'customers', label: 'Customers', desc: 'Customer profiles, contact info (no passwords)',
    icon: Users, color: 'text-teal-400 bg-teal-500/10', endpoint: '/backup/customers',
  },
  {
    id: 'inventory', label: 'Inventory', desc: 'Current stock levels and up to 10,000 recent ledger entries',
    icon: Warehouse, color: 'text-orange-400 bg-orange-500/10', endpoint: '/backup/inventory',
  },
  {
    id: 'accounting', label: 'Accounting', desc: 'Expenses, staff salaries, and Udhar customer balances',
    icon: BookOpen, color: 'text-green-400 bg-green-500/10', endpoint: '/backup/accounting',
  },
];

export default function BackupPage() {
  const token = useSelector(selectAccessToken);
  const [loading, setLoading] = useState({});
  const [dateFrom, setDateFrom] = useSavedViewState('BackupPage:BackupPage:dateFrom', '');
  const [dateTo, setDateTo] = useSavedViewState('BackupPage:BackupPage:dateTo', '');

  const downloadExport = async (exportItem) => {
    setLoading((l) => ({ ...l, [exportItem.id]: true }));
    try {
      let url = `${API_URL}${exportItem.endpoint}`;
      if (exportItem.hasDateFilter && (dateFrom || dateTo)) {
        const params = new URLSearchParams();
        if (dateFrom) params.set('from', dateFrom);
        if (dateTo) params.set('to', dateTo);
        url += '?' + params.toString();
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.message || 'The server could not prepare the export.');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="(.+)"/)?.[1] || `export-${exportItem.id}-${Date.now()}.json`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);

      toast.success(`${exportItem.label} exported!`);
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setLoading((l) => ({ ...l, [exportItem.id]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Backup & Export</h1>
        <p className="text-slate-500 text-sm mt-1">Export your store data as JSON files for safekeeping or migration</p>
      </div>

      {/* Warning */}
      <div className="flex gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
        <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-300">Data Export Notice</p>
          <p className="text-xs text-amber-400/80 mt-0.5">Exported files contain sensitive business data. Store them securely and do not share with unauthorized persons.</p>
        </div>
      </div>

      {/* Order date filter */}
      <div className="card p-4">
        <p className="text-sm font-medium text-slate-300 mb-3">Order Export Date Range (optional)</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor="export-from" className="label">From Date</label>
            <input id="export-from" className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label htmlFor="export-to" className="label">To Date</label>
            <input id="export-to" className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Export cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {EXPORTS.map((exp) => {
          const Icon = exp.icon;
          return (
            <div key={exp.id} className="card p-5 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className={`p-2.5 rounded-xl shrink-0 ${exp.color}`}>
                  <Icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-200 text-sm">{exp.label}</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{exp.desc}</p>
                </div>
              </div>
              <button
                onClick={() => downloadExport(exp)}
                disabled={loading[exp.id]}
                className="btn-secondary w-full text-sm gap-2 justify-center"
              >
                <Download size={14} />
                {loading[exp.id] ? 'Exporting...' : `Export ${exp.label}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card p-5 border-dashed">
        <h3 className="font-semibold text-slate-300 mb-2">Disaster recovery</h3>
        <p className="text-sm text-slate-500">Contact support to request recovery from an encrypted service backup.</p>
      </div>
    </div>
  );
}
