// Per-process admission control only, never a financial lock. Reject excess work
// without retaining a queue; keep slots until async work ends, even if a client leaves.
export function workloadGate(limit, message = 'Server is busy. Please retry shortly.') {
  let active = 0;
  return (handler) => async (req, res, next) => {
    if (active >= limit) {
      res.set('Retry-After', '2');
      return res.status(503).json({ status: 'error', message });
    }
    active++;
    try { return await handler(req, res, next); }
    catch (error) { return next(error); }
    finally { active--; }
  };
}
