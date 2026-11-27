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
    {first && <section role="alert" className="workspace-feedback space-y-3">
      <h2 className="font-semibold">Saved data is unavailable for this view</h2>
      <p>Connect to the internet to download this data.</p>
      {first.error?.data?.message && <p>{first.error.data.message}</p>}
      <button type="button" className="btn-secondary" onClick={() => Object.values(failures).forEach((failure) => failure.retry?.())}>Try again</button>
    </section>}
    <div hidden={Boolean(first)}>{children}</div>
  </ReadStateContext.Provider>;
}
