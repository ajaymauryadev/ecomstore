import { useSavedViewState } from '../../../offline/useSavedViewState';
import { useEffect, useId, cloneElement } from 'react';
import { Store, CreditCard, Truck, Clock, ShoppingBag, Receipt, Plus, Trash2, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetMyStoreQuery, useUpdateMyStoreMutation, useUploadPaymentQrMutation } from '../../../features/store/storeApi';
import UpiPaymentDetails from '../../../components/orders/UpiPaymentDetails';
import { cn } from '../../../utils/cn';

const TABS = [
  { id: 'shop', label: 'Shop Info', icon: Store },
  { id: 'payment', label: 'Payments', icon: CreditCard },
  { id: 'delivery', label: 'Delivery', icon: Truck },
  { id: 'hours', label: 'Hours', icon: Clock },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'tax', label: 'GST / Tax', icon: Receipt },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Section({ title, children }) {
  return (
    <div className="card p-5 space-y-4">
      <h3 className="font-semibold text-slate-200 text-sm border-b border-navy-700/60 pb-3">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  const id = useId();
  const isControl = ['input', 'select', 'textarea'].includes(children.type);
  return (
    <div className="min-w-0">
      {isControl ? <label htmlFor={id} className="label">{label}</label> : <p className="label">{label}</p>}
      {isControl ? cloneElement(children, { id }) : children}
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={value} className="workspace-row-action shrink-0" onClick={() => onChange(!value)}>
      {value ? <ToggleRight size={28} className="text-gold-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
    </button>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useSavedViewState('SettingsPage:SettingsPage:activeTab', 'shop');
  const { data, isLoading } = useGetMyStoreQuery();
  const [updateStore, { isLoading: isSaving }] = useUpdateMyStoreMutation();
  const [uploadPaymentQr, { isLoading: isUploadingQr }] = useUploadPaymentQrMutation();

  const store = data?.data?.store;

  // Local form state
  const [form, setForm] = useSavedViewState('settings-draft', null);

  useEffect(() => {
    if (store && !form) {
      setForm({
        name: store.name || '',
        branding: {
          logo: store.branding?.logo || '',
          banner: store.branding?.banner || '',
          tagline: store.branding?.tagline || '',
          primaryColor: store.branding?.primaryColor || '#f59e0b',
        },
        address: {
          street: store.address?.street || '',
          city: store.address?.city || '',
          state: store.address?.state || '',
          pincode: store.address?.pincode || '',
        },
        contact: {
          phone: store.contact?.phone || '',
          email: store.contact?.email || '',
          whatsapp: store.contact?.whatsapp || '',
        },
        paymentSettings: {
          upiId: store.paymentSettings?.upiId || '',
          upiName: store.paymentSettings?.upiName || '',
          upiQrUrl: store.paymentSettings?.upiQrUrl || '',
          bankAccount: store.paymentSettings?.bankAccount || '',
          bankIfsc: store.paymentSettings?.bankIfsc || '',
          bankName: store.paymentSettings?.bankName || '',
          bankAccountName: store.paymentSettings?.bankAccountName || '',
        },
        deliverySettings: {
          areas: store.deliverySettings?.areas || [],
          defaultCharge: store.deliverySettings?.defaultCharge ?? 40,
          freeDeliveryAbove: store.deliverySettings?.freeDeliveryAbove ?? 0,
          minOrderAmount: store.deliverySettings?.minOrderAmount ?? 0,
        },
        businessHours: {
          openTime: store.businessHours?.openTime || '09:00',
          closeTime: store.businessHours?.closeTime || '22:00',
          pickupOpenTime: store.businessHours?.pickupOpenTime || '09:00',
          pickupCloseTime: store.businessHours?.pickupCloseTime || '21:00',
          closedDays: store.businessHours?.closedDays || [],
        },
        orderSettings: {
          isAcceptingOrders: store.orderSettings?.isAcceptingOrders ?? true,
          autoAccept: store.orderSettings?.autoAccept ?? false,
        },
        taxSettings: {
          enableGST: store.taxSettings?.enableGST ?? false,
          gstNumber: store.taxSettings?.gstNumber || '',
          cgstPercent: store.taxSettings?.cgstPercent ?? 0,
          sgstPercent: store.taxSettings?.sgstPercent ?? 0,
        },
      });
    }
  }, [store, form, setForm]);

  const set = (section, key, val) => setForm((f) => ({ ...f, [section]: { ...f[section], [key]: val } }));

  const handleSave = async () => {
    if (isUploadingQr || isSaving) return;
    try {
      await updateStore(form).unwrap();
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to save');
    }
  };

  const handleQrUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error('Choose a JPG, PNG, or WebP image up to 5 MB.');
      return;
    }
    const body = new FormData();
    body.append('image', file);
    try {
      const result = await uploadPaymentQr(body).unwrap();
      set('paymentSettings', 'upiQrUrl', result.data.url);
      toast.success('QR uploaded. Save Changes to use it for payments.');
    } catch (error) {
      toast.error(error?.data?.message || 'Could not upload QR code. Please try again.');
    }
  };

  // Delivery areas helpers
  const addArea = () => set('deliverySettings', 'areas', [...(form.deliverySettings.areas || []), { name: '', charge: 0, minOrder: 0 }]);
  const removeArea = (i) => set('deliverySettings', 'areas', form.deliverySettings.areas.filter((_, idx) => idx !== i));
  const setArea = (i, key, val) => set('deliverySettings', 'areas', form.deliverySettings.areas.map((a, idx) => idx === i ? { ...a, [key]: val } : a));

  const toggleClosedDay = (day) => {
    const days = form.businessHours.closedDays;
    set('businessHours', 'closedDays', days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
  };

  if (isLoading || !form) {
    return <div className="p-6 text-center text-slate-500">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Store Settings</h1>
        <button className="btn-primary" onClick={handleSave} disabled={isSaving || isUploadingQr}>
          <Save size={16} /> {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-navy-800 p-1 rounded-2xl border border-navy-700 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" aria-pressed={activeTab === t.id} onClick={() => setActiveTab(t.id)}
              className={cn('flex min-h-11 items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all',
                activeTab === t.id ? 'bg-gold-500/20 text-gold-400 border border-gold-500/20' : 'text-slate-400 hover:text-slate-200')}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Shop Info ── */}
      {activeTab === 'shop' && (
        <div className="space-y-4">
          <Section title="Basic Info">
            <Field label="Store Name">
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Tagline">
              <input className="input" placeholder="Your slogan / tagline" value={form.branding.tagline} onChange={(e) => set('branding', 'tagline', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Logo URL">
                <input className="input" placeholder="https://..." value={form.branding.logo} onChange={(e) => set('branding', 'logo', e.target.value)} />
              </Field>
              <Field label="Banner URL">
                <input className="input" placeholder="https://..." value={form.branding.banner} onChange={(e) => set('branding', 'banner', e.target.value)} />
              </Field>
            </div>
            <Field label="Brand Color">
              <div className="flex gap-2 items-center">
                <input type="color" aria-label="Choose brand color" className="w-12 h-11 shrink-0 rounded-lg border border-navy-600 bg-navy-800 cursor-pointer" value={form.branding.primaryColor} onChange={(e) => set('branding', 'primaryColor', e.target.value)} />
                <input aria-label="Brand color hex code" className="input min-w-0 flex-1" value={form.branding.primaryColor} onChange={(e) => set('branding', 'primaryColor', e.target.value)} />
              </div>
            </Field>
          </Section>

          <Section title="Address">
            <Field label="Street">
              <input className="input" value={form.address.street} onChange={(e) => set('address', 'street', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="City">
                <input className="input" value={form.address.city} onChange={(e) => set('address', 'city', e.target.value)} />
              </Field>
              <Field label="State">
                <input className="input" value={form.address.state} onChange={(e) => set('address', 'state', e.target.value)} />
              </Field>
              <Field label="Pincode">
                <input className="input" value={form.address.pincode} onChange={(e) => set('address', 'pincode', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Phone">
                <input className="input" value={form.contact.phone} onChange={(e) => set('contact', 'phone', e.target.value)} />
              </Field>
              <Field label="WhatsApp">
                <input className="input" value={form.contact.whatsapp} onChange={(e) => set('contact', 'whatsapp', e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="input" value={form.contact.email} onChange={(e) => set('contact', 'email', e.target.value)} />
              </Field>
            </div>
          </Section>
        </div>
      )}

      {/* ── Payments ── */}
      {activeTab === 'payment' && (
        <div className="space-y-4">
          <Section title="UPI">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="UPI ID">
                <input className="input" placeholder="store@upi" autoCapitalize="none" spellCheck={false} value={form.paymentSettings.upiId} onChange={(e) => set('paymentSettings', 'upiId', e.target.value)} />
              </Field>
              <Field label="UPI Name">
                <input className="input" placeholder="Store Owner Name" value={form.paymentSettings.upiName} onChange={(e) => set('paymentSettings', 'upiName', e.target.value)} />
              </Field>
            </div>
            <Field label="Upload UPI QR code">
              <input type="file" accept="image/jpeg,image/png,image/webp" className="input w-full min-w-0 text-sm" disabled={isUploadingQr || isSaving} onChange={handleQrUpload} />
            </Field>
            <p className="text-xs text-slate-400" role={isUploadingQr ? 'status' : undefined}>{isUploadingQr ? 'Uploading QR code...' : 'JPG, PNG, or WebP up to 5 MB. Upload a QR code for the same UPI ID entered above, then save your changes.'}</p>
            {(form.paymentSettings.upiQrUrl || form.paymentSettings.upiId.trim()) && (
              <div className="space-y-3 p-3 bg-navy-900 rounded-xl border border-navy-700">
                <p className="text-sm font-medium text-slate-200">Payment preview</p>
                <UpiPaymentDetails settings={form.paymentSettings} showQr />
                {form.paymentSettings.upiQrUrl ? <button type="button" className="btn-secondary" disabled={isUploadingQr || isSaving} onClick={() => set('paymentSettings', 'upiQrUrl', '')}>Remove QR image</button>
                  : <p className="text-xs text-slate-400">This QR is generated from your UPI ID. Upload your own QR image to replace it.</p>}
              </div>
            )}
          </Section>

          <Section title="Bank Account">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Account Holder Name">
                <input className="input" value={form.paymentSettings.bankAccountName} onChange={(e) => set('paymentSettings', 'bankAccountName', e.target.value)} />
              </Field>
              <Field label="Bank Name">
                <input className="input" value={form.paymentSettings.bankName} onChange={(e) => set('paymentSettings', 'bankName', e.target.value)} />
              </Field>
              <Field label="Account Number">
                <input className="input" value={form.paymentSettings.bankAccount} onChange={(e) => set('paymentSettings', 'bankAccount', e.target.value)} />
              </Field>
              <Field label="IFSC Code">
                <input className="input" placeholder="e.g. SBIN0012345" value={form.paymentSettings.bankIfsc} onChange={(e) => set('paymentSettings', 'bankIfsc', e.target.value.toUpperCase())} />
              </Field>
            </div>
          </Section>
        </div>
      )}

      {/* ── Delivery ── */}
      {activeTab === 'delivery' && (
        <div className="space-y-4">
          <Section title="Delivery Defaults">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Default Delivery Charge (₹)">
                <input className="input" type="number" min="0" value={form.deliverySettings.defaultCharge} onChange={(e) => set('deliverySettings', 'defaultCharge', Number(e.target.value))} />
              </Field>
              <Field label="Free Delivery Above (₹)">
                <input className="input" type="number" min="0" placeholder="0 = always paid" value={form.deliverySettings.freeDeliveryAbove} onChange={(e) => set('deliverySettings', 'freeDeliveryAbove', Number(e.target.value))} />
              </Field>
              <Field label="Min Order Amount (₹)">
                <input className="input" type="number" min="0" value={form.deliverySettings.minOrderAmount} onChange={(e) => set('deliverySettings', 'minOrderAmount', Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section title="Delivery Areas">
            <div className="space-y-2">
              {(form.deliverySettings.areas || []).map((area, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-center bg-navy-900/60 p-3 rounded-xl border border-navy-700">
                  <input aria-label={`Delivery area ${i + 1} name`} className="input min-w-0 basis-full sm:basis-40 flex-1 text-sm py-2" placeholder="Area name (e.g. Sector 15)" value={area.name} onChange={(e) => setArea(i, 'name', e.target.value)} />
                  <div className="shrink-0">
                    <input aria-label={`Delivery area ${i + 1} charge`} className="input w-24 text-sm py-2" type="number" min="0" placeholder="Charge ₹" value={area.charge} onChange={(e) => setArea(i, 'charge', Number(e.target.value))} />
                  </div>
                  <div className="shrink-0">
                    <input aria-label={`Delivery area ${i + 1} minimum order`} className="input w-28 text-sm py-2" type="number" min="0" placeholder="Min order ₹" value={area.minOrder} onChange={(e) => setArea(i, 'minOrder', Number(e.target.value))} />
                  </div>
                  <button type="button" aria-label={`Remove delivery area ${i + 1}`} onClick={() => removeArea(i)} className="workspace-row-action text-red-400 hover:text-red-300 shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addArea} className="btn-secondary w-full gap-2 text-sm py-2">
                <Plus size={14} /> Add Delivery Area
              </button>
            </div>
          </Section>
        </div>
      )}

      {/* ── Business Hours ── */}
      {activeTab === 'hours' && (
        <div className="space-y-4">
          <Section title="Store Hours">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Opening Time">
                <input className="input" type="time" value={form.businessHours.openTime} onChange={(e) => set('businessHours', 'openTime', e.target.value)} />
              </Field>
              <Field label="Closing Time">
                <input className="input" type="time" value={form.businessHours.closeTime} onChange={(e) => set('businessHours', 'closeTime', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Pickup Hours">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Pickup Open">
                <input className="input" type="time" value={form.businessHours.pickupOpenTime} onChange={(e) => set('businessHours', 'pickupOpenTime', e.target.value)} />
              </Field>
              <Field label="Pickup Close">
                <input className="input" type="time" value={form.businessHours.pickupCloseTime} onChange={(e) => set('businessHours', 'pickupCloseTime', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Closed Days">
            <div className="flex gap-2 flex-wrap">
              {DAYS.map((day) => (
                <button key={day} type="button" aria-pressed={form.businessHours.closedDays.includes(day)} onClick={() => toggleClosedDay(day)}
                  className={cn('px-4 py-2 rounded-xl text-sm font-medium border transition-all', form.businessHours.closedDays.includes(day) ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-navy-700 text-slate-400 border-navy-600 hover:border-navy-500')}>
                  {day}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">Selected days will show as closed to customers</p>
          </Section>
        </div>
      )}

      {/* ── Order Settings ── */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <Section title="Order Controls">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">Accepting Orders</p>
                  <p className="text-xs text-slate-500 mt-0.5">Toggle off to pause all new orders from customers</p>
                </div>
                <Toggle label="Accept online orders" value={form.orderSettings.isAcceptingOrders} onChange={(v) => set('orderSettings', 'isAcceptingOrders', v)} />
              </div>
              <div className="border-t border-navy-700/60" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">Auto-Accept Orders</p>
                  <p className="text-xs text-slate-500 mt-0.5">Automatically accept orders without manual review</p>
                </div>
                <Toggle label="Auto accept orders" value={form.orderSettings.autoAccept} onChange={(v) => set('orderSettings', 'autoAccept', v)} />
              </div>
              <div className="border-t border-navy-700/60" />
            </div>
          </Section>
        </div>
      )}

      {/* ── GST / Tax ── */}
      {activeTab === 'tax' && (
        <div className="space-y-4">
          <Section title="GST Settings">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-slate-200">Enable GST</p>
                <p className="text-xs text-slate-500 mt-0.5">Show GST breakup on invoices and receipts</p>
              </div>
              <Toggle label="Enable GST" value={form.taxSettings.enableGST} onChange={(v) => set('taxSettings', 'enableGST', v)} />
            </div>

            {form.taxSettings.enableGST && (
              <div className="space-y-3 pt-3 border-t border-navy-700/60">
                <Field label="GST Number (GSTIN)">
                  <input className="input" placeholder="22AAAAA0000A1Z5" value={form.taxSettings.gstNumber} onChange={(e) => set('taxSettings', 'gstNumber', e.target.value.toUpperCase())} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="CGST (%)">
                    <input className="input" type="number" min="0" max="50" step="0.5" value={form.taxSettings.cgstPercent} onChange={(e) => set('taxSettings', 'cgstPercent', Number(e.target.value))} />
                  </Field>
                  <Field label="SGST (%)">
                    <input className="input" type="number" min="0" max="50" step="0.5" value={form.taxSettings.sgstPercent} onChange={(e) => set('taxSettings', 'sgstPercent', Number(e.target.value))} />
                  </Field>
                </div>
                <div className="p-3 bg-navy-900/60 rounded-xl border border-navy-700">
                  <p className="text-xs text-slate-400">Total GST: <span className="text-gold-400 font-semibold">{(form.taxSettings.cgstPercent + form.taxSettings.sgstPercent).toFixed(1)}%</span></p>
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      <div className="flex justify-end border-t border-navy-700 pt-5">
        <button className="btn-primary" onClick={handleSave} disabled={isSaving || isUploadingQr}>
          <Save size={16} /> {isSaving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>
    </div>
  );
}
