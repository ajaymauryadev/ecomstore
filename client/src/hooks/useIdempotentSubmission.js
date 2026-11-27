import { useContext, useEffect, useRef, useState } from 'react';
import { ReactReduxContext } from 'react-redux';
import { accountScope } from '../offline/storage';
import { outboxKey, outboxMemory, removeIntent, saveIntent } from '../offline/outbox';
import { savedDataStatus } from '../offline/savedDataSlice';

const createKey = () => Array.from(
  globalThis.crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, '0')
).join('');

export const useIdempotentSubmission = (sendRequest, scope, { persist = false } = {}) => {
  const redux = useContext(ReactReduxContext);
  const account = accountScope(redux?.store.getState().auth);
  const storageKey = persist ? `pending-payment:${account}:${scope}` : null;
  const scopeId = outboxKey(account, scope);
  const attemptRef = useRef(undefined);
  if (attemptRef.current === undefined) {
    try {
      const tabAttempt = persist && JSON.parse(sessionStorage.getItem(storageKey));
      const saved = persist && ((tabAttempt?.id && outboxMemory.get(tabAttempt.id)) ||
        [...outboxMemory.values()].filter((entry) => entry.account === account && entry.scope === scope)
          .sort((a, b) => a.createdAt - b.createdAt)[0]);
      attemptRef.current = saved?.scope === scope ? saved : null;
    } catch { attemptRef.current = null; }
  }
  const submitting = useRef(false);
  const [retry, setRetry] = useState(() => attemptRef.current ? { scope, retryAt: attemptRef.current.retryAt } : null);
  useEffect(() => {
    const changed = () => {
      if (persist && !submitting.current && attemptRef.current?.id && !outboxMemory.has(attemptRef.current.id)) { attemptRef.current = null; setRetry(null); }
    };
    window.addEventListener('saved-outbox-changed', changed);
    return () => window.removeEventListener('saved-outbox-changed', changed);
  }, [scopeId, persist]);
  const remember = async (attempt, previousId = attemptRef.current?.id) => {
    if (!storageKey) return;
    if (attempt) await saveIntent({ ...attempt, account });
    else if (previousId) await removeIntent(previousId);
    try { if (attempt) sessionStorage.setItem(storageKey, JSON.stringify(attempt)); else sessionStorage.removeItem(storageKey); } catch { /* Retry remains protected in this open form. */ }
  };

  const submit = async (payload) => {
    if (submitting.current) return;

    const attempt = attemptRef.current?.scope === scope
      ? attemptRef.current
      : { scope, payload, key: createKey(), createdAt: Date.now() };
    attempt.id ??= `${scopeId}:${attempt.key}`;

    submitting.current = true;
    try {
      // Commit the original payload and key before the first network write.
      if (persist) {
        attemptRef.current = attempt;
        try { await remember({ ...attempt, status: 'pending' }); }
        catch {
          const message = 'This request could not be saved on this device. No new request was sent. Free storage and retry.';
          redux?.store.dispatch(savedDataStatus({ storageError: message }));
          throw { status: 'STORAGE_ERROR', data: { message } };
        }
      }
      const response = await sendRequest({ ...attempt.payload, idempotencyKey: attempt.key }).unwrap();
      await remember(null, attempt.id);
      attemptRef.current = null;
      setRetry(null);
      return response;
    } catch (error) {
      const status = error?.status;
      const shouldRetry = persist || typeof status !== 'number' || status >= 500 || status === 408 || status === 429
        || (attemptRef.current === attempt && (status === 401 || status === 403));
      attemptRef.current = shouldRetry ? attempt : null;
      if (shouldRetry) attempt.retryAt = error?.data?.retryAt;
      if (shouldRetry) {
        attempt.status = [400, 404, 409, 410, 422].includes(status) ? 'conflict' : 'pending';
        attempt.error = error?.data?.message || 'Result not confirmed. Review and retry the original request online.';
      }
      try { await remember(shouldRetry ? attempt : null); } catch { /* Keep the in-memory intent if storage failed. */ }
      setRetry(shouldRetry ? { scope, retryAt: error?.data?.retryAt } : null);
      throw error;
    } finally {
      submitting.current = false;
    }
  };

  const retryPending = Boolean(retry?.scope === scope && attemptRef.current);
  return { submit, retryPending, retryAt: retryPending ? retry.retryAt : undefined,
    pendingPayload: retryPending ? attemptRef.current?.payload : undefined };
};
