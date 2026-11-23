const asObject = (order) => order?.toObject ? order.toObject({ virtuals: true }) : { ...order };

export const stripOrderItemCosts = (order) => {
  for (const item of order.items ?? []) delete item.unitCost;
  return order;
};

export const customerOrderResponse = (order) => {
  const value = asObject(order);
  delete value.orderSubmission;
  delete value.guestAccessTokenHash;
  delete value.guestAccessTokenCreatedAt;
  delete value.__v;
  delete value.assignedTo;
  delete value.deliveryAssignedTo;
  delete value.fulfillment;
  // Internal employee attribution is visible in the authenticated store workspace.
  value.timeline = (value.timeline || []).filter((entry) => !['packing_assigned', 'delivery_assigned'].includes(entry.action))
    .map(({ performedBy, assignee, previousAssignee, action, ...entry }) => entry);
  delete value.stockReservationState;
  delete value.stockRestoredAt;
  if (value.paymentProof) {
    delete value.paymentProof.screenshotFile;
    delete value.paymentProof.screenshotUrl;
    delete value.paymentProof.verifiedBy;
  }
  value.items = (value.items || []).map(({ restoredQty, returnReservedQty, unitCost, ...item }) => item);
  return value;
};

export const publicPaymentSettingsFor = (store, paymentMethod) => {
  const settings = store?.paymentSettings || {};
  if (['upi_qr', 'upi_id'].includes(paymentMethod)) {
    return { upiId: settings.upiId, upiName: settings.upiName, upiQrUrl: settings.upiQrUrl };
  }
  if (paymentMethod === 'bank_transfer') {
    return {
      bankAccount: settings.bankAccount,
      bankIfsc: settings.bankIfsc,
      bankName: settings.bankName,
      bankAccountName: settings.bankAccountName,
    };
  }
  return null;
};
