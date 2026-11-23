import { useEffect, useState } from 'react';

export function useRetryCountdown(retryAt) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!(retryAt > Date.now())) return;
    const timer = setInterval(() => {
      refresh((tick) => tick + 1);
      if (retryAt <= Date.now()) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  return Math.max(0, Math.ceil(((retryAt ?? 0) - Date.now()) / 1000));
}
