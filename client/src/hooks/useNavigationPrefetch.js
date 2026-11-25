import { useEffect, useRef } from 'react';
import { prefetchRoute } from '../app/routePrefetch';

export function useNavigationPrefetch() {
  const timer = useRef();
  const cancel = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const anchor = (event) => event.target.closest?.('a[href]');
  const schedule = (event) => {
    const link = anchor(event);
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    cancel();
    timer.current = window.setTimeout(() => { void prefetchRoute(url.pathname); }, 100);
  };
  return {
    onPointerOver: schedule, onFocusCapture: schedule,
    onPointerOut: (event) => {
      if (!(event.relatedTarget instanceof Node) || !anchor(event)?.contains(event.relatedTarget)) cancel();
    },
    onBlurCapture: cancel,
  };
}
