import { useRef, useState } from 'react';
import { CheckCircle2, Printer, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import { resolveStoreTimeZone } from '../../utils/accounting';
import receiptStyles from './receipt.css?raw';
import './receipt.css';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const moneyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value) => moneyFormatter.format(Number(value) || 0);
const paymentLabels = { counter: 'Cash', upi_id: 'UPI', credit: 'Udhar/Credit' };
const statusLabels = { paid: 'Paid', pending: 'Payment pending', refunded: 'Refunded', partially_refunded: 'Partially refunded', failed: 'Payment failed' };

export function ReceiptContent({ order, store, paper = 'a4' }) {
  const pricing = order.pricing ?? {};
  const customer = order.customerInfo ?? {};
  const timeZone = resolveStoreTimeZone(store?.settings?.timezone);
  const date = order.createdAt ? new Date(order.createdAt) : null;
  const validDate = date && !Number.isNaN(date.getTime());
  const dateText = validDate ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone }) : 'Date unavailable';
  const timeText = validDate ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone }) : '';
  const address = store?.address;
  const addressText = address && [address.street, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  const credit = order.paymentMethod === 'credit' && order.paymentStatus !== 'paid';
  const status = credit ? 'On credit' : statusLabels[order.paymentStatus] || 'Recorded';
  return <article className="bill-receipt" data-paper={paper} aria-label="Sales receipt">
    <header className="bill-header">
      <div><h2>{store?.name || 'Smart Kirana'}</h2>
        {(addressText || store?.contact?.phone || store?.taxSettings?.gstNumber) && <div className="bill-store-details">
          {addressText && <p>{addressText}</p>}
          {store?.contact?.phone && <p>Phone: {store.contact.phone}</p>}
          {store?.taxSettings?.gstNumber && <p>GSTIN: {store.taxSettings.gstNumber}</p>}
        </div>}
      </div>
      <div className="bill-document-label"><strong>SALES RECEIPT</strong><span className={`bill-status${credit ? ' is-credit' : ''}`}>{status}</span></div>
    </header>
    <section className="bill-meta">
      <div><span className="bill-caption">Customer</span><strong>{customer.name || 'Walk-in Customer'}</strong>
        {customer.phone && <p>{customer.phone}</p>}
        <p>Payment: {paymentLabels[order.paymentMethod] || order.paymentMethod || 'Not specified'}</p>
      </div>
      <div className="bill-reference"><span className="bill-caption">Bill details</span><strong>Bill#: {order.orderNumber || 'Pending'}</strong>
        <p>{dateText}{timeText && ` · ${timeText}`}</p>
      </div>
    </section>
    <table className="bill-table">
      <thead><tr><th scope="col">Item / description</th><th scope="col" className="bill-numeric">Qty</th><th scope="col" className="bill-numeric">Rate</th><th scope="col" className="bill-numeric">Amount</th></tr></thead>
      <tbody>{(order.items ?? []).map((item, index) => <tr key={item._id || `${item.variantId || item.productId}-${index}`}>
        <td><span className="bill-item-name">{item.name}</span>{item.variantName && <span className="bill-item-variant">{item.variantName}</span>}</td>
        <td className="bill-numeric">{item.quantity}</td><td className="bill-numeric">{money(item.price)}</td><td className="bill-numeric">{money(item.total)}</td>
      </tr>)}</tbody>
    </table>
    <div className="bill-ending">
    <section className="bill-totals" aria-label="Bill totals">
      <div className="bill-total-line"><span>Subtotal</span><span>{money(pricing.subtotal)}</span></div>
      {pricing.couponDiscount > 0 && <div className="bill-total-line"><span>Discount</span><span>-{money(pricing.couponDiscount)}</span></div>}
      {pricing.tax > 0 && <div className="bill-total-line"><span>Tax</span><span>{money(pricing.tax)}</span></div>}
      {pricing.deliveryCharge > 0 && <div className="bill-total-line"><span>Delivery</span><span>{money(pricing.deliveryCharge)}</span></div>}
      <div className="bill-total-line bill-grand-total"><span>Total</span><span>{money(pricing.grandTotal)}</span></div>
      {order.checkoutPayments?.map((payment, index) => <div key={index} className="bill-total-line"><span>{payment.method === 'cash' ? 'Cash received' : 'UPI received'}</span><span>{money(payment.amount)}</span></div>)}
      {order.udharAmount > 0 && <div className="bill-total-line"><strong>Added to Udhar</strong><strong>{money(order.udharAmount)}</strong></div>}
    </section>
    {credit && <p className="bill-payment-note">This purchase has been added to the customer’s Udhar account. Refer to the account ledger for the current balance.</p>}
    <footer className="bill-footer"><strong>Thank you for shopping with us.</strong><p>Please keep this receipt for your records.</p></footer>
    </div>
  </article>;
}

export default function BillReceipt({ order, store, onClose, onNewSale }) {
  const { user } = useAuth();
  const billRef = useRef(null);
  const [paper, setPaper] = useState('a4');
  const handlePrint = () => {
    const content = billRef.current?.innerHTML;
    if (!content) return;
    const win = window.open('', '_blank', 'width=960,height=760');
    if (!win) return toast.error('Allow pop-ups in your browser to print the bill.');
    // All receipt values have already been escaped by React. The print window
    // gets the same scoped CSS as the preview, independently of Tailwind.
    const title = String(order.orderNumber || 'Sales receipt').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const page = paper === 'thermal' ? 'size: 80mm 240mm; margin: 4mm;' : 'size: A4; margin: 14mm;';
    win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${receiptStyles}\n@page { ${page} }</style></head><body>${content}</body></html>`);
    win.document.close();
    Promise.resolve(win.document.fonts?.ready).then(() => {
      if (win.closed) return;
      win.requestAnimationFrame(() => { if (!win.closed) { win.focus(); win.print(); } });
    });
  };
  return <Modal isOpen onClose={onClose} title="Bill Generated" size="2xl" className="receipt-dialog">
    <div className="receipt-success"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>Bill saved successfully</strong><p>Your sale has been recorded. Print or save a PDF below.</p></div></div>
    <div className="receipt-toolbar"><label htmlFor="bill-paper-size">Paper size</label><select id="bill-paper-size" className="input" value={paper} onChange={(e) => setPaper(e.target.value)}><option value="a4">A4 invoice</option><option value="thermal">80mm receipt</option></select></div>
    <div ref={billRef} className="receipt-paper"><ReceiptContent order={order} store={store} paper={paper} /></div>
    <p className="receipt-print-hint">Choose “Save as PDF” in the print window. Disable browser headers and footers for a clean bill.</p>
    {order.saleType === 'parcha' && <p className="text-sm mb-3">Packing pending. <Link className="workspace-link" to={user?.role === 'store_owner' ? '/store/packing/work' : '/staff/orders'}>Open Pack Orders</Link></p>}
    <div className="receipt-actions"><button type="button" onClick={handlePrint} className="btn-secondary"><Printer size={16} /> Print / Save PDF</button><button type="button" onClick={onNewSale} className="btn-primary"><RotateCcw size={16} /> New Sale</button></div>
  </Modal>;
}
