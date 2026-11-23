import { useState } from 'react';

export function useCursorPages(scope) {
  const [state, setState] = useState({ scope, cursors: [undefined], index: 0 });
  const current = state.scope === scope ? state : { scope, cursors: [undefined], index: 0 };
  const reset = () => setState({ scope, cursors: [undefined], index: 0 });
  const next = (cursor) => {
    if (!cursor) return;
    setState({ scope, cursors: [...current.cursors.slice(0, current.index + 1), cursor], index: current.index + 1 });
  };
  const previous = () => setState({ ...current, index: Math.max(0, current.index - 1) });
  return { page: current.index + 1, cursor: current.cursors[current.index], reset, next, previous, hasPrevious: current.index > 0 };
}
