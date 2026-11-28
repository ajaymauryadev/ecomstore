import { useCallback, useEffect, useState } from 'react';
import { ReadStateContext } from './ReadStateContext';
import { useRetryCountdown } from '../hooks/useRetryCountdown';

export default function SavedReadBoundary({ children }) {
  const [failures, setFailures] = useState({});
  const register = useCallback((id, failure) => setFailures((previous) => {
    if (!failure && !previous[id]) return previous;
    if (failure?.error === previous[id]?.error && failure?.retry === previous[id]?.retry) return previous;
    const next = { ...previous };
    if (failure) next[id] = failure; else delete next[id];
    return next;
  }), []);
  const first = Object.values(failures)[0];
  const throttled = Object.values(failures).filter((failure) => failure.error?.status === 429);
  const retryAt = Math.max(0, ...throttled.map((failure) => failure.error.data?.retryAt || 0));
  const seconds = useRetryCountdown(retryAt);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => {
      Object.values(failures).filter((failure) => failure.error?.status === 429).forEach((failure) => failure.retry?.());
    }, Math.max(1000, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [failures, retryAt]);
  return <ReadStateContext.Provider value={register}>
    <div>{children}</div>
    {first && <section role="status" className="card mt-4 p-6 space-y-3">
      <h2 className="font-semibold">{throttled.length ? 'Updates temporarily paused' : 'This view is waiting for its first download'}</h2>
      <p className="text-sm text-slate-400">{throttled.length
        ? seconds > 0 ? `The server request limit was reached. Retrying automatically in ${seconds} seconds.` : 'The server request limit was reached. Retrying automatically.'
        : 'Connect once to save this data on your device. Downloaded views remain available offline.'}</p>
      <button type="button" className="btn-secondary" disabled={seconds > 0} onClick={() => Object.values(failures).forEach((failure) => failure.retry?.())}>Try again</button>
    </section>}
  </ReadStateContext.Provider>;
}
