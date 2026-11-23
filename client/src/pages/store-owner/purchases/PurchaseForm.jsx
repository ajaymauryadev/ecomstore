import { useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Search, Package, Truck } from 'lucide-react';
import { useCreatePurchaseMutation, useGetPurchaseQuery, useRecordPurchasePaymentMutation } from '../../../features/purchases/purchaseApi';
import { useGetSuppliersQuery } from '../../../features/suppliers/supplierApi';
import { useGetProductsQuery } from '../../../features/products/productApi';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import LoadError from '../../../components/ui/LoadError';
import RecordSupplierPaymentDialog from '../../../components/purchases/RecordSupplierPaymentDialog';
import { formatCurrency } from '../../../utils/formatters';
import { cn } from '../../../utils/cn';
import { ROUTES } from '../../../constants/routes';
import toast from 'react-hot-toast';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { matchesProduct } from '../../../features/pos/catalog';

const VEHICLE_TYPES = [
  { value: 'truck', label: '🚛 Truck' },
  { value: 'pickup', label: '🚐 Pickup' },
  { value: 'tempo', label: '🚚 Tempo' },
  { value: 'cart', label: '🛒 Cart' },
  { value: 'other', label: '📦 Other' },
];

const EMPTY_ITEM = {
  productId: '', variantId: '', productName: '', variantName: '',
  unit: '', quantity: '', purchasePrice: '', sellingPrice: '',
};

/* Product picker popover */
function ProductPicker({ onSelect, searchInput }) {
  const [search, setSearch] = useState('');
  const settledSearch = useDebouncedValue(search.trim());
  const { currentData, isFetching, isError, error, refetch } = useGetProductsQuery({ search: settledSearch, limit: 20, isActive: true });
  const products = (currentData?.data || []).filter((product) => matchesProduct(product, search));
  const options = products.flatMap((product) =>
    (product.variants || []).filter((variant) => variant.isActive).map((variant) => ({ product, variant }))
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search product..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-8 w-full text-sm"
          ref={searchInput}
        />
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {isFetching && !currentData ? (
          <p role="status" className="text-center text-slate-500 text-sm py-4">Loading products...</p>
        ) : isError ? (
          <LoadError title="Unable to load products" error={error} retry={refetch} />
        ) : options.length > 0 ? (
          options.map(({ product, variant }) => (
            <button
              key={`${product._id}_${variant._id}`}
              type="button"
              onClick={() => onSelect(product, variant)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-navy-700 text-left transition-colors"
            >
              <Package size={14} className="text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200 truncate">{product.name}</p>
                <p className="text-xs text-slate-500">{variant.name} · {variant.unit} · Stock: {variant.stock}</p>
              </div>
              <span className="text-xs text-gold-400 shrink-0">{formatCurrency(variant.retailPrice)}</span>
            </button>
          ))
        ) : (
          <p className="text-center text-slate-500 text-sm py-4">No products found</p>
        )}
      </div>
    </div>
  );
}

/* View-only purchase detail */
function PurchaseDetail({ id }) {
  const { data, isLoading } = useGetPurchaseQuery(id);
  const [payModal, setPayModal] = useState(false);
  const [recordPayment, { isLoading: isPaying }] = useRecordPurchasePaymentMutation();

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 rounded-full border-2 border-gold-500 border-t-transparent" /></div>;

  const purchase = data?.data?.purchase;
  if (!purchase) return <p className="text-slate-400">Purchase not found.</p>;

  return (
    <div className="space-y-5">
      {/* Header info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Invoice', value: purchase.invoiceNumber || '—' },
          { label: 'Supplier', value: purchase.supplierId?.name || purchase.supplierName || 'Walk-in' },
          { label: 'Date', value: new Date(purchase.purchaseDate).toLocaleDateString('en-IN') },
          { label: 'Vehicle', value: purchase.vehicleType },
        ].map((f) => (
          <div key={f.label} className="kpi-card py-3">
            <p className="text-xs text-slate-400">{f.label}</p>
            <p className="text-sm font-semibold text-slate-200 mt-0.5 capitalize">{f.value}</p>
          </div>
        ))}
      </div>

      {/* Items */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-700/60">
          <h3 className="text-sm font-semibold text-slate-200">Items ({purchase.items?.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>Qty</th>
                <th>Purchase Price</th>
                <th>Selling Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items?.map((item) => (
                <tr key={item._id}>
                  <td><span className="text-sm text-slate-200">{item.productName}</span></td>
                  <td><span className="text-xs text-slate-400">{item.variantName}</span></td>
                  <td><span className="text-sm text-slate-300">{item.quantity} {item.unit}</span></td>
                  <td><span className="text-sm text-slate-300">{formatCurrency(item.purchasePrice)}</span></td>
                  <td><span className="text-sm text-slate-300">{item.sellingPrice ? formatCurrency(item.sellingPrice) : '—'}</span></td>
                  <td><span className="text-sm font-semibold text-slate-100">{formatCurrency(item.totalCost)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment summary */}
      <div className="card max-w-sm ml-auto">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">Total Amount</span><span className="font-bold text-slate-100">{formatCurrency(purchase.totalAmount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Paid</span><span className="text-emerald-400">{formatCurrency(purchase.paidAmount)}</span></div>
          {purchase.accountEntries?.some((entry) => entry.type === 'return_credit') && (
            <div className="flex justify-between">
              <span className="text-slate-400">Supplier Credits</span>
              <span>{formatCurrency(purchase.accountEntries.reduce((sum, entry) => sum + (entry.type === 'return_credit' ? entry.amount : 0), 0))}</span>
            </div>
          )}
          <div className="flex justify-between"><span className="text-slate-400">Payment Status</span><span>{purchase.paymentStatus}</span></div>
          <div className="flex justify-between border-t border-navy-700/60 pt-2"><span className="text-slate-300 font-medium">Pending</span><span className={cn('font-bold', purchase.pendingAmount > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrency(purchase.pendingAmount)}</span></div>
        </div>
        {purchase.paymentStatus !== 'PAID' && (
          <Button size="sm" className="mt-3 w-full" onClick={() => setPayModal(true)}>Record Payment</Button>
        )}
      </div>

      {purchase.accountEntries?.length > 0 && (
        <section className="card space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">Invoice Allocation History</h3>
          <ul className="divide-y divide-navy-700">
            {purchase.accountEntries.map((entry) => (
              <li key={entry.referenceId} className="flex flex-wrap justify-between gap-2 py-2 text-sm text-slate-300">
                <span>{entry.type === 'return_credit' ? 'Purchase return credit' : entry.method.replaceAll('_', ' ')} · {new Date(entry.postedAt).toLocaleString('en-IN')}</span>
                <span>{formatCurrency(entry.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {payModal && (
        <RecordSupplierPaymentDialog
          target={purchase}
          recordPayment={recordPayment}
          isSaving={isPaying}
          onClose={() => setPayModal(false)}
        />
      )}
    </div>
  );
}

/* ─── Main PurchaseForm ───────────────────────────────────── */
export default function PurchaseForm() {
  const navigate = useNavigate();
  const { id } = useParams(); // if id exists → view mode
  const [createPurchase, { isLoading }] = useCreatePurchaseMutation();

  // Form state
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [vehicleType, setVehicleType] = useState('other');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [note, setNote] = useState('');
  const productSearchInput = useRef(null);
  const [pickerIndex, setPickerIndex] = useState(null); // which item row is picking

  const { data: suppliersData } = useGetSuppliersQuery({ limit: 100 });
  const suppliers = suppliersData?.data?.suppliers || [];

  const totalAmount = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.purchasePrice) || 0;
    return sum + qty * price;
  }, 0);

  const pendingAmount = totalAmount - (parseFloat(paidAmount) || 0);

  const handleSelectProduct = useCallback((product, variant) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[pickerIndex] = {
        productId: product._id,
        variantId: variant._id,
        productName: product.name,
        variantName: variant.name,
        unit: variant.unit,
        quantity: 1,
        purchasePrice: variant.purchasePrice ?? '',
        sellingPrice: variant.retailPrice || '',
      };
      return updated;
    });
    setPickerIndex(null);
  }, [pickerIndex]);

  const updateItem = (idx, field, value) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (isLoading) return;
    if (!items.some((i) => i.productId)) return toast.error('Add at least one product');
    const validItems = items.filter((i) => i.productId);
    if (validItems.some((i) => !Number.isInteger(Number(i.quantity)) || Number(i.quantity) < 1
      || i.purchasePrice === '' || !Number.isFinite(Number(i.purchasePrice)) || Number(i.purchasePrice) < 0)) {
      return toast.error('Enter a whole-number quantity and purchase price for every selected item.');
    }
    if (!Number.isFinite(Number(paidAmount)) || Number(paidAmount) < 0 || Number(paidAmount) > totalAmount) {
      return toast.error('Amount paid must be between zero and the purchase total.');
    }

    try {
      await createPurchase({
        supplierId: supplierId || undefined,
        supplierName: !supplierId ? supplierName : undefined,
        invoiceNumber, purchaseDate, vehicleType, vehicleNumber,
        items: validItems.map((i) => ({
          ...i,
          quantity: parseFloat(i.quantity),
          purchasePrice: parseFloat(i.purchasePrice),
          sellingPrice: i.sellingPrice ? parseFloat(i.sellingPrice) : undefined,
        })),
        paidAmount: parseFloat(paidAmount) || 0,
        paymentMethod, note,
      }).unwrap();
      toast.success('Purchase entry saved! Stock updated.');
      navigate(ROUTES.STORE.PURCHASES);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save purchase');
    }
  };

  // View mode
  if (id) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <Link to={ROUTES.STORE.PURCHASES} className="p-2 rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="page-title">Purchase Detail</h1>
        </div>
        <PurchaseDetail id={id} />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={ROUTES.STORE.PURCHASES} className="p-2 rounded-xl hover:bg-navy-800 text-slate-400 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="page-title">New Purchase Entry</h1>
          <p className="text-slate-400 text-sm mt-0.5">Choose items, enter quantities and save to update stock.</p>
        </div>
      </div>

      {/* Section: Purchase Info */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Truck size={15} className="text-gold-400" /> Purchase Details
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Supplier</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="input w-full"
            >
              <option value="">-- Walk-in / No supplier --</option>
              {suppliers.map((s) => (
                <option key={s._id} value={s._id}>{s.name} {s.companyName ? `(${s.companyName})` : ''}</option>
              ))}
            </select>
          </div>
          {!supplierId && (
            <Input
              label="Supplier Name (walk-in)"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Optional name"
            />
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input
            label="Invoice No."
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="INV-001"
          />
          <Input
            label="Purchase Date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Vehicle Type</label>
            <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="input w-full">
              {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <Input
            label="Vehicle No."
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            placeholder="MH01AB1234"
          />
        </div>
      </div>

      {/* Section: Items */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Package size={15} className="text-gold-400" /> Items
          </h2>
          <button
            type="button"
            onClick={addItem}
            className="btn btn-secondary btn-sm gap-1.5"
          >
            <Plus size={13} /> Add Row
          </button>
        </div>

        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="bg-navy-800/60 border border-navy-700/60 rounded-xl p-3 space-y-2">
              {/* Product selector */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerIndex(idx)}
                  className={cn(
                    'flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors',
                    item.productId
                      ? 'bg-navy-700 border-navy-600 text-slate-200'
                      : 'bg-navy-700/50 border-dashed border-navy-600 text-slate-500 hover:border-gold-500/40 hover:text-slate-400'
                  )}
                >
                  <Package size={13} className="shrink-0" />
                  {item.productId ? (
                    <span>{item.productName} · <span className="text-slate-400">{item.variantName}</span></span>
                  ) : (
                    'Click to select product...'
                  )}
                </button>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* Numeric fields */}
              {item.productId && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Quantity ({item.unit})</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      placeholder="0"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Purchase Price (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.purchasePrice}
                      onChange={(e) => updateItem(idx, 'purchasePrice', e.target.value)}
                      placeholder="0.00"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Selling Price (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.sellingPrice}
                      onChange={(e) => updateItem(idx, 'sellingPrice', e.target.value)}
                      placeholder="optional"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div className="flex flex-col justify-end pb-0.5">
                    <label className="text-xs text-slate-400 block mb-1">Line Total</label>
                    <p className="text-sm font-bold text-gold-400 px-2">
                      {formatCurrency((parseFloat(item.quantity) || 0) * (parseFloat(item.purchasePrice) || 0))}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Section: Payment */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-200">Payment</h2>
        <button type="button" className="btn-secondary" disabled={!totalAmount} onClick={() => setPaidAmount(String(totalAmount))}>Pay full amount · {formatCurrency(totalAmount)}</button>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Input
            label="Amount Paid (₹)"
            type="number"
            min="0"
            max={totalAmount}
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value)}
            placeholder="0"
          />
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Payment Method</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input w-full">
              <option value="cash">💵 Cash</option>
              <option value="upi">📱 UPI</option>
              <option value="bank_transfer">🏦 Bank Transfer</option>
              <option value="cheque">📝 Cheque</option>
              <option value="credit">💳 Credit</option>
            </select>
          </div>
          <Input
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any notes..."
          />
        </div>

        {/* Summary */}
        <div className="bg-navy-900 rounded-xl p-4 border border-navy-700/60 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">Total Amount</span><span className="font-bold text-slate-100">{formatCurrency(totalAmount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Paid</span><span className="text-emerald-400">{formatCurrency(parseFloat(paidAmount) || 0)}</span></div>
          <div className="flex justify-between border-t border-navy-700/60 pt-2">
            <span className="text-slate-300 font-medium">Pending</span>
            <span className={cn('font-bold', pendingAmount > 0 ? 'text-red-400' : 'text-emerald-400')}>
              {formatCurrency(Math.max(0, pendingAmount))}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end pb-8">
        <Link to={ROUTES.STORE.PURCHASES} className="btn btn-secondary btn-md">Cancel</Link>
        <Button size="md" isLoading={isLoading} onClick={handleSubmit} className="px-8">
          Save Purchase & Update Stock
        </Button>
      </div>

      {/* Product Picker Modal */}
      <Modal
        isOpen={pickerIndex !== null}
        onClose={() => setPickerIndex(null)}
        title="Select Product"
        initialFocusRef={productSearchInput}
        size="sm"
      >
        <ProductPicker onSelect={handleSelectProduct} searchInput={productSearchInput} />
      </Modal>
    </div>
  );
}
