import { useEffect, useState } from 'react';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';
import { useSelector } from 'react-redux';
import { selectAccessToken } from '../../features/auth/authSlice';
import Button from '../ui/Button';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export default function SecurePaymentProof({ slug, orderId, hasScreenshot }) {
  const [requested, setRequested] = useState(false);
  const [objectUrl, setObjectUrl] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isError, setIsError] = useState(false);
  const accessToken = useSelector(selectAccessToken);

  useEffect(() => {
    if (!requested || !hasScreenshot || !accessToken) return undefined;
    const controller = new AbortController();
    let createdUrl;
    setIsFetching(true);
    setIsError(false);
    fetch(`${API_URL}/storefront/${encodeURIComponent(slug)}/admin/orders/${encodeURIComponent(orderId)}/payment/proof/file`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Payment proof request failed.');
        return response.blob();
      })
      .then((blob) => {
        if (!blob.type.startsWith('image/')) throw new Error('Payment proof response was not an image.');
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((error) => { if (error.name !== 'AbortError') setIsError(true); })
      .finally(() => { if (!controller.signal.aborted) setIsFetching(false); });
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [accessToken, hasScreenshot, orderId, requested, slug]);

  if (!hasScreenshot) return <div className="rounded-xl bg-navy-900/50 p-4 text-center text-xs text-slate-500">No screenshot was uploaded.</div>;
  if (!requested) return <Button type="button" variant="secondary" fullWidth leftIcon={<ImageIcon size={16} />} onClick={() => setRequested(true)}>Load secure payment proof</Button>;
  if (isFetching) return <div className="h-40 rounded-xl bg-navy-900/50 animate-pulse" aria-label="Loading payment proof" />;
  if (isError || !objectUrl) return <div role="alert" className="rounded-xl bg-red-500/10 p-4 text-center text-xs text-red-300">Payment proof could not be loaded. Refresh the page after signing in again.</div>;

  return (
    <a href={objectUrl} target="_blank" rel="noreferrer" className="block group" aria-label="Open payment proof at full size">
      <img src={objectUrl} alt="Customer-submitted payment proof" className="w-full max-h-64 object-contain rounded-xl bg-navy-950 border border-navy-700 group-hover:border-gold-500/50" />
      <span className="min-h-11 flex items-center justify-center gap-2 text-xs text-gold-400"><ExternalLink size={14} aria-hidden="true" />Open full size</span>
    </a>
  );
}
