export const ORDER_STATUS_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['accepted', 'rejected', 'cancelled']),
  payment_pending: Object.freeze(['payment_submitted', 'rejected', 'cancelled']),
  payment_submitted: Object.freeze(['payment_verified', 'payment_pending', 'rejected', 'cancelled']),
  payment_verified: Object.freeze(['accepted', 'packing', 'rejected', 'cancelled']),
  accepted: Object.freeze(['packing', 'rejected', 'cancelled']),
  packing: Object.freeze(['packed', 'partially_fulfilled', 'cancelled']),
  packed: Object.freeze(['packing', 'ready_for_pickup', 'out_for_delivery', 'partially_fulfilled', 'cancelled']),
  ready_for_pickup: Object.freeze(['delivered', 'cancelled']),
  out_for_delivery: Object.freeze(['delivered']),
  partially_fulfilled: Object.freeze(['ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled']),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([]),
  rejected: Object.freeze([]),
});

export const canTransitionOrder = (from, to) =>
  Boolean(from && to && ORDER_STATUS_TRANSITIONS[from]?.includes(to));
