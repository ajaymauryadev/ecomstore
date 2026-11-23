import { useRef, useState } from 'react';

const createKey = () => Array.from(
  globalThis.crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, '0')
).join('');

export const useIdempotentSubmission = (sendRequest, scope, { persist = false } = {}) => {
  const storageKey = persist ? `pending-payment:${scope}` : null;
  const attemptRef = useRef(undefined);
  if (attemptRef.current === undefined) {
    try {
      const saved = storageKey && JSON.parse(sessionStorage.getItem(storageKey));
      attemptRef.current = saved?.scope === scope && saved.createdAt > Date.now() - 86400000 ? saved : null;
    } catch { attemptRef.current = null; }
  }
  const submitting = useRef(false);
  const [retry, setRetry] = useState(() => attemptRef.current ? { scope, retryAt: attemptRef.current.retryAt } : null);
  const remember = (attempt) => {
    if (!storageKey) return;
    try { if (attempt) sessionStorage.setItem(storageKey, JSON.stringify(attempt)); else sessionStorage.removeItem(storageKey); } catch { /* Retry remains protected in this open form. */ }
  };

  const submit = async (payload) => {
    if (submitting.current) return;

    const attempt = attemptRef.current?.scope === scope
      ? attemptRef.current
      : { scope, payload, key: createKey(), createdAt: Date.now() };

    submitting.current = true;
    if (persist) { attemptRef.current = attempt; remember(attempt); }
    try {
      const response = await sendRequest({ ...attempt.payload, idempotencyKey: attempt.key }).unwrap();
      attemptRef.current = null;
      remember(null);
      setRetry(null);
      return response;
    } catch (error) {
      const status = error?.status;
      const shouldRetry = typeof status !== 'number' || status >= 500 || status === 408 || status === 429
        || (attemptRef.current === attempt && (status === 401 || status === 403));
      attemptRef.current = shouldRetry ? attempt : null;
      if (shouldRetry) attempt.retryAt = error?.data?.retryAt;
      remember(shouldRetry ? attempt : null);
      setRetry(shouldRetry ? { scope, retryAt: error?.data?.retryAt } : null);
      throw error;
    } finally {
      submitting.current = false;
    }
  };

  const retryPending = retry?.scope === scope;
  return { submit, retryPending, retryAt: retryPending ? retry.retryAt : undefined,
    pendingPayload: retryPending ? attemptRef.current?.payload : undefined };
};
