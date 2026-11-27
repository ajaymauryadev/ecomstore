import { useSavedViewState } from '../../../offline/useSavedViewState';
import { usePagination } from '../../../hooks/usePagination';
import Pagination from '../../../components/ui/Pagination';
import { useState } from 'react';
import {
  Plus, X, RefreshCw, CheckCircle2, XCircle,
  Package, ArrowLeftRight, ChevronDown, ChevronRight, Trash2,
} from 'lucide-react';
import {
  useGetReturnsQuery,
  useCreateReturnMutation,
  useProcessReturnMutation,
  useGetReturnStatsQuery,
} from '../../../features/returns/returnsApi';
import { useGetProductsQuery } from '../../../features/products/productApi';
import { useGetAdminOrdersQuery } from '../../../features/orders/orderApi';
import { useAuth } from '../../../hooks/useAuth';
import { cn } from '../../../utils/cn';
import toast from 'react-hot-toast';

const STATUS_META = {
  pending:   { label: 'Pending',   color: 'text-gold-400',    bg: 'bg-gold-500/15 border-gold-500/30' },
  approved:  { label: 'Approved',  color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/30' },
  processed: { label: 'Processed', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  rejected:  { label: 'Rejected',  color: 'text-red-400',     bg: 'bg-red-500/15 border-red-500/30' },
};

const REFUND_METHODS = [
  { value: 'cash', label: 'Cash Refund' },
  { value: 'upi', label: 'UPI Refund' },
  { value: 'store_credit', label: 'Store Credit' },
  { value: 'exchange', label: 'Exchange Only' },
  { value: 'no_refund', label: 'No Refund' },
];

function fmt(n) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

/* ── Product search for return item picker ── */
function ProductSearch({ onSelect, placeholder = 'Search product...' }) {
  const [search, setSearch] = useSavedViewState('ReturnsPage:ProductSearch:search', '');
  const [open, setOpen] = useState(false);
  const { data } = useGetProductsQuery({ search, isActive: true, limit: 10 }, { skip: search.length < 2 });
  const products = data?.data ?? [];

  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full bg-navy-900 border border-navy-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60"
      />
      {open && products.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 bg-navy-800 border border-navy-700/60 rounded-xl mt-1 shadow-xl overflow-hidden">
          {products.map((p) => (
            <button
              key={p._id}
              onClick={() => { onSelect(p); setSearch(''); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-navy-700/50 text-left text-sm transition-colors"
            >
              <Package size={14} className="text-slate-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-slate-200 truncate">{p.name}</p>
                <p className="text-xs text-slate-500">
                  {p.variants?.filter((v) => v.isActive).length} variant(s)
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Create Return Form ── */
function CreateReturnForm({ type, onSuccess, onCancel }) {
  const { store } = useAuth();
  const [items, setItems] = useState([]);
  const [exchangeItems, setExchangeItems] = useState([]);
  const [refundMethod, setRefundMethod] = useState('cash');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [adjustBalance, setAdjustBalance] = useState(true);
  const [notes, setNotes] = useSavedViewState('ReturnsPage:CreateReturnForm:notes', '');
  const [showVariantPicker, setShowVariantPicker] = useState(null);

  const { data: ordersData } = useGetAdminOrdersQuery(
    { slug: store?.slug, search: orderSearch, status: 'delivered,partially_fulfilled', limit: 5 },
    { skip: type !== 'customer_return' || !store?.slug || Boolean(selectedOrder) || orderSearch.length < 3 }
  );
  const orders = ordersData?.data ?? [];

  const [createReturn, { isLoading }] = useCreateReturnMutation();

  const addReturnItem = (product, variant) => {
    setItems((prev) => [
      ...prev,
      {
        _id: String(variant._id),
        productId: String(product._id),
        variantId: String(variant._id),
        name: product.name,
        variantName: variant.name,
        unit: variant.unit,
        qty: 1,
        unitPrice: variant.offerPrice || variant.retailPrice,
        reason: '',
        condition: 'good',
        restockItem: true,
      },
    ]);
    setShowVariantPicker(null);
  };

  const addExchangeItem = (product, variant) => {
    setExchangeItems((prev) => [
      ...prev,
      {
        _id: Date.now(),
        productId: String(product._id),
        variantId: String(variant._id),
        name: product.name,
        variantName: variant.name,
        qty: 1,
        unitPrice: variant.offerPrice || variant.retailPrice,
      },
    ]);
    setShowVariantPicker(null);
  };

  const updateItem = (id, field, val) =>
    setItems((arr) => arr.map((i) => (i._id === id ? { ...i, [field]: val } : i)));

  const updateExchange = (id, field, val) =>
    setExchangeItems((arr) => arr.map((i) => (i._id === id ? { ...i, [field]: val } : i)));

  const handleSubmit = async () => {
    if (type === 'customer_return' && !selectedOrder) return toast.error('Select the original order');
    if (!items.length) return toast.error('Add at least one item');
    try {
      await createReturn({
        type,
        orderId: selectedOrder?._id,
        items: items.map(({ productId, variantId, qty, reason, condition, restockItem }) =>
          ({ productId, variantId, qty: Number(qty), reason, condition, restockItem })),
        exchangeItems: exchangeItems.map(({ _id, ...i }) => ({ ...i, qty: Number(i.qty), unitPrice: Number(i.unitPrice) })),
        refundMethod,
        adjustSupplierBalance: adjustBalance,
        notes,
      }).unwrap();
      toast.success('Return created');
      onSuccess();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to create return');
    }
  };

  const VariantSelect = ({ product, onPick }) => {
    const active = product.variants?.filter((v) => v.isActive) ?? [];
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-navy-800 border border-navy-700/60 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700/40">
            <p className="font-semibold text-sm text-slate-100">{product.name}</p>
            <button onClick={() => setShowVariantPicker(null)} className="text-slate-400"><X size={16} /></button>
          </div>
          <div className="p-3 space-y-1.5">
            {active.map((v) => (
              <button key={v._id} onClick={() => onPick(product, v)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-navy-600 hover:border-gold-500/50 text-sm text-slate-200 transition-all">
                <span>{v.name} · {v.unit}</span>
                <span className="text-gold-400 font-semibold">₹{(v.offerPrice || v.retailPrice)?.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Order ref (customer return) */}
      {type === 'customer_return' && (
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Original Order</p>
          <div className="relative">
            <input
              value={orderSearch}
              onChange={(e) => {
                setSelectedOrder(null);
                setItems([]);
                setOrderSearch(e.target.value);
              }}
              placeholder="Search order number..."
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60"
            />
            {!selectedOrder && orders.length > 0 && orderSearch.length >= 3 && (
              <div className="absolute top-full left-0 right-0 z-20 bg-navy-800 border border-navy-700/60 rounded-xl mt-1 shadow-xl">
                {orders.map((o) => (
                  <button key={o._id} onClick={() => {
                    setSelectedOrder(o);
                    setItems([]);
                    setOrderSearch(o.orderNumber);
                  }}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-navy-700/50 text-sm text-left">
                    <span className="text-slate-200">{o.orderNumber}</span>
                    <span className="text-slate-500 text-xs">{o.customerInfo?.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Return items */}
      <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Return Items</p>
        </div>
        {type === 'customer_return' ? (
          <div className="flex flex-wrap gap-2">
            {selectedOrder?.items?.filter((line) => (line.fulfilledQty ?? line.quantity) > 0).map((line) => (
              <button key={line.variantId} type="button"
                disabled={items.some((item) => item.variantId === line.variantId)}
                onClick={() => addReturnItem(
                  { _id: line.productId, name: line.name },
                  { _id: line.variantId, name: line.variantName, unit: line.unit, retailPrice: line.price }
                )}
                className="rounded-lg border border-navy-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">
                {line.name} · {line.variantName}
              </button>
            ))}
          </div>
        ) : <ProductSearch onSelect={(p) => {
          const active = p.variants?.filter((v) => v.isActive) ?? [];
          if (active.length === 1) addReturnItem(p, active[0]);
          else setShowVariantPicker({ product: p, mode: 'return' });
        }} placeholder="Search product to return..." />}
        {items.map((item) => (
          <div key={item._id} className="bg-navy-900/60 border border-navy-700/40 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">{item.name} · {item.variantName}</p>
              <button onClick={() => setItems((a) => a.filter((i) => i._id !== item._id))} className="text-slate-600 hover:text-red-400"><Trash2 size={13} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-slate-500 block mb-1">Qty</label>
                <input type="number" min="1" value={item.qty} onChange={(e) => updateItem(item._id, 'qty', e.target.value)}
                  className="w-full bg-navy-800 border border-navy-600 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-gold-500/60" />
              </div>
              <div>
                {type === 'customer_return' && (
                  <>
                    <p className="mb-1 text-slate-500">Original Unit Price</p>
                    <p className="py-1.5 text-slate-200">{fmt(item.unitPrice)}</p>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Condition</label>
                <select value={item.condition} onChange={(e) => updateItem(item._id, 'condition', e.target.value)}
                  className="w-full bg-navy-800 border border-navy-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none">
                  <option value="good">Good</option>
                  <option value="opened">Opened</option>
                  <option value="damaged">Damaged</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={item.restockItem} onChange={(e) => updateItem(item._id, 'restockItem', e.target.checked)}
                  className="accent-gold-500" />
                <label className="text-xs text-slate-400">Add back to stock</label>
              </div>
            </div>
            <input value={item.reason} onChange={(e) => updateItem(item._id, 'reason', e.target.value)}
              placeholder="Reason for return..."
              className="w-full bg-navy-800 border border-navy-600 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60" />
          </div>
        ))}
      </div>

      {/* Exchange items */}
      {type === 'customer_return' && (
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Exchange Items (optional)</p>
          <ProductSearch onSelect={(p) => {
            const active = p.variants?.filter((v) => v.isActive) ?? [];
            if (active.length === 1) addExchangeItem(p, active[0]);
            else setShowVariantPicker({ product: p, mode: 'exchange' });
          }} placeholder="Search replacement product..." />
          {exchangeItems.map((item) => (
            <div key={item._id} className="flex items-center gap-3 bg-navy-900/60 border border-navy-700/40 rounded-xl p-3">
              <div className="flex-1">
                <p className="text-sm text-slate-200">{item.name} · {item.variantName}</p>
                <p className="text-xs text-slate-500">₹{item.unitPrice} × {item.qty}</p>
              </div>
              <input type="number" min="1" value={item.qty} onChange={(e) => updateExchange(item._id, 'qty', Number(e.target.value))}
                className="w-14 bg-navy-800 border border-navy-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 text-center focus:outline-none" />
              <button onClick={() => setExchangeItems((a) => a.filter((i) => i._id !== item._id))} className="text-slate-600 hover:text-red-400"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Refund method + totals */}
      {type === 'customer_return' && (
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Refund Method</p>
          <div className="flex flex-wrap gap-2">
            {REFUND_METHODS.map((m) => (
              <button key={m.value} onClick={() => setRefundMethod(m.value)}
                className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                  refundMethod === m.value ? 'border-gold-500/50 bg-gold-500/10 text-gold-400' : 'border-navy-600 text-slate-400'
                )}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">The refund is calculated from the original bill and confirmed at approval.</p>
        </div>
      )}

      {/* Purchase return specifics */}
      {type === 'purchase_return' && (
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Supplier Details</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={adjustBalance} onChange={(e) => setAdjustBalance(e.target.checked)} className="accent-gold-500" />
            <span className="text-sm text-slate-300">Adjust supplier pending balance</span>
          </label>
        </div>
      )}

      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes..."
        rows={2}
        className="w-full bg-navy-800 border border-navy-700/60 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60 resize-none" />

      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-navy-600 text-slate-400 font-medium text-sm">Cancel</button>
        <button disabled={isLoading || !items.length} onClick={handleSubmit}
          className="flex-1 py-3 rounded-xl bg-gold-500 text-navy-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {isLoading && <RefreshCw size={14} className="animate-spin" />}
          Create Return
        </button>
      </div>

      {showVariantPicker && (
        <VariantSelect
          product={showVariantPicker.product}
          onPick={showVariantPicker.mode === 'return' ? addReturnItem : addExchangeItem}
        />
      )}
    </div>
  );
}

/* ── Return list row ── */
function ReturnRow({ ret }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[ret.status] ?? STATUS_META.pending;
  const [processReturn, { isLoading }] = useProcessReturnMutation();

  const handleProcess = async (action) => {
    try {
      await processReturn({ id: ret._id, action }).unwrap();
      toast.success(action === 'approve' ? 'Return processed' : 'Return rejected');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed');
    }
  };

  return (
    <div className="bg-navy-800 border border-navy-700/40 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-200">{ret.returnNumber}</p>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize', meta.bg, meta.color)}>
              {meta.label}
            </span>
            {ret.type === 'purchase_return' && (
              <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded-full">Purchase</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {ret.customerInfo?.name || ret.supplierName || 'N/A'}
            {ret.orderNumber && ` · #${ret.orderNumber}`}
            {' · '}{new Date(ret.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right shrink-0">
          {ret.type === 'customer_return' ? (
            <p className={cn('text-sm font-semibold', ret.netRefund >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {fmt(ret.netRefund)}
            </p>
          ) : (
            <p className="text-sm font-semibold text-slate-300">{fmt(ret.totalValue)}</p>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-slate-300 shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-navy-700/40 px-4 py-3 space-y-3">
          <div className="space-y-1.5">
            {ret.items?.map((item) => (
              <div key={item._id} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{item.name} · {item.variantName} × {item.qty}</span>
                <div className="flex items-center gap-3 text-slate-500">
                  <span className="capitalize">{item.condition}</span>
                  {item.restockItem && <span className="text-emerald-500">↩ restock</span>}
                  {ret.type === 'customer_return' && <span className="text-emerald-400">+{fmt(item.refundAmount)}</span>}
                </div>
              </div>
            ))}
          </div>
          {ret.exchangeItems?.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Exchange items:</p>
              {ret.exchangeItems.map((item) => (
                <p key={item._id} className="text-xs text-orange-400">{item.name} · {item.variantName} × {item.qty}</p>
              ))}
            </div>
          )}
          {ret.notes && <p className="text-xs text-slate-500 italic">&quot;{ret.notes}&quot;</p>}

          {ret.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <button disabled={isLoading} onClick={() => handleProcess('reject')}
                className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
                <XCircle size={13} /> Reject
              </button>
              <button disabled={isLoading} onClick={() => handleProcess('approve')}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
                {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Process & Approve
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function ReturnsPage() {
  const [activeType, setActiveType] = useSavedViewState('ReturnsPage:ReturnsPage:activeType', 'customer_return');
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useSavedViewState('ReturnsPage:ReturnsPage:statusFilter', '');

  const paging = usePagination(`${activeType}:${statusFilter}`);
  const { data, isLoading, isFetching, refetch } = useGetReturnsQuery({
    type: activeType,
    status: statusFilter || undefined,
    page: paging.page, limit: paging.limit,
  });
  const { data: statsData } = useGetReturnStatsQuery({});
  const returns = data?.data ?? [];
  const stats = statsData?.data?.stats ?? [];

  const customerStats = stats.find((s) => s._id === 'customer_return');
  const purchaseStats = stats.find((s) => s._id === 'purchase_return');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Returns & Exchange</h1>
          <p className="text-xs text-slate-500 mt-0.5">Customer returns and supplier returns</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 bg-gold-500 text-navy-950 rounded-xl font-semibold text-sm hover:bg-gold-400"
        >
          <Plus size={15} /> New Return
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4">
          <p className="text-xs text-slate-500">Customer Returns (processed)</p>
          <p className="text-lg font-bold text-slate-100">{customerStats?.count ?? 0}</p>
          <p className="text-sm text-red-400 font-medium">{fmt(customerStats?.totalRefund)}</p>
        </div>
        <div className="bg-navy-800 border border-navy-700/60 rounded-xl p-4">
          <p className="text-xs text-slate-500">Purchase Returns (processed)</p>
          <p className="text-lg font-bold text-slate-100">{purchaseStats?.count ?? 0}</p>
          <p className="text-sm text-blue-400 font-medium">{fmt(purchaseStats?.totalValue)}</p>
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 bg-navy-800 border border-navy-700/60 rounded-xl p-1">
        {[
          { value: 'customer_return', label: 'Customer Returns' },
          { value: 'purchase_return', label: 'Purchase Returns' },
        ].map((tab) => (
          <button key={tab.value} onClick={() => setActiveType(tab.value)}
            className={cn('flex-1 py-2 rounded-lg text-xs font-semibold transition-all',
              activeType === tab.value ? 'bg-navy-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
            )}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 flex-wrap">
        {['', 'pending', 'processed', 'rejected'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('px-3 py-1 rounded-full border text-xs font-medium transition-all capitalize',
              statusFilter === s ? 'border-gold-500/50 bg-gold-500/10 text-gold-400' : 'border-navy-600 text-slate-500'
            )}>
            {s || 'All'}
          </button>
        ))}
        <button onClick={refetch} className="ml-auto p-1.5 rounded-lg hover:bg-navy-700 text-slate-400">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-navy-800 rounded-xl animate-pulse" />)}
        </div>
      ) : returns.length === 0 ? (
        <div className="text-center py-12">
          <ArrowLeftRight size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500">No returns found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {returns.map((ret) => (
            <ReturnRow key={ret._id} ret={ret} />
          ))}
        </div>
      )}

      <Pagination meta={data?.meta} page={paging.page} onPageChange={paging.setPage} isFetching={isFetching} label="returns" />
      {/* Create form modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 pt-8">
            <div className="w-full max-w-lg bg-navy-900 border border-navy-700/60 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-navy-700/40">
                <p className="font-semibold text-slate-100">
                  New {activeType === 'customer_return' ? 'Customer' : 'Purchase'} Return
                </p>
                <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-200"><X size={18} /></button>
              </div>
              <div className="p-5">
                <CreateReturnForm
                  type={activeType}
                  onSuccess={() => { setShowCreate(false); refetch(); }}
                  onCancel={() => setShowCreate(false)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

