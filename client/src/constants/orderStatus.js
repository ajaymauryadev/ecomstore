// Administrative transitions exposed by the owner order screen. Payment and
// packing-specific transitions are intentionally handled by their dedicated flows.
export const ORDER_ADMIN_STATUS_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['accepted', 'rejected', 'cancelled']),
  payment_pending: Object.freeze(['cancelled']),
  payment_submitted: Object.freeze([]),
  payment_verified: Object.freeze(['accepted', 'rejected']),
  accepted: Object.freeze(['packing', 'cancelled']),
  packing: Object.freeze(['packed']),
  packed: Object.freeze(['ready_for_pickup', 'out_for_delivery']),
  ready_for_pickup: Object.freeze(['delivered']),
  out_for_delivery: Object.freeze(['delivered']),
  partially_fulfilled: Object.freeze(['delivered']),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([]),
  rejected: Object.freeze([]),
});
