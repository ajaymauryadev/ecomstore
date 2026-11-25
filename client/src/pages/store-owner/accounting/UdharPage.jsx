import { usePageSize, usePageState } from '../../../hooks/usePagination';
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS, hasPermission } from '../../../constants/permissions';
import LoadError from '../../../components/ui/LoadError';
import {
  Users, Plus, Search, Phone, MapPin, CreditCard, TrendingUp, ChevronRight, X, AlertCircle, MessageCircle, History, ArrowUpRight, ArrowDownLeft,
} from 'lucide-react';
import {
  useGetUdharCustomersQuery,
  useGetUdharStatsQuery,
  useCreateUdharCustomerMutation,
  useGetCustomerLedgerQuery,
} from '../../../features/udhar/udharApi';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { formatCurrency } from '../../../utils/formatters';
import { resolveStoreTimeZone, PAYMENT_METHOD_LABELS } from '../../../utils/accounting';
import { useAuth } from '../../../hooks/useAuth';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';
import ReceivePaymentModal from '../../../components/orders/ReceivePaymentModal';
import CustomerBillsPanel from '../../../components/orders/CustomerBillsPanel';
import BillPaymentHistory from '../../../components/orders/BillPaymentHistory';
import { useCursorPages } from '../../../hooks/useCursorPages';

function fmt(n) {
  return formatCurrency(n ?? 0);
}

function fmtDate(d, timeZone) {
  return new Date(d).toLocaleDateString('en-IN', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric',
  });
}


function StatCard({ label, value, sub, color = 'text-slate-100', icon: Icon, iconColor = 'text-slate-500' }) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</p>
          <p className={cn('text-2xl font-bold break-words tabular-nums', color)}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        {Icon && (
            <div className={cn('p-2.5 rounded-xl bg-navy-700/60 shrink-0', iconColor)}>
            <Icon size={20} />
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerCard({ customer, onClick, selected }) {
  return (
    <button
      onClick={() => onClick(customer)}
      aria-pressed={selected}
      className={cn('w-full bg-navy-800 border rounded-xl p-4 transition-all text-left group', selected ? 'border-gold-500 ring-1 ring-gold-500/20' : 'border-navy-700/60 hover:border-navy-600')}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-gold-400">{customer.name[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-200 truncate">{customer.name}</p>
            <ChevronRight size={16} className="text-slate-600 group-hover:text-gold-400 transition-colors shrink-0" />
          </div>
          {customer.phone && (
            <p className="text-xs text-slate-500 mt-0.5">{customer.phone}</p>
          )}
          {customer.address && <p className="text-xs text-slate-500 mt-1 break-words whitespace-pre-line">{customer.address}</p>}
          {customer.isActive === false && <p className="text-xs text-amber-400 mt-1">Inactive account · Outstanding balance</p>}
          <div className="flex items-center justify-between mt-2">
            <div>
              <p className="text-xs text-slate-500">Due</p>
              <p className={cn('text-sm font-bold', customer.balance > 0 ? 'text-red-400' : 'text-emerald-400')}>
                {fmt(customer.balance)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function LedgerEntry({ entry, timeZone }) {
  const [open, setOpen] = useState(false);
  const isDebit = entry.type === 'debit';
  const order = entry.order;
  const recorder = entry.recordedByName || entry.recordedBy?.name;
  return <article className="ledger-entry space-y-3">
    <div className="flex flex-wrap items-start gap-3">
      <span className={cn('grid place-items-center h-10 w-10 rounded-xl shrink-0', isDebit ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400')}>
        {isDebit ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
      </span>
      <div className="flex-1 min-w-0 basis-32">
        <p className="text-sm font-semibold break-words">{entry.description || (isDebit ? 'Credit sale' : 'Payment received')}</p>
        <p className="text-xs text-slate-500 mt-1">{fmtDate(entry.date || entry.createdAt, timeZone)}{entry.method && ' · ' + (PAYMENT_METHOD_LABELS[entry.method] || entry.method)}</p>
        <p className="text-xs text-slate-500 mt-1">Recorded by {recorder || 'Not recorded'}{entry.recordedByRole && ' (' + entry.recordedByRole.replaceAll('_', ' ') + ')'}</p>
        <p className="text-xs text-slate-500 mt-1">{new Date(entry.createdAt).toLocaleString('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="text-right"><p className={cn('font-bold tabular-nums', isDebit ? 'text-red-400' : 'text-emerald-400')}>{isDebit ? '+' : '−'}{fmt(entry.amount)}</p><p className="text-xs text-slate-500 mt-1">Balance after: {fmt(entry.balanceAfter)}</p></div>
    </div>
    {order?.paymentSummary && isDebit && <div className="ledger-bill-summary">
      <div><span>Bill total</span><strong>{fmt(order.pricing?.grandTotal)}</strong></div>
      <div><span>Paid at purchase</span><strong className="text-emerald-400">{fmt(order.paymentSummary.initialPaid)}</strong></div>
      <div><span>Original Udhar</span><strong>{fmt(order.paymentSummary.originalUdhar)}</strong></div>
      <div><span>Pending on this bill</span><strong className={order.paymentSummary.pending > 0 ? 'text-red-400' : 'text-emerald-400'}>{fmt(order.paymentSummary.pending)}</strong></div>
    </div>}
    {order && <details className="rounded-xl border border-navy-700 bg-navy-750" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium break-all">{isDebit ? 'Purchase details' : 'Bill adjustment'} · {order.orderNumber}</summary>
      <div className="px-3 pb-3 space-y-2">
        <p className="text-xs text-slate-500">{fmtDate(order.createdAt, timeZone)} · {order.orderType?.replaceAll('_', ' ')} · {order.status?.replaceAll('_', ' ')}</p>
        <ul className="space-y-2">{order.items?.map((item, index) => <li key={index} className="flex flex-wrap justify-between gap-2 text-sm border-t border-navy-700 pt-2">
          <div className="flex-1 min-w-0 basis-32"><p className="break-words font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.variantName} · {item.quantity} {item.unit} × {fmt(item.price)}</p>{item.fulfilledQty != null && item.fulfilledQty < item.quantity && <p className="text-xs text-amber-400">Fulfilled: {item.fulfilledQty}</p>}</div><span className="font-semibold tabular-nums">{fmt(item.total)}</span>
        </li>)}</ul>
        <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-navy-700"><p className="text-sm font-semibold">Bill total: {fmt(order.pricing?.grandTotal)}</p><Link className="workspace-link" to={'/store/orders?orderId=' + order._id}>Open order</Link></div>
        {open && order.paymentSummary && <BillPaymentHistory orderId={order._id} fallbackPayments={order.paymentSummary.payments} />}
      </div>
    </details>}
    {entry.allocations?.length > 0 && <div className="text-xs text-slate-500 space-y-1"><p>Applied to oldest pending purchases:</p>{entry.allocations.map((allocation, index) => <p key={index}>{allocation.orderNumber || 'Opening / manual balance'} · {fmt(allocation.amount)}</p>)}</div>}
    {!order && isDebit && <p className="text-xs text-slate-500">{entry.referenceType === 'manual' ? 'Manual credit entry. Item details were not recorded.' : 'Original bill details are unavailable.'}</p>}
  </article>;
}

export default function UdharPage() {
  const { store, user } = useAuth();
  const canManage = hasPermission(user, PERMISSIONS.ACCOUNTING_MANAGE);
  const [searchParams] = useSearchParams();
  const { limit } = usePageSize('rows');
  const [customerPage, setCustomerPage] = usePageState(limit);
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // all | dues
  const [selectedAccount, setSelectedCustomer] = useState(() => /^[a-f\d]{24}$/i.test(searchParams.get('customerId') || '') ? { _id: searchParams.get('customerId') } : null);
  const [showAddModal, setShowAddModal] = useState(() => (searchParams.get('new') === '1' || Boolean(searchParams.get('phone'))) && canManage);
  const [showTxModal, setShowTxModal] = useState(null);
  const [historyTab, setHistoryTab] = useState('bills');
  const ledgerPaging = useCursorPages(`${selectedAccount?._id}:${limit}`);
  const ledgerPage = ledgerPaging.page;

  const [addForm, setAddForm] = useState({ name: searchParams.get('name') || '', phone: searchParams.get('phone') || '', address: '', notes: '' });

  const params = { page: customerPage, limit, search: search || undefined, hasBalance: activeTab === 'dues' ? 'true' : undefined };
  const { data: listData, isLoading, isError, error, refetch } = useGetUdharCustomersQuery(params);
  const statsQuery = useGetUdharStatsQuery();
  const { currentData: ledgerData, isFetching: ledgerLoading, isError: ledgerError, error: ledgerFailure, refetch: refetchLedger } = useGetCustomerLedgerQuery(
    { id: selectedAccount?._id, page: ledgerPage, cursor: ledgerPaging.cursor, limit },
    { skip: !selectedAccount }
  );
  const selectedCustomer = ledgerData?.data?.customer ?? (selectedAccount?.name ? selectedAccount : null);
  const ledgerMeta = ledgerData?.data?.meta || {};
  const selectCustomer = (customer) => { setSelectedCustomer(customer); ledgerPaging.reset(); };
  useEffect(() => {
    if (selectedAccount) document.getElementById('udhar-ledger')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [selectedAccount]);

  const [createCustomer, { isLoading: creating }] = useCreateUdharCustomerMutation();

  const customers = listData?.data ?? [];
  const stats = statsQuery.data?.data ?? {};

  const handleCreate = async () => {
    if (!addForm.name.trim()) return toast.error('Name is required');
    try {
      const result = await createCustomer({
        name: addForm.name,
        phone: addForm.phone || undefined,
        address: addForm.address.trim() || undefined,
        notes: addForm.notes || undefined,
      }).unwrap();
      toast.success('Customer added');
      selectCustomer(result.data.customer);
      setShowAddModal(false);
      setAddForm({ name: '', phone: '', address: '', notes: '' });
    } catch (e) {
      toast.error(e?.data?.message || 'Failed to add');
    }
  };

  const whatsappLink = (customer) => {
    if (!customer?.phone) return null;
    const msg = encodeURIComponent(`Hello ${customer.name}, you have a pending due of ${fmt(customer.balance)} at our store. Please clear at your earliest convenience. Thank you!`);
    return `https://wa.me/91${customer.phone.replace(/\D/g, '')}?text=${msg}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Udhar accounts</h1>
          <p className="text-sm text-slate-500 mt-1">Who owes what, what they purchased and when they paid.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={!canManage} onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Add Customer
          </button>
        </div>
      </div>

      {/* Stats */}
      {statsQuery.isError ? <LoadError title="Could not load the credit summary" error={statsQuery.error} retry={statsQuery.refetch} /> : (
      <div className="grid min-[380px]:grid-cols-2 xl:grid-cols-4 gap-3" aria-busy={statsQuery.isLoading}>
        <StatCard label="Total Customers" value={stats.totalCustomers ?? 0} icon={Users} iconColor="text-blue-400" />
        <StatCard label="With Due" value={stats.customersWithDue ?? 0} icon={AlertCircle} iconColor="text-gold-400" color="text-gold-400" />
        <StatCard label="Total Due" value={fmt(stats.totalDue)} icon={TrendingUp} iconColor="text-red-400" color="text-red-400" />
        <StatCard label="Max Due" value={fmt(stats.maxDue)} icon={CreditCard} iconColor="text-slate-400" />
      </div>)}

      {/* Main layout: list + detail */}
      <div className="grid lg:grid-cols-5 gap-5 items-start">
        {/* Customer list */}
        <div className="lg:col-span-2 space-y-3 min-w-0">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              aria-label="Search credit customers"
              onChange={(e) => { setSearch(e.target.value); setCustomerPage(1); }}
              placeholder="Search by name or mobile number..."
              className="input pl-9 w-full"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'dues'].map((t) => (
              <button
                key={t}
                aria-pressed={activeTab === t}
                onClick={() => { setActiveTab(t); setCustomerPage(1); }}
                className={cn('min-h-11 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', activeTab === t ? 'bg-gold-500/20 text-gold-400 border border-gold-500/30' : 'bg-navy-800 text-slate-400 border border-navy-700/40 hover:border-navy-600')}
              >
                {t === 'all' ? 'All' : 'Has Due'}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {isError ? <LoadError title="Could not load credit customers" error={error} retry={refetch} /> : isLoading ? (
              <p className="text-slate-500 text-sm text-center py-8" role="status">Loading customers…</p>
            ) : customers.length === 0 ? (
              <div className="card text-center py-10 text-slate-500">
                <Users size={40} className="mx-auto mb-2 opacity-30" />
                <p className="font-semibold">{search ? 'No matching accounts' : 'No Udhar accounts yet'}</p>
                <p className="text-sm mt-2">{search ? 'Try a customer name or mobile number.' : 'Add a customer to record purchases on credit and track repayments.'}</p>
                {!search && canManage && <Button className="mt-4" onClick={() => setShowAddModal(true)}>Add first account</Button>}
              </div>
            ) : (
              customers.map((c) => <CustomerCard key={c._id} customer={c} selected={c._id === selectedAccount?._id} onClick={selectCustomer} />)
            )}
          </div>
          {listData?.meta?.totalPages > 1 && <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="secondary" size="sm" disabled={!listData.meta.hasPrevPage} onClick={() => setCustomerPage((value) => value - 1)}>Previous accounts</Button><span className="text-xs text-slate-500">{customerPage} / {listData.meta.totalPages}</span><Button variant="secondary" size="sm" disabled={!listData.meta.hasNextPage} onClick={() => setCustomerPage((value) => value + 1)}>Next accounts</Button></div>}
        </div>

        {/* Detail Panel */}
        <div id="udhar-ledger" className="lg:col-span-3 min-w-0 ledger-detail">
          {ledgerError ? <LoadError title="Could not load customer ledger" error={ledgerFailure} retry={refetchLedger} /> : !selectedCustomer ? (
            <div className="bg-navy-800 border border-navy-700/40 rounded-xl h-full flex items-center justify-center min-h-64">
              <div className="text-center text-slate-500">
                <History size={40} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{selectedAccount && ledgerLoading ? 'Loading customer ledger…' : 'Select a customer to view purchases and payments'}</p>
              </div>
            </div>
          ) : (
            <div className="bg-navy-800 border border-navy-700/40 rounded-xl overflow-hidden">
              {/* Customer header */}
              <div className="p-4 border-b border-navy-700/40 bg-navy-900/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-12 h-12 shrink-0 rounded-full bg-gold-500/10 flex items-center justify-center">
                      <span className="text-lg font-bold text-gold-400">{selectedCustomer.name[0].toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-100 text-lg break-words">{selectedCustomer.name}</p>
                      {selectedCustomer.phone && (
                        <p className="text-sm text-slate-400 flex items-center gap-1">
                          <Phone size={12} /> {selectedCustomer.phone}
                        </p>
                      )}
                      {selectedCustomer.address && <p className="text-sm text-slate-400 flex items-start gap-1 mt-1">
                        <MapPin size={14} className="shrink-0 mt-0.5" />
                        <span className="break-words whitespace-pre-line">{selectedCustomer.address}</span>
                      </p>}
                    </div>
                  </div>
                  <button aria-label="Close customer ledger" onClick={() => setSelectedCustomer(null)} className="workspace-row-action shrink-0 hover:bg-navy-700 text-slate-500">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 mt-4">
                  <div className="bg-navy-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500">Due Amount</p>
                    <p className={cn('text-lg font-bold', selectedCustomer.balance > 0 ? 'text-red-400' : 'text-emerald-400')}>
                      {fmt(selectedCustomer.balance)}
                    </p>
                  </div>

                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <Link to="/store/pos" className="btn-secondary flex-1 justify-center">New purchase in POS</Link>
                  <button
                    disabled={!canManage || !selectedCustomer.balance} onClick={() => { setShowTxModal({}); }}
                    className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ArrowDownLeft size={16} /> Record Payment
                  </button>
                  {selectedCustomer.phone && selectedCustomer.balance > 0 && (
                    <a
                      href={whatsappLink(selectedCustomer)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                      title="Send WhatsApp reminder"
                    >
                      <MessageCircle size={16} />
                    </a>
                  )}
                </div>
              </div>

              {/* Ledger */}
              <div className="p-4 sm:p-5" aria-busy={ledgerLoading}>
                <div className="flex gap-2 mb-4">{['bills', 'history'].map((tab) => <button key={tab} type="button" aria-pressed={historyTab === tab} className={historyTab === tab ? 'btn-primary' : 'btn-secondary'} onClick={() => setHistoryTab(tab)}>{tab === 'bills' ? 'Bills' : 'Account history'}</button>)}</div>
                {historyTab === 'bills' ? <CustomerBillsPanel customerId={selectedCustomer._id} timeZone={timeZone} onReceive={canManage ? (bill) => setShowTxModal({ bill }) : undefined} /> : <>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 className="text-base font-bold">Purchases & payments</h2><span className="text-xs text-slate-500">{ledgerMeta.total || 0} entries</span></div>
                {ledgerData?.data?.summary && <div className="grid grid-cols-2 gap-3 rounded-xl bg-navy-750 p-3 mb-3 text-sm"><div><p className="text-xs text-slate-500">Purchases on Udhar</p><p className="font-bold mt-1">{fmt(ledgerData.data.summary.totalDebits)}</p></div><div><p className="text-xs text-slate-500">Payments & adjustments</p><p className="font-bold mt-1 text-emerald-400">{fmt(ledgerData.data.summary.totalCredits)}</p></div></div>}
                {ledgerLoading && <p role="status" className="text-sm text-slate-500">Loading transactions…</p>}
                {ledgerData?.data?.entries?.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">No transactions yet</p>
                ) : (
                  (ledgerData?.data?.entries ?? []).map((e) => <LedgerEntry key={e._id} entry={e} timeZone={timeZone} />)
                )}
                {(ledgerMeta.totalPages > 1 || ledgerPaging.hasPrevious) && <div className="flex flex-wrap items-center justify-between gap-2 mt-4"><Button variant="secondary" size="sm" disabled={!ledgerPaging.hasPrevious || ledgerLoading} onClick={ledgerPaging.previous}>Previous entries</Button><span className="text-xs text-slate-500">Page {ledgerPage} of {ledgerMeta.totalPages}</span><Button variant="secondary" size="sm" disabled={!ledgerMeta.hasNextPage || ledgerLoading} onClick={() => ledgerPaging.next(ledgerMeta.nextCursor)}>Next entries</Button></div>}
                </>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Customer Modal */}
      {showAddModal && (
        <Modal isOpen onClose={() => setShowAddModal(false)} title="Add Udhar customer" size="md">
            <div className="space-y-4">
              <div>
                <label htmlFor="udhar-customer-name" className="label">Name *</label>
                <input id="udhar-customer-name" className="input w-full" placeholder="Customer name" value={addForm.name} onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="udhar-customer-phone" className="label">Phone</label>
                <input id="udhar-customer-phone" type="tel" maxLength={10} className="input w-full" placeholder="10-digit mobile" value={addForm.phone} onChange={(e) => setAddForm((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="udhar-customer-address" className="label">Address</label>
                <textarea id="udhar-customer-address" rows={3} maxLength={500} className="input w-full resize-none" placeholder="House no., street, area, city and pincode" value={addForm.address} onChange={(e) => setAddForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="udhar-customer-notes" className="label">Notes</label>
                <input id="udhar-customer-notes" className="input w-full" placeholder="Optional notes" value={addForm.notes} onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="flex-1 btn-primary">{creating ? 'Adding...' : 'Add Customer'}</button>
            </div>
        </Modal>
      )}

      {showTxModal && selectedCustomer && <ReceivePaymentModal customer={selectedCustomer} bill={showTxModal.bill} onClose={() => setShowTxModal(null)} onSaved={() => ledgerPaging.reset()} />}
    </div>
  );
}
