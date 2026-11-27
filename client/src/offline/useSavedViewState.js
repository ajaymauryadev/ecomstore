import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ReactReduxContext } from 'react-redux';
import { UNSAFE_LocationContext } from 'react-router-dom';
import { accountScope, savedStorage } from './storage';
import { viewMemory } from './savedData';
import { savedDataStatus } from './savedDataSlice';

// Explicit keys save view choices/drafts, never dialog visibility, request state or effects.
export function useSavedViewState(name, initialValue) {
  const redux = useContext(ReactReduxContext);
  const location = useContext(UNSAFE_LocationContext)?.location;
  const store = redux?.store;
  const enabled = Boolean(store?.getState().auth && location);
  const scope = accountScope(store?.getState().auth);
  const key = `${location?.pathname ?? 'view'}:${name}`;
  const read = () => {
    const saved = enabled && viewMemory.get(scope);
    return saved && Object.hasOwn(saved, key) ? saved[key] : typeof initialValue === 'function' ? initialValue() : initialValue;
  };
  const [state, setState] = useState(() => ({ scope, key, value: read() }));
  const value = state.scope === scope && state.key === key ? state.value : read();
  const latest = useRef(value);
  latest.current = value;
  const setValue = useCallback((update) => {
    // Functional updates run synchronously, so leaving the route immediately cannot lose a draft.
    const previous = enabled && Object.hasOwn(viewMemory.get(scope) ?? {}, key) ? viewMemory.get(scope)[key] : latest.current;
    const next = typeof update === 'function' ? update(previous) : update;
    latest.current = next;
    const saved = { ...(viewMemory.get(scope) ?? {}), [key]: next };
    if (enabled) viewMemory.set(scope, saved);
    setState({ scope, key, value: next });
    if (enabled) {
      void savedStorage.put('drafts', scope, saved).catch(() => store.dispatch(savedDataStatus({ storageError: 'Your latest view or draft could not be saved on this device.' })));
    }
  }, [enabled, key, scope, store]);
  useEffect(() => {
    // Defaults such as a report's date must also survive midnight and restart.
    if (enabled && !Object.hasOwn(viewMemory.get(scope) ?? {}, key)) setValue(latest.current);
  }, [enabled, key, scope, setValue]);
  return [value, setValue];
}
