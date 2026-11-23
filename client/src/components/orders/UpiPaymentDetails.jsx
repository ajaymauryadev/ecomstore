import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { upiPaymentUri } from '../../utils/upi';

export default function UpiPaymentDetails({ settings = {}, showQr = false, amount }) {
  const { upiId, upiName, upiQrUrl } = settings;
  const uri = upiId?.trim() ? upiPaymentUri(settings, amount) : null;
  const apiBase = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
  const qrUrl = upiQrUrl?.startsWith('/') ? `${apiBase}${upiQrUrl}` : upiQrUrl;

  if (!uri && !qrUrl) return <p className="text-xs text-slate-400">Contact the store for UPI payment details.</p>;

  return <div className="space-y-3">
    {showQr && (uri || qrUrl) && <div className="flex flex-col items-center gap-2">
      {qrUrl ? <img src={qrUrl} alt="Store UPI QR code" className="w-64 max-w-full h-auto max-h-96 rounded-xl bg-white object-contain p-2" />
        : <QRCodeSVG value={uri} size={208} level="M" marginSize={4} title={`Scan to pay ${upiId}`} role="img" aria-label={`UPI QR code for ${upiId}`} className="max-w-full h-auto rounded-xl bg-white" />}
      <p className="text-xs text-slate-400">Scan with any UPI app</p>
    </div>}
    {uri && <div className="flex items-center justify-between gap-2 bg-navy-900 rounded-lg px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">UPI ID</p>
        <p className="text-sm font-mono font-semibold text-slate-100 break-all">{upiId}</p>
        {upiName && <p className="text-xs text-slate-400">{upiName}</p>}
      </div>
      <button type="button" className="min-h-11 shrink-0 text-xs text-gold-400 hover:text-gold-300 px-3 py-1 rounded bg-gold-500/10" onClick={async () => {
        try { await navigator.clipboard.writeText(upiId.trim()); toast.success('UPI ID copied'); }
        catch { toast.error('Could not copy. Select the UPI ID to copy it manually.'); }
      }}>Copy</button>
    </div>}
  </div>;
}
