// Opt-in, in-memory timing only. Never record route arguments, bodies, identities or tokens.
export const diagnosticsEnabled = () => {
  if (import.meta.env.VITE_PERF_DIAGNOSTICS !== 'true' || typeof window === 'undefined') return false;
  try { return window.sessionStorage?.getItem('__ecom_perf') === '1'; }
  catch { return false; }
};

export function markPerformance(name) {
  if (diagnosticsEnabled()) performance.mark(`ecom:${name}`);
}

export function recordDuration(name, durationMs) {
  if (!diagnosticsEnabled()) return;
  const data = window.__ECOM_PERF ??= { durations: {}, renders: [] };
  const samples = data.durations[name] ??= [];
  if (samples.length < 500) samples.push(Number(durationMs.toFixed(2)));
}

export function recordRender(id, phase, actualDuration) {
  if (!diagnosticsEnabled()) return;
  const data = window.__ECOM_PERF ??= { durations: {}, renders: [] };
  if (data.renders.length < 500) data.renders.push({ id, phase, ms: Number(actualDuration.toFixed(2)) });
}
