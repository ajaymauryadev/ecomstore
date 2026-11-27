import { createContext, useContext, useId, useLayoutEffect } from 'react';

export const ReadStateContext = createContext(null);

export function useQueryReadState(result) {
  const register = useContext(ReadStateContext);
  const id = useId();
  const missing = result.currentData === undefined && result.isError &&
    (typeof result.error?.status !== 'number' || result.error.status >= 500 || result.error.status === 429);
  useLayoutEffect(() => {
    if (!register) return;
    register(id, missing ? { error: result.error, retry: result.refetch } : null);
    return () => register(id, null);
  }, [id, register, missing, result.error, result.refetch]);
}
