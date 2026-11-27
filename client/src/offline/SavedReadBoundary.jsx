import { useCallback, useState } from 'react';
import { ReadStateContext } from './ReadStateContext';

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
  return <ReadStateContext.Provider value={register}>
    {first && <section role="status" className="card p-6 space-y-3">
      <h2 className="font-semibold">This view is waiting for its first download</h2>
      <p className="text-sm text-slate-400">Connect once to save this data on your device. Downloaded views remain available offline.</p>
      <button type="button" className="btn-secondary" onClick={() => Object.values(failures).forEach((failure) => failure.retry?.())}>Try again</button>
    </section>}
    <div hidden={Boolean(first)}>{children}</div>
  </ReadStateContext.Provider>;
}
